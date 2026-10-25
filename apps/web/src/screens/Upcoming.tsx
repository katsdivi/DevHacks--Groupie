import { useEffect, useMemo, useState } from 'react';
import type { FeedEvent, FeedStatusResponse, FeedUpcomingResponse, MeResponse, Screen } from '@groupie/shared';
import { api, ApiError } from '../api.ts';
import { haptic, openExternal } from '../telegram.ts';
import { UpcomingSkeleton } from '../components/Skeleton.tsx';
import { ago, courseColor, CourseChip } from '../components/Course.tsx';

type Props = { me: MeResponse; go: (s: Screen) => void };
type Data = { status: FeedStatusResponse; events: FeedEvent[] };

const label = 'text-[13px] font-medium uppercase tracking-widest text-muted';
const AMBER = '#FFB547';
const CORAL = '#FF6B5B';
const SOON_MS = 48 * 60 * 60 * 1000;

/** Local calendar day key. The group has no tz on MeResponse, so days follow this device. */
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function dayLabel(d: Date, now: Date): string {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (dayKey(d) === dayKey(now)) return 'Today';
  if (dayKey(d) === dayKey(tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

const timeOf = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function untilText(ms: number): string {
  if (ms < 0) return 'Overdue';
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `In ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 24) return `In ${h} h`;
  const d = Math.floor(h / 24);
  return `In ${d}d ${h % 24}h`;
}

function KindIcon({ kind, color }: { kind: FeedEvent['kind']; color: string }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border"
      style={{ color, borderColor: `${color}55`, background: `${color}14` }}
      aria-label={kind === 'assignment' ? 'Assignment' : 'Event'}
    >
      {kind === 'assignment' ? (
        <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <path d="M5 2.75h6.5L15 6.25v11H5z" strokeLinejoin="round" />
          <path d="M11.5 2.75v3.5H15M7.75 10h4.5M7.75 13h4.5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" />
          <path d="M3 8.5h14M7 2.75v3.5M13 2.75v3.5" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

function Item({ ev, now }: { ev: FeedEvent; now: number }) {
  const due = new Date(ev.dueAt);
  const left = due.getTime() - now;
  const soon = left < SOON_MS;
  const over = left < 0;
  const accent = over ? CORAL : AMBER;
  const color = courseColor(ev.course);
  return (
    <li
      className={`rounded-3xl border p-4 ${soon ? '' : 'border-dashed border-line-strong'}`}
      style={soon ? { borderColor: `${accent}66`, background: `${accent}0B` } : undefined}
    >
      <div className="flex items-start gap-3.5">
        <KindIcon kind={ev.kind} color={color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[16px] font-semibold leading-snug">{ev.title}</div>
            {soon && (
              <span
                className="mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-ink"
                style={{ background: accent }}
              >
                {untilText(left)}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <CourseChip course={ev.course} />
            <span className="text-[13px] text-muted tabular-nums">
              {ev.kind === 'assignment' ? 'Due' : 'At'} {timeOf(due)}
            </span>
          </div>
          {ev.url && (
            <a
              href={ev.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                haptic.tap();
                openExternal(ev.url!, e);
              }}
              className="mt-3 inline-flex items-center gap-1 text-[14px] font-medium active:opacity-70"
              style={{ color }}
            >
              Open in Canvas
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M6 3.5h6.5V10M12.5 3.5L4 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function Empty({ icon, title, body, action }: { icon: string; title: string; body: string; action?: { label: string; onClick: () => void } }) {
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

export function Upcoming({ me, go }: Props) {
  const nick = me.group.nickname;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    Promise.all([api<FeedStatusResponse>('/feed/status'), api<FeedUpcomingResponse>('/feed/upcoming')])
      .then(([status, up]) => {
        if (!live) return;
        setNow(Date.now());
        setData({ status, events: up.events });
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not reach Groupie. Try again in a sec?'));
    return () => {
      live = false;
    };
  }, [attempt]);

  // Keep "In 5 h" honest if the screen stays open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const days = useMemo(() => {
    if (!data) return [];
    const today = new Date(now);
    const groups: Array<{ key: string; label: string; date: Date; events: FeedEvent[] }> = [];
    const sorted = [...data.events].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    for (const ev of sorted) {
      const d = new Date(ev.dueAt);
      const key = dayKey(d);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.events.push(ev);
      else groups.push({ key, label: dayLabel(d, today), date: d, events: [ev] });
    }
    return groups;
  }, [data, now]);

  if (error) {
    return (
      <Empty
        icon="?"
        title="Due dates got lost"
        body={error}
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
  if (!data) return <UpcomingSkeleton />;

  if (!data.status.connected) {
    return (
      <Empty
        icon="◷"
        title="Connect your calendar"
        body={`Paste your Canvas calendar link once and ${nick} lists everything you have due, across every course.`}
        action={{ label: 'Connect Canvas', onClick: () => go('canvas') }}
      />
    );
  }
  if (data.events.length === 0) {
    return (
      <Empty
        icon="✓"
        title="Nothing due. Enjoy it."
        body={`Your Canvas calendar is connected and clear. ${nick} checks again every 30 minutes.`}
        action={{ label: 'Calendar settings', onClick: () => go('canvas') }}
      />
    );
  }

  const soonCount = data.events.filter((e) => {
    const left = new Date(e.dueAt).getTime() - now;
    return left < SOON_MS;
  }).length;
  const assignments = data.events.filter((e) => e.kind === 'assignment').length;
  const courses = [...new Set(data.events.map((e) => e.course).filter((c): c is string => Boolean(c)))];

  return (
    <div className="mx-auto max-w-xl px-5 pb-12">
      <h1 className="mt-6 text-[28px] font-bold tracking-tight">Upcoming</h1>
      <p className="mt-1 text-[15px] text-muted">Everything you have due, all courses.</p>

      <section className="mt-5 rounded-3xl border border-dashed border-line-strong p-5">
        <div className="flex items-end justify-between gap-4">
          <div className="leading-none">
            <span className="text-[56px] font-bold tracking-tighter tabular-nums" style={soonCount > 0 ? { color: AMBER } : undefined}>
              {soonCount}
            </span>
            <span className="ml-2 text-[15px] font-semibold text-muted">in the next 48 hours</span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {courses.map((c) => (
            <CourseChip key={c} course={c} size="md" />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-dashed border-line pt-4 text-[13px] text-muted">
          <span className="tabular-nums">
            {assignments} {assignments === 1 ? 'assignment' : 'assignments'} · {data.events.length - assignments}{' '}
            {data.events.length - assignments === 1 ? 'event' : 'events'}
          </span>
          <button
            className="font-medium text-text active:opacity-70"
            onClick={() => {
              haptic.tap();
              go('canvas');
            }}
          >
            {data.status.lastPolledAt ? `Synced ${ago(data.status.lastPolledAt, now)}` : 'Syncing'} ›
          </button>
        </div>
      </section>

      {days.map((day) => (
        <section key={day.key} className="mt-8">
          <div className="flex items-baseline justify-between px-1">
            <span className={label} style={day.label === 'Today' ? { color: AMBER } : undefined}>
              {day.label}
            </span>
            <span className="text-[13px] text-muted tabular-nums">
              {day.events.length} {day.events.length === 1 ? 'item' : 'items'}
            </span>
          </div>
          <ul className="mt-3 space-y-3">
            {day.events.map((ev) => (
              <Item key={ev.uid} ev={ev} now={now} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
