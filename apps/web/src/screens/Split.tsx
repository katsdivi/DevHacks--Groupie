import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { MeResponse, Screen, SplitMemberView, SplitResponse, SplitTaskView, SwapResponse } from '@groupie/shared';
import { api, ApiError } from '../api.ts';
import { haptic, tg } from '../telegram.ts';
import { useMainButton } from '../useMainButton.ts';
import { SplitSkeleton } from '../components/Skeleton.tsx';

type Props = { me: MeResponse; go: (s: Screen) => void };
type Step = 'view' | 'task' | 'member';
type Toast = { color: string; text: string };

const label = 'text-[13px] font-medium uppercase tracking-widest text-muted';
const card = 'rounded-3xl border border-dashed border-line-strong';

const pts = (n: number) => `${n} ${n === 1 ? 'pt' : 'pts'}`;
const short = (s: string, max = 30) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const tint = (hex: string, alpha: string) => `${hex}${alpha}`;

function formatDue(due: string | null) {
  if (!due) return null;
  const d = new Date(`${due}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Max minus min points after moving `effort` points from one member to another. */
function gapAfter(members: SplitMemberView[], fromId: number, toId: number, effort: number) {
  const totals = members.map((m) => m.points + (m.id === toId ? effort : 0) - (m.id === fromId ? effort : 0));
  return Math.max(...totals) - Math.min(...totals);
}

function Check({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Radio({ on, color }: { on: boolean; color: string }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-150 ${
        on ? 'border-transparent text-ink' : 'border-dashed border-line-strong text-transparent'
      }`}
      style={on ? { background: color } : undefined}
    >
      <Check className="h-3.5 w-3.5" />
    </span>
  );
}

function TaskPill({ task, color, ring }: { task: SplitTaskView; color: string; ring: string | null }) {
  return (
    <span
      id={`task-${task.id}`}
      className={`inline-flex max-w-full items-center gap-2 rounded-full border border-dashed border-line-strong py-1.5 pr-1.5 pl-3.5 text-[14px] leading-tight transition-shadow duration-500 ${
        ring ? 'animate-enter' : ''
      }`}
      style={ring ? { boxShadow: `0 0 0 2px ${ring}, 0 0 24px ${tint(ring, '55')}`, borderColor: 'transparent' } : undefined}
    >
      <span className="min-w-0 truncate">{task.title}</span>
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums text-ink"
        style={{ background: color }}
      >
        {task.effort}
      </span>
    </span>
  );
}

function MemberCard({
  member,
  maxPoints,
  ringTask,
}: {
  member: SplitMemberView;
  maxPoints: number;
  ringTask: { id: number; color: string } | null;
}) {
  const pct = maxPoints > 0 ? (member.points / maxPoints) * 100 : 0;
  return (
    <article
      className={`${card} p-5 transition-colors duration-500`}
      style={member.is_me ? { borderColor: tint(member.color, '99') } : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: member.color }} />
          <span className="truncate text-[18px] font-semibold">{member.name}</span>
          {member.is_me && (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-ink"
              style={{ background: member.color }}
            >
              You
            </span>
          )}
        </div>
        <div className="shrink-0 text-right leading-none">
          <span className="text-[30px] font-bold tabular-nums tracking-tight">{member.points}</span>
          <span className="ml-1 text-[13px] text-muted">{member.points === 1 ? 'pt' : 'pts'}</span>
        </div>
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-line/60">
        <div
          className="h-full origin-left animate-grow rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, background: member.color }}
        />
      </div>

      {member.tasks.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {member.tasks.map((t) => (
            <TaskPill key={t.id} task={t} color={member.color} ring={ringTask?.id === t.id ? ringTask.color : null} />
          ))}
        </div>
      ) : (
        <p className="mt-4 text-[14px] text-muted">Nothing yet. Lucky them.</p>
      )}
    </article>
  );
}

