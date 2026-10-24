import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildGrid,
  formatMeeting,
  MEETING_SLOTS,
  normalizeSlot,
  slotEnd,
  tzLabel,
  type AvailabilityMeResponse,
  type AvailabilityPutRequest,
  type AvailabilityPutResponse,
  type HeatmapResponse,
  type Screen,
} from '@groupie/shared';
import { api, ApiError } from '../api.ts';
import { haptic, tg } from '../telegram.ts';
import { AvailabilityGrid, buildCells, type Heat } from '../components/AvailabilityGrid.tsx';
import { AvailabilitySkeleton } from '../components/Skeleton.tsx';
import { Header } from '../components/Header.tsx';
import { Message } from '../components/Message.tsx';

type Props = {
  groupId: number;
  /** Known up front inside Telegram; in browser mode it arrives with the data. */
  nickname?: string;
  /** Browser mode via a signed link: renders its own header, no Telegram chrome. */
  standalone?: boolean;
  go?: (s: Screen) => void;
};
type View = 'mine' | 'group';
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
type LoadError = { status: number; message: string };
type Counts = { responded: number; team_size: number };

const label = 'text-[13px] font-medium uppercase tracking-widest text-muted';
const card = 'rounded-3xl border border-dashed border-line-strong';
const LIME = '#A6E35A';
const DEBOUNCE_MS = 700;

const hours = (slots: number) => {
  const h = slots / 2;
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
};

export function Availability({ groupId, nickname, standalone = false, go }: Props) {
  const [data, setData] = useState<AvailabilityMeResponse | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api<AvailabilityMeResponse>(`/groups/${groupId}/availability/me`)
      .then((res) => live && setData(res))
      .catch((e) => {
        if (!live) return;
        setError(
          e instanceof ApiError
            ? { status: e.status, message: e.message }
            : { status: 0, message: 'Could not reach Groupie. Try again in a sec?' },
        );
      });
    return () => {
      live = false;
    };
  }, [groupId, attempt]);

  const nick = data?.group.nickname ?? nickname ?? 'Groupie';

  if (error?.status === 401 && standalone) {
    return <Message title="Link expired" body="This link expired. Ask your group for a fresh one." />;
  }
  if (error?.status === 409) {
    return (
      <Blocked
        icon="✦"
        title="Add your details first"
        body={`${nick} needs to know who you are before you paint your week. It takes ten seconds.`}
        action={go && tg ? { label: 'Add my details', onClick: () => go('form') } : undefined}
      />
    );
  }
  if (error) {
    return (
      <Blocked
        icon="?"
        title="Your week got lost"
        body={error.message}
        action={{
          label: 'Try again',
          onClick: () => {
            setError(null);
            setAttempt((a) => a + 1);
          },
        }}
      />
    );
  }
  if (!data) return <AvailabilitySkeleton withHeader={standalone} />;
  return <Board data={data} standalone={standalone} />;
}

