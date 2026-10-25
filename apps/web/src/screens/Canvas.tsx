import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  isAllowedFeedUrl,
  normalizeFeedUrl,
  type FeedPutRequest,
  type FeedStatusResponse,
  type ImportStatus,
  type Member,
  type MeResponse,
  type PairCodeRequest,
  type PairCodeResponse,
  type PairCodeStatusResponse,
  type Screen,
  type WorkloadRequest,
  type WorkloadResponse,
} from '@groupie/shared';
import { api, ApiError } from '../api.ts';
import { haptic, openExternal } from '../telegram.ts';
import { FeedStatusSkeleton } from '../components/Skeleton.tsx';
import { ago, CourseChip } from '../components/Course.tsx';

type Props = { me: MeResponse; go: (s: Screen) => void; onMember?: (m: Member) => void };

const label = 'text-[13px] font-medium uppercase tracking-widest text-muted';
const card = 'rounded-3xl border border-dashed border-line-strong';
const primary =
  'w-full rounded-full bg-text py-3.5 text-[16px] font-semibold text-ink transition-transform active:scale-[0.98] disabled:opacity-50';
const secondary =
  'rounded-full border border-dashed border-line-strong px-5 py-2.5 text-[15px] font-medium transition-transform active:scale-[0.98] disabled:opacity-50';
const LIME = '#A6E35A';
const CYAN = '#4FD8E8';
const CORAL = '#FF6B5B';
const AMBER = '#FFB547';
const POLL_MS = 2500;
const TERMINAL: ImportStatus[] = ['imported', 'failed', 'expired'];