export function Split({ me, go }: Props) {
  const nick = me.group.nickname;
  const [data, setData] = useState<SplitResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState<Step>('view');
  const [taskId, setTaskId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [ring, setRing] = useState<{ id: number; color: string } | null>(null);

  useEffect(() => {
    let live = true;
    api<SplitResponse>(`/groups/${me.group.id}/split`)
      .then((res) => live && setData(res))
      .catch((e) => {
        if (live) setLoadError(e instanceof ApiError ? e.message : 'Could not reach Groupie. Try again in a sec?');
      });
    return () => {
      live = false;
    };
  }, [me.group.id, attempt]);

  useEffect(() => {
    if (!ring) return;
    const t = setTimeout(() => setRing(null), 2600);
    return () => clearTimeout(t);
  }, [ring]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(t);
  }, [toast]);

  const mine = data?.members.find((m) => m.is_me) ?? null;
  const others = data?.members.filter((m) => !m.is_me) ?? [];
  const members = mine ? [mine, ...others] : others;
  const hasSplit = Boolean(data?.members.some((m) => m.tasks.length > 0));
  const canSwap = Boolean(me.member && mine && mine.tasks.length > 0);
  const picked = mine?.tasks.find((t) => t.id === taskId) ?? null;
  const target = others.find((m) => m.id === toId) ?? null;

  const cancel = useCallback(() => {
    haptic.tap();
    setStep('view');
    setTaskId(null);
    setToId(null);
    setSwapError(null);
  }, []);

  const swap = useCallback(async () => {
    if (!picked || swapping) return;
    setSwapping(true);
    setSwapError(null);
    try {
      const res = await api<SwapResponse>(`/groups/${me.group.id}/swap`, {
        method: 'POST',
        body: JSON.stringify({ task_id: picked.id, to_member_id: toId }),
      });
      haptic.success();
      const { moved, ...split } = res;
      setData(split);
      setStep('view');
      setTaskId(null);
      setToId(null);
      if (moved) {
        const owner = res.members.find((m) => m.id === moved.to_member_id);
        const task = res.members.flatMap((m) => m.tasks).find((t) => t.id === moved.task_id);
        const color = owner?.color ?? '#F5F5F5';
        setRing({ id: moved.task_id, color });
        setToast({
          color,
          text: `Done. ${task?.title ?? picked.title} went to ${owner?.name ?? 'a teammate'}. Max difference is now ${pts(res.max_gap)}. A fresh card is in the group chat.`,
        });
        requestAnimationFrame(() =>
          document.getElementById(`task-${moved.task_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        );
      } else {
        setToast({ color: '#F5F5F5', text: `${nick} looked and this split is already the fairest one. Nothing moved.` });
      }
    } catch (e) {
      haptic.error();
      setSwapError(e instanceof ApiError ? e.message : 'Could not request the swap. Try again?');
    } finally {
      setSwapping(false);
    }
  }, [picked, swapping, toId, me.group.id, nick]);

  const onMain = useCallback(() => {
    if (step === 'view') {
      haptic.tap();
      setToast(null);
      setStep('task');
      window.scrollTo({ top: 0 });
    } else if (step === 'task') {
      if (!picked) return;
      haptic.tap();
      setStep('member');
      window.scrollTo({ top: 0 });
    } else {
      swap();
    }
  }, [step, picked, swap]);

  const mainText =
    step === 'view' ? 'Request swap' : step === 'task' ? (picked ? 'Next: who takes it' : 'Pick a task') : `Swap ${short(picked?.title ?? '')}`;
  const native = useMainButton({
    text: mainText,
    onClick: onMain,
    enabled: step === 'task' ? Boolean(picked) : true,
    loading: swapping,
    visible: Boolean(data) && hasSplit && canSwap,
  });

  if (loadError) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center px-8 pt-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-line-strong text-[26px] text-muted">
          ?
        </div>
        <h1 className="mt-6 text-[24px] font-bold tracking-tight">The split got lost</h1>
        <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-muted">{loadError}</p>
        <button
          className="mt-8 min-h-11 rounded-full bg-text px-7 py-3 text-[15px] font-semibold text-ink active:scale-[0.98]"
          onClick={() => {
            haptic.tap();
            setLoadError(null);
            setAttempt((a) => a + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!data) return <SplitSkeleton />;

  const title = data.assignment_title ?? me.group.assignment_title ?? 'Your assignment';
  const due = formatDue(data.due_date);

  // Before the split runs: show who we're waiting on and what's up for grabs.
  if (!hasSplit) {
    const size = me.group.team_size ?? Math.max(data.members.length, me.group.joined);
    const joined = Math.min(me.group.joined, size);
    const unassignedPts = data.unassigned.reduce((s, t) => s + t.effort, 0);
    return (
      <div className="mx-auto max-w-xl px-5 pb-12">
        <h1 className="mt-6 text-[28px] font-bold tracking-tight">The split</h1>
        <section className={`${card} mt-6 p-6 text-center`}>
          <div className="flex justify-center gap-2.5">
            {Array.from({ length: size }, (_, i) => {
              const m = data.members[i];
              return i < joined ? (
                <span key={i} className="h-9 w-9 animate-enter rounded-full" style={{ background: m?.color ?? '#F5F5F5' }} />
              ) : (
                <span key={i} className="h-9 w-9 rounded-full border-2 border-dashed border-line-strong" />
              );
            })}
          </div>
          <p className="mx-auto mt-6 max-w-xs text-[18px] font-semibold leading-snug">
            {nick} splits the work as soon as everyone joins.
          </p>
          <p className="mt-2 text-[15px] text-muted">
            <b className="text-text tabular-nums">
              {joined}/{size}
            </b>{' '}
            joined
          </p>
          {!me.member && (
            <button
              className="mt-6 w-full rounded-full bg-text py-3.5 text-[16px] font-semibold text-ink active:scale-[0.98]"
              onClick={() => {
                haptic.tap();
                go('form');
              }}
            >
              Add my details
            </button>
          )}
          {me.member && tg && (
            <button
              className="mt-6 min-h-11 w-full rounded-full border border-dashed border-line-strong py-3 text-[15px] font-semibold active:scale-[0.98]"
              onClick={() => {
                haptic.tap();
                tg?.close();
              }}
            >
              Back to the group
            </button>
          )}
        </section>

        {data.unassigned.length > 0 && (
          <>
            <div className="mt-8 flex items-baseline justify-between px-1">
              <span className={label}>Up for grabs</span>
              <span className="text-[13px] text-muted tabular-nums">
                {data.unassigned.length} tasks · {pts(unassignedPts)}
              </span>
            </div>
            <ul className={`${card} mt-3 divide-y divide-dashed divide-line overflow-hidden`}>
              {data.unassigned.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <span className="min-w-0">
                    <span className="block text-[16px] leading-snug">{t.title}</span>
                    {t.description && <span className="mt-0.5 block truncate text-[13px] text-muted">{t.description}</span>}
                  </span>
                  <span className="shrink-0 text-right leading-none">
                    <span className="text-[22px] font-bold tabular-nums">{t.effort}</span>
                    <span className="ml-1 text-[12px] text-muted">{t.effort === 1 ? 'pt' : 'pts'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  const maxPoints = Math.max(1, ...data.members.map((m) => m.points));

  if (step === 'task' && mine) {
    return (
      <div key="task" className="mx-auto max-w-xl animate-enter px-5 pb-12">
        <FlowHead step={1} title="Which task do you want to hand off?" onCancel={cancel} color={mine.color} />
        <div className="mt-6 space-y-2.5">
          {mine.tasks.map((t) => {
            const on = t.id === taskId;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  haptic.select();
                  setTaskId(on ? null : t.id);
                }}
                className={`flex w-full items-center gap-4 rounded-2xl border px-4 py-4 text-left transition-all duration-150 active:scale-[0.99] ${
                  on ? 'border-solid' : 'border-dashed border-line-strong'
                }`}
                style={on ? { borderColor: mine.color, background: tint(mine.color, '14') } : undefined}
              >
                <Radio on={on} color={mine.color} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-medium leading-snug">{t.title}</span>
                  {t.description && <span className="mt-0.5 block truncate text-[13px] text-muted">{t.description}</span>}
                </span>
                <span className="shrink-0 text-right leading-none">
                  <span className="text-[24px] font-bold tabular-nums" style={on ? { color: mine.color } : undefined}>
                    {t.effort}
                  </span>
                  <span className="ml-1 text-[12px] text-muted">{t.effort === 1 ? 'pt' : 'pts'}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-5 px-1 text-[14px] leading-relaxed text-muted">
          You're on <b className="text-text">{pts(mine.points)}</b> right now. Pick one and {nick} finds it a new home.
        </p>
        {!native && (
          <button
            disabled={!picked}
            onClick={onMain}
            className="mt-8 w-full rounded-full bg-text py-4 text-[16px] font-semibold text-ink active:scale-[0.98] disabled:bg-line disabled:text-muted"
          >
            {mainText}
          </button>
        )}
      </div>
    );
  }

  if (step === 'member' && mine && picked) {
    const preview = target ? gapAfter(data.members, mine.id, target.id, picked.effort) : null;
    return (
      <div key="member" className="mx-auto max-w-xl animate-enter px-5 pb-12">
        <FlowHead step={2} title="Who should take it?" onCancel={cancel} color={mine.color} />

        <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-panel px-4 py-3">
          <span className="min-w-0">
            <span className="block text-[12px] font-medium uppercase tracking-widest text-muted">Handing off</span>
            <span className="block truncate text-[15px] font-medium">{picked.title}</span>
          </span>
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-bold tabular-nums text-ink"
            style={{ background: mine.color }}
          >
            {pts(picked.effort)}
          </span>
        </div>

        <div className="mt-5 space-y-2.5">
          <PickRow
            on={toId === null}
            color="#F5F5F5"
            onPick={() => setToId(null)}
            dot={
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-line-strong text-[15px]">
                ✦
              </span>
            }
            title={`Anyone, let ${nick} decide`}
            sub="Goes to whoever keeps it fairest"
          />
          {others.map((m) => (
            <PickRow
              key={m.id}
              on={toId === m.id}
              color={m.color}
              onPick={() => setToId(m.id)}
              dot={<span className="h-9 w-9 shrink-0 rounded-full" style={{ background: m.color }} />}
              title={m.name}
              sub={toId === m.id ? `${m.points} now, ${m.points + picked.effort} with this` : `${m.tasks.length} ${m.tasks.length === 1 ? 'task' : 'tasks'}`}
              points={m.points}
            />
          ))}
        </div>

        <p className="mt-5 min-h-[1.5em] px-1 text-[14px] text-muted">
          {preview !== null ? (
            <>
              Max difference after: <b className={preview > data.max_gap ? 'text-[#FFB547]' : 'text-text'}>{pts(preview)}</b>
              {preview > data.max_gap && ' (a bit less even)'}
            </>
          ) : (
            <>Your teammate gets a heads up in the group chat.</>
          )}
        </p>

        {swapError && <p className="mt-4 animate-enter px-1 text-[15px] text-[#FF6B5B]">{swapError}</p>}

        {!native && (
          <button
            disabled={swapping}
            onClick={onMain}
            className="mt-8 w-full rounded-full bg-text py-4 text-[16px] font-semibold text-ink active:scale-[0.98] disabled:bg-line disabled:text-muted"
          >
            {swapping ? 'Swapping...' : mainText}
          </button>
        )}
      </div>
    );
  }

  return (
    <div key="view" className={`mx-auto max-w-xl animate-enter px-5 ${toast ? 'pb-36' : 'pb-12'}`}>
      <h1 className="mt-6 text-[28px] font-bold tracking-tight">The split</h1>

      <section className={`${card} mt-5 p-5`}>
        <div className="flex items-center justify-between gap-3">
          <div className={label}>Assignment</div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#A6E35A] px-3 py-1 text-[12px] font-bold uppercase tracking-wider text-ink">
            <Check className="h-3 w-3" />
            Fair split
          </span>
        </div>
        <div className="mt-2 text-[21px] font-semibold leading-snug">{title}</div>
        {due && <div className="mt-1 text-[14px] text-muted">Due {due}</div>}

        <div className="mt-5 flex h-3 gap-1 overflow-hidden rounded-full">
          {members.map((m) => (
            <div
              key={m.id}
              className="h-full origin-left animate-grow rounded-full transition-[flex-grow] duration-700 ease-out"
              style={{ flexGrow: Math.max(m.points, 0.5), flexBasis: 0, background: m.color }}
              title={`${m.name}: ${pts(m.points)}`}
            />
          ))}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <div>
            <div className="text-[12px] font-medium uppercase tracking-widest text-muted">Max difference</div>
            <div className="mt-1 text-[28px] font-bold leading-none tabular-nums">
              {data.max_gap}
              <span className="ml-1 text-[14px] font-medium text-muted">{data.max_gap === 1 ? 'pt' : 'pts'}</span>
            </div>
          </div>
          <div>
            <div className="text-[12px] font-medium uppercase tracking-widest text-muted">Total</div>
            <div className="mt-1 text-[28px] font-bold leading-none tabular-nums">
              {data.total_points}
              <span className="ml-1 text-[14px] font-medium text-muted">pts</span>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-8 px-1">
        <span className={label}>Who's doing what</span>
      </div>
      <div className="mt-3 space-y-3">
        {members.map((m) => (
          <MemberCard key={m.id} member={m} maxPoints={maxPoints} ringTask={ring} />
        ))}
      </div>

      {canSwap && mine && (
        <section className={`${card} mt-6 p-5`}>
          <div className="flex items-center gap-3">
            <span className="text-[22px]" aria-hidden>
              ⇄
            </span>
            <div>
              <div className="text-[16px] font-semibold">Not feeling a task?</div>
              <p className="text-[14px] leading-snug text-muted">Hand it off. {nick} rebalances and posts a fresh card.</p>
            </div>
          </div>
          {!native && (
            <button
              onClick={onMain}
              className="mt-5 w-full rounded-full bg-text py-3.5 text-[16px] font-semibold text-ink active:scale-[0.98]"
            >
              Request swap
            </button>
          )}
        </section>
      )}

      {!me.member && (
        <section className={`${card} mt-6 p-5 text-center`}>
          <p className="text-[15px] text-muted">Watching from the sidelines? Add your details to get a color.</p>
          <button
            className="mt-4 w-full rounded-full bg-text py-3.5 text-[16px] font-semibold text-ink active:scale-[0.98]"
            onClick={() => {
              haptic.tap();
              go('form');
            }}
          >
            Add my details
          </button>
        </section>
      )}

      <p className="mt-6 text-center text-[13px] text-muted">Split by {nick}</p>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          <div
            role="status"
            className="pointer-events-auto mx-auto flex max-w-xl animate-enter items-start gap-3 rounded-2xl border bg-panel px-4 py-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
            style={{ borderColor: tint(toast.color, '88') }}
            onClick={() => setToast(null)}
          >
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink"
              style={{ background: toast.color }}
            >
              <Check className="h-3 w-3" />
            </span>
            <p className="text-[14px] leading-snug">{toast.text}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function FlowHead({ step, title, onCancel, color }: { step: 1 | 2; title: string; onCancel: () => void; color: string }) {
  return (
    <>
      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {[1, 2].map((n) => (
            <span
              key={n}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{ width: n === step ? 28 : 12, background: n <= step ? color : '#3A3A3A' }}
            />
          ))}
          <span className="ml-1 text-[13px] font-medium uppercase tracking-widest text-muted">Step {step} of 2</span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="-mr-2 min-h-11 rounded-full px-3 py-1.5 text-[15px] font-medium text-muted active:bg-panel"
        >
          Cancel
        </button>
      </div>
      <h1 className="mt-4 text-[26px] font-bold leading-tight tracking-tight">{title}</h1>
    </>
  );
}

function PickRow({
  on,
  color,
  onPick,
  dot,
  title,
  sub,
  points,
}: {
  on: boolean;
  color: string;
  onPick: () => void;
  dot: ReactNode;
  title: string;
  sub: string;
  points?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        haptic.select();
        onPick();
      }}
      className={`flex w-full items-center gap-4 rounded-2xl border px-4 py-3.5 text-left transition-all duration-150 active:scale-[0.99] ${
        on ? 'border-solid' : 'border-dashed border-line-strong'
      }`}
      style={on ? { borderColor: color, background: tint(color, '14') } : undefined}
    >
      {dot}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-medium">{title}</span>
        <span className="block truncate text-[13px] text-muted">{sub}</span>
      </span>
      {points !== undefined && (
        <span className="shrink-0 text-right leading-none">
          <span className="text-[20px] font-bold tabular-nums">{points}</span>
          <span className="ml-1 text-[12px] text-muted">{points === 1 ? 'pt' : 'pts'}</span>
        </span>
      )}
      <Radio on={on} color={color} />
    </button>
  );
}