function Blocked({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mx-auto flex max-w-xl animate-enter flex-col items-center px-8 pt-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-line-strong text-[26px] text-muted">
        {icon}
      </div>
      <h1 className="mt-6 text-[24px] font-bold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-muted">{body}</p>
      {action && (
        <button
          className="mt-8 rounded-full bg-text px-7 py-3 text-[15px] font-semibold text-ink active:scale-[0.98]"
          onClick={() => {
            haptic.tap();
            action.onClick();
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * Debounced autosave of the full slot set. Edits made while a save is in flight
 * are picked up by the loop and saved right after, so nothing is ever dropped.
 */
function useAutosave(groupId: number, read: () => string[], onSaved: (res: AvailabilityPutResponse) => void) {
  const [state, setState] = useState<SaveState>('idle');
  const edits = useRef(0);
  const saved = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const backoff = useRef(2500);

  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    if (inFlight.current) return inFlight.current;
    if (saved.current >= edits.current) return Promise.resolve(true);
    clearTimeout(retry.current);
    const run = async () => {
      setState('saving');
      while (saved.current < edits.current) {
        const version = edits.current;
        const body: AvailabilityPutRequest = { slots: read() };
        try {
          const res = await api<AvailabilityPutResponse>(`/groups/${groupId}/availability/me`, {
            method: 'PUT',
            body: JSON.stringify(body),
            keepalive: true,
          });
          saved.current = Math.max(saved.current, version);
          backoff.current = 2500;
          onSaved(res);
        } catch {
          setState('error');
          retry.current = setTimeout(() => void flush(), backoff.current);
          backoff.current = Math.min(backoff.current * 2, 20_000);
          return false;
        }
      }
      setState('saved');
      return true;
    };
    const p = run().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = p;
    return p;
  }, [groupId, read, onSaved]);

  const changed = useCallback(() => {
    edits.current += 1;
    setState((s) => (s === 'error' ? s : 'pending'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
  }, [flush]);

  // Save right away when the app is backgrounded or this screen closes.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && void flush();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      clearTimeout(retry.current);
      if (saved.current < edits.current) void flush();
    };
  }, [flush]);

  return { state, changed, flush };
}

function Board({ data, standalone }: { data: AvailabilityMeResponse; standalone: boolean }) {
  const { group, member } = data;
  const tz = group.tz;
  const nick = group.nickname;
  const [now] = useState(() => Date.now());
  const grid = useMemo(() => buildGrid(tz, new Date(now)), [tz, now]);
  const cells = useMemo(() => buildCells(grid, now), [grid, now]);

  const selRef = useRef<Set<string>>(
    new Set(data.slots.map((s) => normalizeSlot(s)).filter((s): s is string => Boolean(s))),
  );
  const [selected, setSelected] = useState(selRef.current);
  const [view, setView] = useState<View>('mine');
  const [counts, setCounts] = useState<Counts | null>(null);
  const [heat, setHeat] = useState<HeatmapResponse | null>(null);
  const [heatError, setHeatError] = useState<string | null>(null);
  const [heatAttempt, setHeatAttempt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);

  const read = useCallback(() => [...selRef.current].sort(), []);
  const onSaved = useCallback((res: AvailabilityPutResponse) => {
    setCounts({ responded: res.responded, team_size: res.team_size });
  }, []);
  const save = useAutosave(group.id, read, onSaved);
  const { changed, flush } = save;

  // Inside the grid a drag paints; keep Telegram from treating it as swipe-to-close.
  useEffect(() => {
    if (!tg?.isVersionAtLeast('7.7')) return;
    tg.disableVerticalSwipes?.();
    return () => tg?.enableVerticalSwipes?.();
  }, []);

  const paint = useCallback(
    (slots: string[], add: boolean) => {
      if (slots.every((s) => selRef.current.has(s) === add)) return;
      const next = new Set(selRef.current);
      for (const s of slots) {
        if (add) next.add(s);
        else next.delete(s);
      }
      selRef.current = next;
      setSelected(next);
      changed();
    },
    [changed],
  );

  // Group view: flush my latest edits first so the heatmap includes them.
  useEffect(() => {
    if (view !== 'group') return;
    let live = true;
    flush()
      .catch(() => false)
      .then(() => api<HeatmapResponse>(`/groups/${group.id}/heatmap`))
      .then((res) => {
        if (!live) return;
        setHeat(res);
        setHeatError(null);
        setCounts({ responded: res.responded, team_size: res.team_size });
      })
      .catch((e) => {
        if (live) setHeatError(e instanceof ApiError ? e.message : 'Could not load the group. Try again?');
      });
    return () => {
      live = false;
    };
  }, [view, flush, group.id, heatAttempt]);

  const switchView = (v: View) => {
    if (v === view) return;
    haptic.select();
    setPicked(null);
    setView(v);
  };

  const heatView = useMemo((): Heat | null => {
    if (!heat) return null;
    const best = heat.best[0] ? normalizeSlot(heat.best[0].start) : null;
    return {
      count: (slot: string) => {
        const ids = heat.slots[slot] ?? [];
        // My own column always reflects what I see locally.
        return ids.filter((id) => id !== member.id).length + (selected.has(slot) ? 1 : 0);
      },
      max: Math.max(heat.team_size, heat.members.length, 1),
      best,
      bestSpan: MEETING_SLOTS,
      picked,
    };
  }, [heat, member.id, selected, picked]);

  const freeAt = (slot: string) => {
    const ids = new Set((heat?.slots[slot] ?? []).filter((id) => id !== member.id));
    if (selected.has(slot)) ids.add(member.id);
    return ids;
  };

  const onPick = (slot: string) => {
    haptic.select();
    setPicked((p) => (p === slot ? null : slot));
  };

  const futureCount = useMemo(() => {
    let n = 0;
    for (const col of cells) for (const c of col) if (!c.past && selected.has(c.slot)) n++;
    return n;
  }, [cells, selected]);

  return (
    <div className={`mx-auto max-w-xl animate-enter ${picked ? 'pb-56' : 'pb-12'}`}>
      {standalone && (
        <div className="flex items-center justify-between gap-3 pr-5">
          <Header nickname={nick} title={group.title} />
          <span className="mt-3 inline-flex shrink-0 items-center gap-2 rounded-full border border-dashed border-line-strong px-3 py-1.5 text-[12px] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: member.color }} />
            <span>
              Signed link for <b className="font-semibold text-text">{member.name}</b>
            </span>
          </span>
        </div>
      )}

      <div className="px-5">
        <h1 className="mt-5 text-[28px] font-bold leading-tight tracking-tight">When are you free?</h1>
        <p className="mt-1.5 text-[15px] leading-snug text-muted">
          Drag to paint your free times. {nick} finds the hour that works for everyone.
        </p>

        <Segmented view={view} onChange={switchView} color={member.color} />

        <div className="mt-3 flex min-h-7 items-center justify-between gap-3 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Globe />
            Times in {tzLabel(tz)}
          </span>
          <SavePill state={save.state} onRetry={() => void save.flush()} />
        </div>

        {view === 'group' && (
          <BestCard heat={heat} error={heatError} onRetry={() => setHeatAttempt((a) => a + 1)} nick={nick} />
        )}
      </div>

      <div className="mt-3 pr-4 pl-1">
        <AvailabilityGrid
          grid={grid}
          cells={cells}
          now={now}
          mode={view}
          selected={selected}
          color={member.color}
          heat={view === 'group' ? heatView : null}
          onPaint={paint}
          onPick={onPick}
        />
      </div>

      <div className="px-5">
        {view === 'mine' ? (
          <div className="mt-5 flex items-center gap-3 rounded-2xl bg-panel px-4 py-3.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-ink tabular-nums"
              style={{ background: member.color }}
            >
              {member.name.slice(0, 1).toUpperCase()}
            </span>
            <p className="min-w-0 text-[14px] leading-snug">
              {futureCount > 0 ? (
                <>
                  You're free for <b>{hours(futureCount)}</b> this week.
                  <span className="block text-muted">
                    {counts ? `${counts.responded}/${counts.team_size} responded so far.` : 'Drag over a block to erase it.'}
                  </span>
                </>
              ) : (
                <>
                  Nothing painted yet.
                  <span className="block text-muted">Tap or drag across the grid to mark when you're free.</span>
                </>
              )}
            </p>
          </div>
        ) : (
          heat && <Roster heat={heat} selfId={member.id} selfResponded={selected.size > 0} />
        )}
      </div>

      {view === 'group' && picked && heat && (
        <SlotSheet
          slot={picked}
          tz={tz}
          free={freeAt(picked)}
          heat={heat}
          isBest={picked === heatView?.best}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  );
}

function Segmented({ view, onChange, color }: { view: View; onChange: (v: View) => void; color: string }) {
  const opts: { v: View; label: string }[] = [
    { v: 'mine', label: 'Mine' },
    { v: 'group', label: 'Group' },
  ];
  return (
    <div role="tablist" className="relative mt-5 grid grid-cols-2 rounded-full bg-panel p-1">
      <span
        aria-hidden
        className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full bg-text transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
        style={{ transform: view === 'group' ? 'translateX(100%)' : 'none' }}
      />
      {opts.map((o) => {
        const on = o.v === view;
        return (
          <button
            key={o.v}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.v)}
            className={`relative z-10 flex items-center justify-center gap-2 rounded-full py-2.5 text-[15px] font-semibold transition-colors duration-200 ${
              on ? 'text-ink' : 'text-muted'
            }`}
          >
            {o.v === 'mine' ? (
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
            ) : (
              <span className="flex gap-[2px]" aria-hidden>
                {[0.35, 0.65, 1].map((a) => (
                  <span key={a} className="h-2.5 w-1 rounded-full" style={{ background: LIME, opacity: a }} />
                ))}
              </span>
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SavePill({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'error') {
    return (
      <button
        onClick={() => {
          haptic.tap();
          onRetry();
        }}
        className="inline-flex animate-enter items-center gap-1.5 rounded-full bg-[#FF6B5B]/15 px-3 py-1 text-[12px] font-semibold text-[#FF6B5B] active:scale-95"
      >
        <span className="h-1.5 w-1.5 animate-shimmer rounded-full bg-[#FF6B5B]" />
        Offline, retrying
        <span className="text-text/80 underline underline-offset-2">Retry</span>
      </button>
    );
  }
  if (state === 'pending' || state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-panel px-3 py-1 text-[12px] font-semibold text-text">
        <span className="h-1.5 w-1.5 animate-shimmer rounded-full bg-text" />
        Saving...
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span
        key="saved"
        className="inline-flex animate-enter items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold"
        style={{ background: `${LIME}22`, color: LIME }}
      >
        <Check className="h-3 w-3" />
        Saved
      </span>
    );
  }
  return <span className="text-[12px] text-muted">Saves as you paint</span>;
}

function BestCard({
  heat,
  error,
  onRetry,
  nick,
}: {
  heat: HeatmapResponse | null;
  error: string | null;
  onRetry: () => void;
  nick: string;
}) {
  if (error && !heat) {
    return (
      <section className={`${card} mt-4 flex animate-enter items-center justify-between gap-4 p-4`}>
        <p className="text-[14px] leading-snug text-muted">{error}</p>
        <button
          onClick={() => {
            haptic.tap();
            onRetry();
          }}
          className="shrink-0 rounded-full bg-text px-4 py-2 text-[14px] font-semibold text-ink active:scale-[0.98]"
        >
          Try again
        </button>
      </section>
    );
  }
  if (!heat) {
    return (
      <section className={`${card} mt-4 p-4`} aria-busy="true">
        <div className="h-3 w-20 animate-shimmer rounded-full bg-line" />
        <div className="mt-3 h-5 w-56 animate-shimmer rounded-full bg-line" />
        <div className="mt-3 h-6 w-32 animate-shimmer rounded-full bg-line" />
      </section>
    );
  }
  const best = heat.best[0];
  const byId = new Map(heat.members.map((m) => [m.id, m]));
  const total = Math.max(heat.team_size, heat.members.length);
  if (!best) {
    return (
      <section className={`${card} mt-4 animate-enter p-4`}>
        <div className={label}>Best time</div>
        <p className="mt-2 text-[15px] leading-snug">
          No overlap yet. Once a few people paint their week, {nick} picks the hour.
        </p>
      </section>
    );
  }
  const free = best.member_ids.map((id) => byId.get(id)).filter((m) => m !== undefined);
  return (
    <section
      className="mt-4 animate-enter rounded-3xl border p-4"
      style={{ borderColor: `${LIME}66`, background: `linear-gradient(135deg, ${LIME}14, transparent 60%)` }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className={label}>Best time</div>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#A6E35A] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-ink">
          <Check className="h-3 w-3" />
          {free.length === total ? 'Everyone' : 'Most free'}
        </span>
      </div>
      <div className="mt-1.5 text-[20px] font-semibold leading-snug">{best.label}</div>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex -space-x-1.5">
          {free.map((m) => (
            <span
              key={m.id}
              title={m.name}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-ink ring-2 ring-ink"
              style={{ background: m.color }}
            >
              {m.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </div>
        <span className="text-[14px] text-muted">
          <b className="text-text tabular-nums">
            {best.member_ids.length}/{total}
          </b>{' '}
          free
        </span>
      </div>
    </section>
  );
}

function Roster({ heat, selfId, selfResponded }: { heat: HeatmapResponse; selfId: number; selfResponded: boolean }) {
  const max = Math.max(heat.team_size, heat.members.length, 1);
  const responded = heat.members.filter((m) => (m.id === selfId ? selfResponded : m.responded)).length;
  return (
    <section className="mt-5 animate-enter">
      <div className="flex items-center justify-between gap-3 px-1">
        <span className={label}>Responded</span>
        <span className="text-[14px] text-muted">
          <b className="text-text tabular-nums">
            {responded}/{heat.team_size}
          </b>{' '}
          so far
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {heat.members.map((m) => {
          const done = m.id === selfId ? selfResponded : m.responded;
          return done ? (
            <span
              key={m.id}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-ink"
              style={{ background: m.color }}
            >
              <Check className="h-3 w-3" />
              {m.name}
              {m.id === selfId && <span className="font-medium opacity-70">(you)</span>}
            </span>
          ) : (
            <span
              key={m.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-[13px] text-muted"
              style={{ borderColor: `${m.color}99` }}
            >
              <span className="h-2 w-2 rounded-full border border-dashed" style={{ borderColor: m.color }} />
              {m.name}
            </span>
          );
        })}
      </div>

      <div className="mt-5 flex items-center gap-3 px-1 text-[12px] text-muted">
        <span>Free</span>
        <div className="flex flex-1 gap-1">
          {Array.from({ length: max }, (_, i) => (
            <span
              key={i}
              className="flex h-5 flex-1 items-center justify-center rounded-[5px] text-[10px] font-bold tabular-nums"
              style={{
                background: `rgba(166, 227, 90, ${0.14 + 0.86 * ((i + 1) / max)})`,
                color: (i + 1) / max > 0.55 ? '#1E1E1ECC' : '#F5F5F5B3',
              }}
            >
              {i + 1}
            </span>
          ))}
        </div>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[3px] shadow-[0_0_0_2px_#F5F5F5]" />
          Best hour
        </span>
      </div>
      <p className="mt-3 px-1 text-[13px] text-muted">Tap any cell to see who's free then.</p>
    </section>
  );
}

function SlotSheet({
  slot,
  tz,
  free,
  heat,
  isBest,
  onClose,
}: {
  slot: string;
  tz: string;
  free: Set<number>;
  heat: HeatmapResponse;
  isBest: boolean;
  onClose: () => void;
}) {
  const total = Math.max(heat.team_size, heat.members.length);
  const sorted = [...heat.members].sort((a, b) => Number(free.has(b.id)) - Number(free.has(a.id)));
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(12px,env(safe-area-inset-bottom))]">
      <div
        key={slot}
        role="dialog"
        aria-label="Who's free"
        className="pointer-events-auto mx-auto max-w-xl animate-enter rounded-3xl border border-line-strong bg-panel p-4 shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={label}>Who's free</span>
              {isBest && (
                <span className="rounded-full bg-text px-1.5 py-[2px] text-[9px] leading-none font-bold tracking-wider text-ink uppercase">
                  Best
                </span>
              )}
            </div>
            <div className="mt-1 truncate text-[17px] font-semibold">{formatMeeting(slot, slotEnd(slot), tz)}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full px-2.5 py-1 text-[13px] font-bold tabular-nums text-ink" style={{ background: LIME }}>
              {free.size}/{total}
            </span>
            <button
              aria-label="Close"
              onClick={() => {
                haptic.tap();
                onClose();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[18px] text-muted active:bg-line"
            >
              ×
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {sorted.map((m) =>
            free.has(m.id) ? (
              <span key={m.id} className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1.5 text-[14px]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />
                {m.name}
              </span>
            ) : (
              <span
                key={m.id}
                className="inline-flex items-center gap-2 rounded-full border border-dashed border-line px-3 py-1.5 text-[14px] text-muted line-through decoration-line-strong"
              >
                <span className="h-2.5 w-2.5 rounded-full opacity-40" style={{ background: m.color }} />
                {m.name}
              </span>
            ),
          )}
        </div>
        {free.size === 0 && <p className="mt-3 text-[13px] text-muted">Nobody yet. A quiet half hour.</p>}
      </div>
    </div>
  );
}

function Check({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Globe() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M1.75 8h12.5M8 1.75c1.8 1.9 2.6 3.9 2.6 6.25S9.8 12.35 8 14.25C6.2 12.35 5.4 10.35 5.4 8S6.2 3.65 8 1.75z" />
    </svg>
  );
}