const MOTION = `
@keyframes cv-pulse { 0% { box-shadow: 0 0 0 0 rgba(79,216,232,.5) } 100% { box-shadow: 0 0 0 9px rgba(79,216,232,0) } }
@keyframes cv-pop { 0% { transform: scale(.4); opacity: 0 } 60% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1) } }
@keyframes cv-rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
.cv-pulse { animation: cv-pulse 1.4s ease-out infinite }
.cv-pop { animation: cv-pop 460ms cubic-bezier(.2,.8,.2,1) both }
.cv-rise { animation: cv-rise 360ms cubic-bezier(.2,.8,.2,1) both }
@media (prefers-reduced-motion: reduce) { .cv-pulse, .cv-pop, .cv-rise { animation: none } }
`;

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Clipboard write with a textarea fallback for older WebViews. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function Check({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Lock({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="3" y="7" width="10" height="7" rx="2" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" strokeLinecap="round" />
    </svg>
  );
}

function Countdown({ expiresAt, now }: { expiresAt: string; now: number }) {
  const left = Math.max(0, new Date(expiresAt).getTime() - now);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const low = left < 2 * 60 * 1000;
  return (
    <span className="tabular-nums" style={{ color: low ? AMBER : undefined }}>
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}

const STEPS: Array<{ key: ImportStatus; title: string; sub: string }> = [
  { key: 'waiting', title: 'Waiting for Cubbie', sub: 'Send the message and Cubbie takes it from there' },
  { key: 'received', title: 'Received', sub: 'Cubbie sent the assignment. Reading it now' },
  { key: 'imported', title: 'Imported', sub: 'Tasks posted in your group' },
];

function Stepper({ status, nick }: { status: ImportStatus; nick: string }) {
  const at = status === 'failed' ? 1 : Math.max(0, STEPS.findIndex((s) => s.key === status));
  return (
    <ol className="mt-1">
      {STEPS.map((step, i) => {
        const done = i < at || status === 'imported';
        const active = i === at && status !== 'imported';
        const failed = active && status === 'failed';
        const color = failed ? CORAL : done ? LIME : active ? CYAN : undefined;
        const sub = i === 1 && active ? `${nick} is turning it into tasks` : step.sub;
        return (
          <li key={step.key} className="relative flex gap-3.5 pb-5 last:pb-0">
            {i < STEPS.length - 1 && (
              <span
                className="absolute top-7 bottom-0 left-[11px] w-[2px] rounded-full transition-colors duration-500"
                style={{ background: done ? `${LIME}88` : '#3A3A3A' }}
                aria-hidden
              />
            )}
            <span
              className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-300 ${
                active && !failed ? 'cv-pulse' : ''
              } ${!color ? 'border-dashed border-line-strong' : ''}`}
              style={color ? { borderColor: color, background: done || failed ? color : 'transparent' } : undefined}
            >
              {done && <Check className="h-3 w-3 text-ink" />}
              {failed && <span className="text-[12px] font-black text-ink">!</span>}
              {active && !failed && <span className="h-2 w-2 rounded-full" style={{ background: CYAN }} />}
            </span>
            <span className="min-w-0 pt-0.5">
              <span
                className={`block text-[15px] font-semibold leading-tight ${!done && !active ? 'text-muted' : ''}`}
                style={failed ? { color: CORAL } : undefined}
              >
                {failed ? 'Import failed' : step.title}
              </span>
              {(active || done) && <span className="mt-0.5 block text-[13px] leading-snug text-muted">{sub}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function CodeTiles({ code, faded }: { code: string; faded: boolean }) {
  return (
    <div className={`flex justify-between gap-2 transition-opacity ${faded ? 'opacity-35' : ''}`} aria-label={`Code ${code.split('').join(' ')}`}>
      {code.split('').map((ch, i) => (
        <span
          key={i}
          className="cv-rise flex h-[58px] flex-1 items-center justify-center rounded-2xl border border-line bg-panel font-mono text-[30px] font-bold tracking-normal"
          style={{ animationDelay: `${i * 45}ms` }}
        >
          {ch}
        </span>
      ))}
    </div>
  );
}

function ImportCard({ me }: { me: MeResponse }) {
  const { group } = me;
  const nick = group.nickname;
  const expecting =
    (group.status === 'setup' || group.status === 'collecting_members') && !(group.task_count > 0 && group.joined > 0);

  const [pair, setPair] = useState<PairCodeResponse | null>(null);
  const [status, setStatus] = useState<PairCodeStatusResponse | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const current: ImportStatus = status?.status ?? 'waiting';
  const terminal = TERMINAL.includes(current);
  const celebrated = useRef<string | null>(null);

  const getCode = useCallback(async () => {
    haptic.tap();
    setRequesting(true);
    setRequestError(null);
    try {
      const body: PairCodeRequest = { groupChatId: group.id };
      const res = await api<PairCodeResponse>('/cubbie/pair-code', { method: 'POST', body: JSON.stringify(body) });
      setStatus(null);
      setCopied(false);
      setNow(Date.now());
      setPair(res);
    } catch (e) {
      haptic.error();
      setRequestError(errText(e, 'Could not make a code. Try again in a sec?'));
    } finally {
      setRequesting(false);
    }
  }, [group.id]);

  // Poll the code's status while the screen is visible; stop on a terminal state or unmount.
  useEffect(() => {
    if (!pair) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!live) return;
      if (document.visibilityState === 'visible') {
        try {
          const res = await api<PairCodeStatusResponse>(`/cubbie/pair-code/${encodeURIComponent(pair.code)}`);
          if (!live) return;
          setStatus(res);
          if (TERMINAL.includes(res.status)) return;
        } catch (e) {
          if (!live) return;
          if (e instanceof ApiError && e.status === 404) {
            setStatus({ code: pair.code, status: 'expired', expiresAt: pair.expiresAt, assignmentTitle: null, error: null });
            return;
          }
          // Network blip: keep polling.
        }
      }
      if (live) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pair]);

  // Countdown clock; flips to expired locally when time runs out.
  useEffect(() => {
    if (!pair || terminal) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= new Date(pair.expiresAt).getTime()) {
        setStatus((s) => ({
          code: pair.code,
          status: 'expired',
          expiresAt: pair.expiresAt,
          assignmentTitle: s?.assignmentTitle ?? null,
          error: null,
        }));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [pair, terminal]);

  useEffect(() => {
    if (current === 'imported' && pair && celebrated.current !== pair.code) {
      celebrated.current = pair.code;
      haptic.success();
    }
    if (current === 'failed') haptic.error();
  }, [current, pair]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    if (!pair) return;
    if (await copyText(pair.cubbieMessage)) {
      haptic.success();
      setCopied(true);
    } else {
      haptic.error();
    }
  };

  const smsUrl = pair ? `sms:&body=${encodeURIComponent(pair.cubbieMessage)}` : '';
  const openMessages = (e: { preventDefault(): void }) => {
    haptic.tap();
    try {
      openExternal(smsUrl, e);
    } catch {
      e.preventDefault();
      location.href = smsUrl;
    }
  };

  return (
    <section className={`${card} mt-5 overflow-hidden`}>
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className={label}>Import with Cubbie</div>
          <span
            className="rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider"
            style={{ color: CYAN, borderColor: `${CYAN}55` }}
          >
            Canvas
          </span>
        </div>
        <h2 className="mt-2 text-[21px] font-semibold leading-snug">Pull the assignment straight from Canvas</h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
          Cubbie reads the assignment from Canvas and hands it to {nick}, so nobody downloads anything.
        </p>

        {!expecting && (
          <div className="mt-5 flex gap-3 rounded-2xl border border-line bg-panel/60 p-4">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink" style={{ background: LIME }}>
              <Check className="h-3 w-3" />
            </span>
            <p className="text-[14px] leading-relaxed">
              {group.assignment_title ? (
                <>
                  This group already has <b className="font-semibold">{group.assignment_title}</b>.
                </>
              ) : (
                'This group already has its assignment.'
              )}
              <span className="block text-muted">
                Imports only work before the split, so the tasks stay as they are. Calendar sync below still works.
              </span>
            </p>
          </div>
        )}

        {expecting && !pair && (
          <>
            <ol className="mt-5 grid grid-cols-3 gap-2 text-center text-[12px] leading-snug text-muted">
              {['Get a code', 'Text Cubbie', 'Tasks land in the group'].map((t, i) => (
                <li key={t} className="rounded-2xl border border-dashed border-line px-2 py-3">
                  <span className="mx-auto mb-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-line text-[12px] font-bold text-text">
                    {i + 1}
                  </span>
                  {t}
                </li>
              ))}
            </ol>
            <button className={`${primary} mt-5`} onClick={getCode} disabled={requesting}>
              {requesting ? 'Making your code...' : 'Get my code'}
            </button>
            {requestError && <p className="mt-3 text-center text-[14px]" style={{ color: CORAL }}>{requestError}</p>}
          </>
        )}
      </div>

      {expecting && pair && current === 'imported' && (
        <div className="cv-rise border-t border-dashed border-line px-5 pt-6 pb-6 text-center" style={{ background: `${LIME}0D` }}>
          <span
            className="cv-pop mx-auto flex h-16 w-16 items-center justify-center rounded-full text-ink"
            style={{ background: LIME, boxShadow: `0 0 36px ${LIME}55` }}
          >
            <Check className="h-8 w-8" />
          </span>
          <div className="mt-4 text-[22px] font-bold tracking-tight">Check your group. The tasks are in.</div>
          {status?.assignmentTitle && (
            <div className="mx-auto mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-dashed px-4 py-2 text-[14px] font-medium" style={{ borderColor: `${LIME}66` }}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LIME }} />
              <span className="truncate">{status.assignmentTitle}</span>
            </div>
          )}
          <p className="mx-auto mt-4 max-w-xs text-[14px] leading-relaxed text-muted">
            {nick} posted the task list. Everyone taps Join, adds their details, and the split happens.
          </p>
          <div className="mt-6 rounded-2xl border border-line bg-ink/40 p-4 text-left">
            <Stepper status="imported" nick={nick} />
          </div>
        </div>
      )}

      {expecting && pair && current !== 'imported' && (
        <div className="cv-rise border-t border-dashed border-line px-5 pt-5 pb-5">
          <div className="flex items-baseline justify-between">
            <span className={label}>Your code</span>
            {current === 'expired' ? (
              <span className="text-[13px] font-medium" style={{ color: AMBER }}>
                Expired
              </span>
            ) : current === 'failed' ? (
              <span className="text-[13px] font-medium" style={{ color: CORAL }}>
                Used
              </span>
            ) : (
              <span className="text-[13px] text-muted">
                Expires in <Countdown expiresAt={pair.expiresAt} now={now} />
              </span>
            )}
          </div>
          <div className="mt-3">
            <CodeTiles code={pair.code} faded={current === 'expired' || current === 'failed'} />
          </div>

          {(current === 'waiting' || current === 'received') && (
            <>
              <div className="mt-5 text-[13px] text-muted">Send Cubbie exactly this</div>
              <div className="mt-2 flex items-center gap-2 rounded-2xl border border-line bg-panel p-1.5 pl-4">
                <code className="min-w-0 flex-1 font-mono text-[13px] leading-snug font-semibold break-words select-all">{pair.cubbieMessage}</code>
                <button
                  className="shrink-0 rounded-xl px-4 py-2.5 text-[14px] font-semibold transition-all active:scale-95"
                  style={copied ? { background: LIME, color: '#1E1E1E' } : { background: '#3A3A3A' }}
                  onClick={copy}
                  aria-live="polite"
                >
                  {copied ? (
                    <span className="flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5" />
                      Copied
                    </span>
                  ) : (
                    'Copy'
                  )}
                </button>
              </div>
              <a
                href={smsUrl}
                onClick={openMessages}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[16px] font-semibold text-ink transition-transform active:scale-[0.98]"
                style={{ background: CYAN }}
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor" aria-hidden>
                  <path d="M10 2.5c-4.7 0-8.5 3.1-8.5 7 0 2.2 1.2 4.1 3.1 5.4-.2 1-.7 2.1-1.5 2.9 1.7-.1 3.2-.7 4.3-1.5.8.2 1.7.3 2.6.3 4.7 0 8.5-3.1 8.5-7s-3.8-7.1-8.5-7.1z" />
                </svg>
                Open Messages
              </a>
              <p className="mt-2 text-center text-[13px] text-muted">Text it to Cubbie in iMessage</p>

              <div className="mt-6 border-t border-dashed border-line pt-5">
                <Stepper status={current} nick={nick} />
              </div>
            </>
          )}

          {current === 'failed' && (
            <div className="mt-5">
              <Stepper status="failed" nick={nick} />
              <p className="mt-4 rounded-2xl border px-4 py-3 text-[14px] leading-relaxed" style={{ borderColor: `${CORAL}55`, background: `${CORAL}10` }}>
                {status?.error ?? 'Something went wrong on the way in.'}
              </p>
              <button className={`${primary} mt-4`} onClick={getCode} disabled={requesting}>
                {requesting ? 'Making a new code...' : 'Get a new code'}
              </button>
            </div>
          )}

          {current === 'expired' && (
            <div className="mt-5 text-center">
              <p className="text-[15px] leading-relaxed text-muted">
                Codes last 15 minutes and work once. Grab a fresh one and text it to Cubbie.
              </p>
              <button className={`${primary} mt-4`} onClick={getCode} disabled={requesting}>
                {requesting ? 'Making a new code...' : 'Get a new code'}
              </button>
            </div>
          )}
          {requestError && <p className="mt-3 text-center text-[14px]" style={{ color: CORAL }}>{requestError}</p>}
        </div>
      )}
    </section>
  );
}

function Stat({ value, sub }: { value: ReactNode; sub: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-panel/60 px-4 py-3">
      <div className="truncate text-[18px] font-bold leading-tight tabular-nums">{value}</div>
      <div className="mt-0.5 text-[12px] text-muted">{sub}</div>
    </div>
  );
}

const GUIDE = [
  { title: 'In Canvas, open Calendar', sub: 'Left sidebar, on the web' },
  { title: 'Click Calendar Feed', sub: 'Bottom right, under the mini calendar' },
  { title: 'Copy the link and paste it here', sub: 'It starts with canvas.asu.edu/feeds' },
];

function CalendarCard({ go }: { go: (s: Screen) => void }) {
  const [feed, setFeed] = useState<FeedStatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [value, setValue] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [justConnected, setJustConnected] = useState(false);
  const [canRead] = useState(() => typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    api<FeedStatusResponse>('/feed/status')
      .then((res) => live && setFeed(res))
      .catch((e) => live && setLoadError(errText(e, 'Could not check your calendar. Try again?')));
    return () => {
      live = false;
    };
  }, [attempt]);

  const valid = value.trim() !== '' && isAllowedFeedUrl(value);
  const shownError =
    inputError ?? (value.trim() && !valid ? 'Not a Canvas feed link yet. It starts with https://canvas.asu.edu/feeds/' : null);

  const save = async (raw = value) => {
    const url = normalizeFeedUrl(raw);
    if (!url) {
      haptic.error();
      setInputError('That is not a Canvas feed link. It should start with https://canvas.asu.edu/feeds/');
      return;
    }
    haptic.tap();
    setSaving(true);
    setInputError(null);
    try {
      const body: FeedPutRequest = { feedUrl: url };
      await api('/feed', { method: 'PUT', body: JSON.stringify(body) });
      setValue('');
      const res = await api<FeedStatusResponse>('/feed/status');
      setFeed(res);
      setJustConnected(true);
      haptic.success();
    } catch (e) {
      haptic.error();
      setInputError(errText(e, 'Could not save that link. Try again?'));
    } finally {
      setSaving(false);
    }
  };

  const paste = async () => {
    haptic.tap();
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) throw new Error('empty');
      setValue(text);
      setInputError(isAllowedFeedUrl(text) ? null : 'That is not a Canvas feed link. Copy the Calendar Feed link and try again.');
    } catch {
      inputRef.current?.focus();
      setInputError('Long press the box to paste.');
    }
  };

  const disconnect = async () => {
    haptic.tap();
    setDisconnecting(true);
    setActionError(null);
    try {
      await api('/feed', { method: 'DELETE' });
      setFeed({ connected: false, lastPolledAt: null, lastError: null, eventCount: 0, courses: [] });
      setConfirming(false);
      setJustConnected(false);
    } catch (e) {
      haptic.error();
      setActionError(errText(e, 'Could not disconnect. Try again?'));
    } finally {
      setDisconnecting(false);
    }
  };

  const connected = Boolean(feed?.connected);

  return (
    <section className={`${card} mt-4 p-5`}>
      <div className="flex items-center justify-between gap-3">
        <div className={label}>Calendar sync</div>
        {connected && (
          <span className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: LIME }}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: LIME }} />
              <span className="relative h-2 w-2 rounded-full" style={{ background: LIME }} />
            </span>
            Connected
          </span>
        )}
      </div>
      <h2 className="mt-2 text-[21px] font-semibold leading-snug">
        {connected ? 'Your due dates are in sync' : 'Keep every due date in sync'}
      </h2>
      <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
        {connected
          ? 'Groupie checks your Canvas calendar every 30 minutes, across all your courses.'
          : 'Paste your Canvas calendar link once. Groupie keeps every course in one list.'}
      </p>

      {!feed && !loadError && (
        <div className="mt-5">
          <FeedStatusSkeleton />
        </div>
      )}

      {loadError && (
        <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-line bg-panel/60 p-4">
          <p className="text-[14px] text-muted">{loadError}</p>
          <button
            className={`${secondary} shrink-0`}
            onClick={() => {
              haptic.tap();
              setLoadError(null);
              setAttempt((a) => a + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}

      {feed && !connected && (
        <>
          <ol className="mt-5 space-y-3">
            {GUIDE.map((g, i) => (
              <li key={g.title} className="flex items-start gap-3.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-[13px] font-bold tabular-nums">
                  {i + 1}
                </span>
                <span className="pt-0.5">
                  <span className="block text-[15px] font-medium leading-tight">{g.title}</span>
                  <span className="text-[13px] text-muted">{g.sub}</span>
                </span>
              </li>
            ))}
          </ol>

          <form
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div
              className="flex items-center gap-2 rounded-2xl border bg-panel p-1.5 pl-4 transition-colors"
              style={{ borderColor: shownError ? `${CORAL}88` : valid ? `${LIME}88` : '#3A3A3A' }}
            >
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (inputError) setInputError(null);
                }}
                placeholder="https://canvas.asu.edu/feeds/..."
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Canvas calendar feed link"
                className="min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none placeholder:text-muted/70"
              />
              {canRead && (
                <button
                  type="button"
                  onClick={paste}
                  className="shrink-0 rounded-xl bg-line px-4 py-2.5 text-[14px] font-semibold active:scale-95"
                >
                  Paste
                </button>
              )}
            </div>
            {shownError && (
              <p className="mt-2 px-1 text-[13px] leading-snug" style={{ color: CORAL }}>
                {shownError}
              </p>
            )}
            <button type="submit" className={`${primary} mt-4`} disabled={!valid || saving}>
              {saving ? 'Connecting...' : 'Connect calendar'}
            </button>
          </form>
        </>
      )}

      {feed && connected && (
        <div className={justConnected ? 'cv-rise' : ''}>
          <div className="mt-5 flex items-center gap-2.5 rounded-2xl border border-line bg-panel/60 px-4 py-3 text-[14px]">
            <Lock className="h-4 w-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate font-mono text-muted">feeds/••••••••</span>
            <span className="shrink-0 text-[12px] font-semibold uppercase tracking-wider" style={{ color: LIME }}>
              Saved
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stat value={feed.lastPolledAt ? ago(feed.lastPolledAt) : 'Syncing now'} sub="Last synced" />
            <Stat value={feed.eventCount} sub={feed.eventCount === 1 ? 'Item due' : 'Items due'} />
          </div>

          {feed.courses.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {feed.courses.map((c) => (
                <CourseChip key={c} course={c} size="md" />
              ))}
            </div>
          )}

          {feed.lastError && (
            <p
              className="mt-4 rounded-2xl border px-4 py-3 text-[14px] leading-relaxed"
              style={{ borderColor: `${AMBER}55`, background: `${AMBER}10` }}
            >
              <b className="font-semibold" style={{ color: AMBER }}>
                Last sync hiccup.
              </b>{' '}
              {feed.lastError}
            </p>
          )}

          <button
            className={`${primary} mt-5`}
            onClick={() => {
              haptic.tap();
              go('upcoming');
            }}
          >
            See what's due
          </button>

          {!confirming ? (
            <button
              className="mt-3 w-full py-2 text-[14px] font-medium text-muted active:opacity-70"
              onClick={() => {
                haptic.tap();
                setConfirming(true);
              }}
            >
              Disconnect calendar
            </button>
          ) : (
            <div className="cv-rise mt-4 rounded-2xl border p-4" style={{ borderColor: `${CORAL}55`, background: `${CORAL}0D` }}>
              <p className="text-[14px] leading-relaxed">
                Disconnect your calendar?
                <span className="block text-muted">Groupie forgets the link and every synced due date.</span>
              </p>
              <div className="mt-4 flex gap-2">
                <button className={`${secondary} flex-1`} onClick={() => setConfirming(false)} disabled={disconnecting}>
                  Keep it
                </button>
                <button
                  className="flex-1 rounded-full py-2.5 text-[15px] font-semibold text-ink active:scale-[0.98] disabled:opacity-50"
                  style={{ background: CORAL }}
                  onClick={disconnect}
                  disabled={disconnecting}
                >
                  {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>
              {actionError && (
                <p className="mt-3 text-[13px]" style={{ color: CORAL }}>
                  {actionError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <p className="mt-5 flex items-start gap-2 border-t border-dashed border-line pt-4 text-[13px] leading-snug text-muted">
        <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
        Your link is encrypted and only used to read due dates. Nobody in the group sees it.
      </p>
    </section>
  );
}

/** Opt-in switch: lets the load-aware split go easier on me in busy weeks. Optimistic, rolls back on error. */
function WorkloadCard({ me, onMember }: { me: MeResponse; onMember?: (m: Member) => void }) {
  const [on, setOn] = useState(Boolean(me.member?.share_workload));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (saving) return;
    const next = !on;
    haptic.select();
    setOn(next);
    setSaving(true);
    setError(null);
    try {
      const body: WorkloadRequest = { shareWorkload: next };
      const res = await api<WorkloadResponse>(`/groups/${me.group.id}/members/me/workload`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setOn(res.member.share_workload);
      onMember?.(res.member);
    } catch (e) {
      haptic.error();
      setOn(!next);
      setError(errText(e, 'Could not save that. Try again?'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`${card} mt-4 p-5`}>
      <div className={label}>Busy weeks</div>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="workload-label" className="text-[17px] font-semibold leading-snug">
            Let my group&apos;s split account for my busy weeks
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
            {"Your group sees only 'Busy week', never your other courses or how many items you have due."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="workload-label"
          onClick={toggle}
          className={`relative mt-0.5 h-8 w-[52px] shrink-0 rounded-full border transition-colors duration-300 active:scale-95 ${
            on ? 'border-transparent' : 'border-dashed border-line-strong bg-ink'
          }`}
          style={on ? { background: LIME } : undefined}
        >
          <span
            aria-hidden
            className="absolute top-1 left-1 h-[22px] w-[22px] rounded-full shadow transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
            style={{ transform: on ? 'translateX(20px)' : 'none', background: on ? '#1E1E1E' : '#9A9A9A' }}
          />
        </button>
      </div>
      {error && (
        <p className="mt-3 text-[13px]" style={{ color: CORAL }}>
          {error}
        </p>
      )}
    </section>
  );
}

export function Canvas({ me, go, onMember }: Props) {
  return (
    <div className="mx-auto max-w-xl px-5 pb-12">
      <style>{MOTION}</style>
      <h1 className="mt-6 text-[28px] font-bold tracking-tight">Connect Canvas</h1>
      <p className="mt-1 text-[15px] text-muted">Import the assignment, sync your due dates.</p>
      <ImportCard me={me} />
      <CalendarCard go={go} />
      {me.member && <WorkloadCard me={me} onMember={onMember} />}
    </div>
  );
}
