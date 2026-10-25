import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type {
  MeResponse,
  ProgressMember,
  ProgressResponse,
  ProgressTask,
  Screen,
  TaskStatus,
  TaskStatusRequest,
  TaskStatusResponse,
} from '@groupie/shared';
import { api, ApiError } from '../api.ts';
import { haptic } from '../telegram.ts';
import { ProgressSkeleton } from '../components/Skeleton.tsx';
import { STATUS, STATUS_ORDER, StatusControl } from '../components/StatusControl.tsx';

type Props = { me: MeResponse; go: (s: Screen) => void };
type Toast = { id: number; color: string; text: string; kind: 'ok' | 'error' };

const label = 'text-[13px] font-medium uppercase tracking-widest text-muted';
const card = 'rounded-3xl border border-dashed border-line-strong';
const LIME = STATUS.done.color;
const CORAL = STATUS.stuck.color;
const AMBER = '#FFB547';

const pts = (n: number) => `${n} ${n === 1 ? 'pt' : 'pts'}`;
const tint = (hex: string, alpha: string) => `${hex}${alpha}`;
const pct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0);

/** Local copy of the server math so bars move the moment you tap. */
function recompute(p: ProgressResponse): ProgressResponse {
  const members = p.members.map((m) => {
    const points = m.tasks.reduce((s, t) => s + t.effort, 0);
    const done = m.tasks.filter((t) => t.status === 'done').reduce((s, t) => s + t.effort, 0);
    return { ...m, points, done_points: done, percent: pct(done, points) };
  });
  const total = members.reduce((s, m) => s + m.points, 0);
  const done = members.reduce((s, m) => s + m.done_points, 0);
  return { ...p, members, total_points: total, done_points: done, percent: pct(done, total) };
}

function withStatus(p: ProgressResponse, taskId: number, status: TaskStatus): ProgressResponse {
  return {
    ...p,
    members: p.members.map((m) =>
      m.tasks.some((t) => t.id === taskId)
        ? { ...m, tasks: m.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)) }
        : m,
    ),
  };
}

function statusIn(p: ProgressResponse | null, taskId: number): TaskStatus | null {
  for (const m of p?.members ?? []) for (const t of m.tasks) if (t.id === taskId) return t.status;
  return null;
}

function dueChip(days: number | null): { text: string; color: string; solid: boolean } | null {
  if (days === null) return null;
  if (days < 0) return { text: `${-days} ${days === -1 ? 'day' : 'days'} overdue`, color: CORAL, solid: true };
  if (days === 0) return { text: 'Due today', color: AMBER, solid: true };
  if (days === 1) return { text: 'Due tomorrow', color: AMBER, solid: false };
  return { text: `${days} days left`, color: days <= 3 ? AMBER : '#F5F5F5', solid: false };
}

function Check({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Round status badge on the left of my task cards. Remounts on change so it pops. */
function StatusBadge({ status }: { status: TaskStatus }) {
  const base = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full gp-pop';
  if (status === 'done') {
    return (
      <span className={`${base} text-ink`} style={{ background: LIME, boxShadow: `0 0 18px ${tint(LIME, '55')}` }}>
        <Check className="h-4 w-4" />
      </span>
    );
  }
  if (status === 'stuck') {
    return (
      <span className={`${base} text-[17px] font-black text-ink`} style={{ background: CORAL }}>
        !
      </span>
    );
  }
  if (status === 'on_track') {
    return (
      <span className={`${base} border-2`} style={{ borderColor: STATUS.on_track.color }}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS.on_track.color }} />
      </span>
    );
  }
  return <span className={`${base} border-2 border-dashed border-line-strong`} />;
}

/** Tiny status mark for teammates' task pills. */
function Dot({ status }: { status: TaskStatus }) {
  if (status === 'done') {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-ink" style={{ background: LIME }}>
        <Check className="h-2.5 w-2.5" />
      </span>
    );
  }
  if (status === 'todo') return <span className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-dashed border-line-strong" />;
  return <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: STATUS[status].color }} />;
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

const BURST = Array.from({ length: 22 }, (_, i) => {
  const angle = (i / 22) * Math.PI * 2 + (i % 2 ? 0.2 : 0);
  const dist = 90 + ((i * 37) % 70);
  return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist * 0.75 - 30, size: 6 + ((i * 5) % 6), delay: (i % 4) * 25 };
});

function Burst({ colors }: { colors: string[] }) {
  return (
    <div className="pointer-events-none absolute top-6 left-1/2 z-20" aria-hidden>
      {BURST.map((p, i) => (
        <span
          key={i}
          className="gp-burst absolute rounded-full"
          style={
            {
              width: p.size,
              height: i % 3 === 0 ? p.size * 1.8 : p.size,
              background: colors[i % colors.length],
              animationDelay: `${p.delay}ms`,
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

const MOTION = `
@keyframes gp-pop { 0% { transform: scale(.4); opacity: 0 } 60% { transform: scale(1.18); opacity: 1 } 100% { transform: scale(1) } }
@keyframes gp-burst { 0% { transform: translate(-50%, -50%) scale(1); opacity: 1 } 65% { opacity: 1 } 100% { transform: translate(calc(var(--dx) - 50%), calc(var(--dy) - 50%)) rotate(200deg) scale(.5); opacity: 0 } }
@keyframes gp-glow { 0% { box-shadow: 0 0 0 0 rgba(166,227,90,.55) } 100% { box-shadow: 0 0 0 10px rgba(166,227,90,0) } }
.gp-pop { animation: gp-pop 420ms cubic-bezier(.2,.8,.2,1) both }
.gp-burst { animation: gp-burst 1100ms cubic-bezier(.15,.7,.3,1) both }
.gp-glow { animation: gp-glow 700ms ease-out }
@media (prefers-reduced-motion: reduce) { .gp-pop, .gp-burst, .gp-glow { animation: none } .gp-burst { display: none } }
`;

export function Progress({ me, go }: Props) {
  const nick = me.group.nickname;
  const joined = Boolean(me.member);
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [party, setParty] = useState(0);

  // Last state the server confirmed, plus taps still in flight (task id -> status).
  const server = useRef<ProgressResponse | null>(null);
  const pending = useRef(new Map<number, TaskStatus>());
  const seq = useRef(new Map<number, number>());

  useEffect(() => {
    if (!joined) return;
    let live = true;
    api<ProgressResponse>(`/groups/${me.group.id}/progress`)
      .then((res) => {
        if (!live) return;
        server.current = res;
        setData(res);
      })
      .catch((e) => {
        if (live) setLoadError(e instanceof ApiError ? e.message : `Could not reach ${nick}. Try again in a sec?`);
      });
    return () => {
      live = false;
    };
  }, [me.group.id, joined, attempt]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 6000 : 3800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!party) return;
    const t = setTimeout(() => setParty(0), 1400);
    return () => clearTimeout(t);
  }, [party]);

  const overlay = useCallback((base: ProgressResponse) => {
    let next = base;
    for (const [id, s] of pending.current) next = withStatus(next, id, s);
    return recompute(next);
  }, []);

  const change = useCallback(
    (task: ProgressTask, status: TaskStatus) => {
      if (!data) return;
      const mine = data.members.find((m) => m.is_me);
      const allDoneBefore = Boolean(mine && mine.tasks.length > 0 && mine.tasks.every((t) => t.status === 'done'));
      const n = (seq.current.get(task.id) ?? 0) + 1;
      seq.current.set(task.id, n);
      pending.current.set(task.id, status);

      haptic.select();
      const next = recompute(withStatus(data, task.id, status));
      setData(next);

      const meNext = next.members.find((m) => m.is_me);
      const allDone = Boolean(meNext && meNext.tasks.length > 0 && meNext.tasks.every((t) => t.status === 'done'));
      if (status === 'done') haptic.success();
      if (allDone && !allDoneBefore) setParty(Date.now());

      const body: TaskStatusRequest = { status };
      api<TaskStatusResponse>(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        .then((res) => {
          if (seq.current.get(task.id) !== n) return;
          pending.current.delete(task.id);
          server.current = res.progress;
          setData(overlay(res.progress));
          setToast({
            id: Date.now(),
            kind: 'ok',
            color: STATUS[status].color === STATUS.todo.color ? '#F5F5F5' : STATUS[status].color,
            text:
              allDone && !allDoneBefore
                ? `Every one of your tasks is done. ${nick} is losing it. Fresh card heading to the group.`
                : status === 'stuck'
                  ? `Flagged. The team sees you could use a hand on the next progress card.`
                  : status === 'done'
                    ? `${task.title} is done. ${nick} posts a fresh progress card in the group.`
                    : `Saved. ${nick} posts a fresh progress card in the group.`,
          });
        })
        .catch((e) => {
          if (seq.current.get(task.id) !== n) return;
          pending.current.delete(task.id);
          haptic.error();
          const was = statusIn(server.current, task.id) ?? task.status;
          setData((d) => (d ? recompute(withStatus(d, task.id, was)) : d));
          setToast({
            id: Date.now(),
            kind: 'error',
            color: CORAL,
            text: e instanceof ApiError ? e.message : 'Could not save that. Check your connection and try again?',
          });
        });
    },
    [data, nick, overlay],
  );

  if (!joined) {
    return (
      <Blocked
        icon="✦"
        title="Add your details first"
        body={`${nick} tracks progress per person. Add your details and your tasks show up here.`}
        action={{ label: 'Add my details', onClick: () => go('form') }}
      />
    );
  }
  if (loadError) {
    return (
      <Blocked
        icon="?"
        title="Progress got lost"
        body={loadError}
        action={{
          label: 'Try again',
          onClick: () => {
            setLoadError(null);
            setAttempt((a) => a + 1);
          },
        }}
      />
    );
  }
  if (!data) return <ProgressSkeleton />;

  const taskCount = data.members.reduce((s, m) => s + m.tasks.length, 0);
  if (taskCount === 0) {
    return (
      <Blocked
        icon="◔"
        title="Nothing to track yet"
        body={`${nick} starts tracking the moment the work is split. Once everyone joins, your tasks land here.`}
        action={{ label: 'See the split', onClick: () => go('split') }}
      />
    );
  }

  const mine = data.members.find((m) => m.is_me) ?? null;
  const others = data.members.filter((m) => !m.is_me);
  const ordered = mine ? [mine, ...others] : others;
  const title = data.assignment_title ?? me.group.assignment_title ?? 'Your assignment';
  const chip = dueChip(data.days_left);
  const counts = STATUS_ORDER.map((s) => ({
    s,
    n: data.members.reduce((c, m) => c + m.tasks.filter((t) => t.status === s).length, 0),
  }));
  const stuck = others.flatMap((m) => m.tasks.filter((t) => t.status === 'stuck').map((t) => ({ m, t })));
  const myAllDone = Boolean(mine && mine.tasks.length > 0 && mine.tasks.every((t) => t.status === 'done'));
  const teamDone = data.total_points > 0 && data.done_points >= data.total_points;

  return (
    <div className={`mx-auto max-w-xl animate-enter px-5 ${toast ? 'pb-36' : 'pb-12'}`}>
      <style>{MOTION}</style>
      <h1 className="mt-6 text-[28px] font-bold tracking-tight">Progress</h1>

      <section className={`${card} mt-5 p-5`}>
        <div className="flex items-center justify-between gap-3">
          <div className={label}>Assignment</div>
          {chip && (
            <span
              className="shrink-0 rounded-full border px-3 py-1 text-[12px] font-bold uppercase tracking-wider"
              style={
                chip.solid
                  ? { background: chip.color, borderColor: chip.color, color: '#1E1E1E' }
                  : { borderColor: tint(chip.color, '66'), color: chip.color }
              }
            >
              {chip.text}
            </span>
          )}
        </div>
        <div className="mt-2 text-[21px] font-semibold leading-snug">{title}</div>

        <div className="mt-5 flex items-end justify-between gap-4">
          <div className="leading-none">
            <span className="text-[64px] font-bold tracking-tighter tabular-nums">{data.percent}</span>
            <span className="ml-1 text-[26px] font-semibold text-muted">%</span>
          </div>
          <div className="pb-2 text-right text-[14px] leading-snug text-muted">
            <b className="text-[17px] text-text tabular-nums">
              {data.done_points} of {data.total_points}
            </b>
            <span className="block">{teamDone ? 'points done. Ship it.' : 'points done'}</span>
          </div>
        </div>

        <div className="mt-4 flex h-3.5 gap-[3px] overflow-hidden rounded-full bg-line/60" title={`${data.percent}% done`}>
          {ordered.map((m) =>
            m.done_points > 0 ? (
              <div
                key={m.id}
                className="h-full origin-left animate-grow rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${(m.done_points / Math.max(1, data.total_points)) * 100}%`, background: m.color }}
                title={`${m.name}: ${pts(m.done_points)} done`}
              />
            ) : null,
          )}
        </div>

        <div className="mt-5 grid grid-cols-4 gap-2 border-t border-dashed border-line pt-4">
          {counts.map(({ s, n }) => (
            <div key={s} className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Dot status={s} />
                <b className="text-[18px] leading-none font-bold tabular-nums">{n}</b>
              </div>
              <div className="mt-1 truncate text-[12px] text-muted">{STATUS[s].label}</div>
            </div>
          ))}
        </div>
      </section>

      {mine && (
        <section className="relative mt-8">
          {party > 0 && <Burst key={party} colors={[LIME, mine.color, STATUS.on_track.color, '#F5F5F5', AMBER]} />}
          <div className="flex items-baseline justify-between px-1">
            <span className={label}>My tasks</span>
            <span className="text-[13px] text-muted tabular-nums">
              {mine.done_points} of {pts(mine.points)} ·{' '}
              <b className="font-bold" style={{ color: mine.color }}>
                {mine.percent}%
              </b>
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-line/60">
            <div
              className="h-full origin-left animate-grow rounded-full transition-[width] duration-700 ease-out"
              style={{ width: `${mine.percent}%`, background: mine.color }}
            />
          </div>

          {myAllDone && (
            <div
              key={party || 'done'}
              className="gp-glow mt-4 flex animate-enter items-center gap-3 rounded-2xl px-4 py-3.5"
              style={{ background: tint(LIME, '1A'), border: `1px solid ${tint(LIME, '66')}` }}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink" style={{ background: LIME }}>
                <Check className="h-4 w-4" />
              </span>
              <p className="text-[15px] leading-snug">
                <b>All yours are done.</b> <span className="text-muted">Go check on the team, or take a victory lap.</span>
              </p>
            </div>
          )}

          {mine.tasks.length > 0 ? (
            <div className="mt-4 space-y-3">
              {mine.tasks.map((t) => (
                <MyTask key={t.id} task={t} onChange={(s) => change(t, s)} />
              ))}
            </div>
          ) : (
            <p className={`${card} mt-4 px-5 py-5 text-[15px] text-muted`}>
              Nothing on your plate yet. Enjoy it while it lasts.
            </p>
          )}
        </section>
      )}

      {others.length > 0 && (
        <section className="mt-9">
          <div className="flex items-baseline justify-between px-1">
            <span className={label}>Team</span>
            <span className="text-[13px] text-muted">
              {others.length} {others.length === 1 ? 'teammate' : 'teammates'}
            </span>
          </div>

          {stuck.length > 0 && (
            <div
              className="mt-3 rounded-3xl border p-4"
              style={{ borderColor: tint(CORAL, '88'), background: tint(CORAL, '12') }}
            >
              <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-widest" style={{ color: CORAL }}>
                <span className="flex h-4 w-4 items-center justify-center rounded-full text-[11px] font-black text-ink" style={{ background: CORAL }}>
                  !
                </span>
                Needs a hand
              </div>
              <ul className="mt-3 space-y-2.5">
                {stuck.map(({ m, t }) => (
                  <li key={t.id} className="flex items-start gap-3 text-[15px] leading-snug">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: m.color }} />
                    <span>
                      <b style={{ color: m.color }}>{m.name}</b> is stuck on <b>{t.title}</b>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 space-y-3">
            {others.map((m) => (
              <Teammate key={m.id} member={m} />
            ))}
          </div>
        </section>
      )}

      <p className="mt-7 text-center text-[13px] text-muted">
        Changes post a fresh progress card in the group.
      </p>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto mx-auto flex max-w-xl animate-enter items-start gap-3 rounded-2xl border bg-panel px-4 py-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
            style={{ borderColor: tint(toast.color, '88') }}
            onClick={() => setToast(null)}
          >
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-black text-ink"
              style={{ background: toast.color }}
            >
              {toast.kind === 'error' ? '!' : <Check className="h-3 w-3" />}
            </span>
            <p className="text-[14px] leading-snug">{toast.text}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function MyTask({ task, onChange }: { task: ProgressTask; onChange: (s: TaskStatus) => void }) {
  const s = task.status;
  const accent = s === 'todo' ? null : STATUS[s].color;
  return (
    <article
      className={`rounded-3xl border p-4 transition-[border-color,background-color] duration-300 ${
        accent ? 'border-solid' : 'border-dashed border-line-strong'
      }`}
      style={accent ? { borderColor: tint(accent, s === 'done' ? '99' : '77'), background: tint(accent, '0F') } : undefined}
    >
      <div className="flex items-center gap-3.5">
        <StatusBadge key={s} status={s} />
        <div className="min-w-0 flex-1">
          <div
            className={`text-[16px] font-medium leading-snug transition-colors duration-300 ${
              s === 'done' ? 'text-muted line-through decoration-2' : ''
            }`}
            style={s === 'done' ? { textDecorationColor: tint(LIME, 'AA') } : undefined}
          >
            {task.title}
          </div>
          <div className="mt-0.5 text-[13px]" style={{ color: accent ?? '#9A9A9A' }}>
            {STATUS[s].label}
          </div>
        </div>
        <span className="shrink-0 text-right leading-none">
          <span className="text-[22px] font-bold tabular-nums">{task.effort}</span>
          <span className="ml-1 text-[12px] text-muted">{task.effort === 1 ? 'pt' : 'pts'}</span>
        </span>
      </div>
      <div className="mt-3.5">
        <StatusControl value={s} onChange={onChange} label={`Status of ${task.title}`} />
      </div>
    </article>
  );
}

function Teammate({ member }: { member: ProgressMember }) {
  const hasStuck = member.tasks.some((t) => t.status === 'stuck');
  return (
    <article className={`${card} p-5`} style={hasStuck ? { borderColor: tint(CORAL, '66') } : undefined}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: member.color }} />
          <span className="min-w-0">
            <span className="block truncate text-[17px] font-semibold leading-tight">{member.name}</span>
            <span className="block text-[13px] text-muted tabular-nums">
              {member.done_points} of {pts(member.points)}
            </span>
          </span>
        </div>
        <div className="shrink-0 leading-none">
          <span className="text-[28px] font-bold tabular-nums tracking-tight">{member.percent}</span>
          <span className="ml-0.5 text-[14px] text-muted">%</span>
        </div>
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-line/60">
        <div
          className="h-full origin-left animate-grow rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${member.percent}%`, background: member.color }}
        />
      </div>

      {member.tasks.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {member.tasks.map((t) => {
            const stuck = t.status === 'stuck';
            return (
              <span
                key={t.id}
                className={`inline-flex max-w-full items-center gap-2 rounded-full border py-1.5 pr-3 pl-2 text-[13px] leading-tight ${
                  stuck ? 'border-solid font-medium' : 'border-dashed border-line-strong'
                } ${t.status === 'done' ? 'text-muted' : ''}`}
                style={stuck ? { borderColor: CORAL, background: tint(CORAL, '1F') } : undefined}
                title={`${t.title}: ${STATUS[t.status].label}`}
              >
                <Dot status={t.status} />
                <span className="min-w-0 truncate">{t.title}</span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 text-[14px] text-muted">Nothing assigned. Lucky them.</p>
      )}
    </article>
  );
}
