import { useCallback, useEffect, useState } from 'react';
import type { CalendarIcsRequest, CalendarStatusResponse, GoogleStartResponse, MeResponse, Screen } from '@groupie/shared';
import { api, ApiError } from '../api.ts';
import { haptic, openExternal, tg } from '../telegram.ts';
import { FeedStatusSkeleton } from '../components/Skeleton.tsx';
import { ago } from '../components/Course.tsx';

type Kind = CalendarStatusResponse['connections'][number]['kind'];
type Conn = CalendarStatusResponse['connections'][number];

const label = 'text-[13px] font-medium uppercase tracking-widest text-muted';
const card = 'rounded-3xl border border-dashed border-line-strong';
const primary =
  'w-full rounded-full bg-text py-3.5 text-[16px] font-semibold text-ink transition-transform active:scale-[0.98] disabled:opacity-50';
const secondary =
  'min-h-11 rounded-full border border-dashed border-line-strong px-5 py-2.5 text-[15px] font-medium transition-transform active:scale-[0.98] disabled:opacity-50';
const LIME = '#A6E35A';
const CORAL = '#FF6B5B';
const AMBER = '#FFB547';

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const NAMES: Record<Kind, string> = { google: 'Google Calendar', ics: 'Calendar link' };

const GUIDES = [
  { key: 'apple', title: 'Apple (iCloud)', steps: 'Calendar app, tap (i) next to a calendar, turn on Public Calendar, Share Link, Copy.' },
  { key: 'outlook', title: 'Outlook', steps: 'Outlook on the web, Settings, Calendar, Shared calendars, Publish a calendar, copy the ICS link.' },
  { key: 'google', title: 'Google', steps: 'Google Calendar on the web, Settings, your calendar, Integrate calendar, copy Secret address in iCal format.' },
];

/** Opens the consent page in Telegram's browser, or a new tab outside Telegram. */
function openUrl(url: string) {
  if (tg?.openLink) openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

/** Rough client check so the button only lights up for something link-shaped. The server decides. */
const looksLikeLink = (v: string) => /^(https|webcals?):\/\/\S+\.\S+/i.test(v.trim()) && v.trim().length <= 2000;

function ConnectionCard({
  conn,
  count,
  onSync,
  onDisconnect,
  syncing,
  syncError,
}: {
  conn: Conn;
  count: number;
  onSync: () => void;
  onDisconnect: () => Promise<void>;
  syncing: boolean;
  syncError: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disconnect = async () => {
    haptic.tap();
    setBusy(true);
    setError(null);
    try {
      await onDisconnect();
    } catch (e) {
      haptic.error();
      setError(errText(e, 'Could not disconnect. Try again?'));
      setBusy(false);
    }
  };
  return (
    <section className={`${card} mt-4 p-5`}>
      <div className="flex items-center justify-between gap-3">
        <div className={label}>{NAMES[conn.kind]}</div>
        <span className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: LIME }}>
          <span className="h-2 w-2 rounded-full" style={{ background: LIME }} />
          Connected
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="min-w-0 rounded-2xl border border-line bg-panel/60 px-4 py-3">
          <div className="truncate text-[18px] font-bold leading-tight">{conn.last_sync_at ? ago(conn.last_sync_at) : 'Not yet'}</div>
          <div className="mt-0.5 text-[12px] text-muted">Last synced</div>
        </div>
        <div className="min-w-0 rounded-2xl border border-line bg-panel/60 px-4 py-3">
          <div className="truncate text-[18px] font-bold leading-tight tabular-nums">{count}</div>
          <div className="mt-0.5 text-[12px] text-muted">Busy times, next 2 weeks</div>
        </div>
      </div>
      {conn.last_error && (
        <p className="mt-4 rounded-2xl border px-4 py-3 text-[14px] leading-relaxed" style={{ borderColor: `${AMBER}55`, background: `${AMBER}10` }}>
          <b className="font-semibold" style={{ color: AMBER }}>
            Last sync hiccup.
          </b>{' '}
          {conn.last_error} Tap Sync now to try again.
        </p>
      )}
      <button className={`${secondary} mt-4 w-full`} onClick={onSync} disabled={syncing}>
        {syncing ? 'Syncing...' : 'Sync now'}
      </button>
      {syncError && (
        <p className="mt-2 px-1 text-[13px] leading-snug" style={{ color: CORAL }} role="alert">
          {syncError}
        </p>
      )}
      {!confirming ? (
        <button
          className="mt-2 min-h-11 w-full py-2 text-[14px] font-medium text-muted active:opacity-70"
          onClick={() => {
            haptic.tap();
            setConfirming(true);
          }}
        >
          Disconnect
        </button>
      ) : (
        <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: `${CORAL}55`, background: `${CORAL}0D` }}>
          <p className="text-[14px] leading-relaxed">
            Disconnect {NAMES[conn.kind]}?
            <span className="block text-muted">Groupie forgets the {conn.kind === 'google' ? 'access' : 'link'} and every busy time from it.</span>
          </p>
          <div className="mt-4 flex gap-2">
            <button className={`${secondary} flex-1`} onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
            </button>
            <button
              className="min-h-11 flex-1 rounded-full py-2.5 text-[15px] font-semibold text-ink active:scale-[0.98] disabled:opacity-50"
              style={{ background: CORAL }}
              onClick={disconnect}
              disabled={busy}
            >
              {busy ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
          {error && (
            <p className="mt-3 text-[13px]" style={{ color: CORAL }}>
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Step 18a: connect Google (free/busy) or paste an ICS link. Only busy times are ever stored. */
export function CalendarConnect({ me, go }: { me: MeResponse; go: (s: Screen) => void }) {
  const [status, setStatus] = useState<CalendarStatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [value, setValue] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [openGuide, setOpenGuide] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<CalendarStatusResponse>('/calendar/status'));
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e, 'Could not check your calendars. Try again?'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  // Coming back from Google's consent page: refresh.
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

  const conn = (k: Kind) => status?.connections.find((c) => c.kind === k);
  const google = conn('google');
  const ics = conn('ics');
  const anyConnected = Boolean(google?.connected || ics?.connected);

  const startGoogle = async () => {
    haptic.tap();
    setStarting(true);
    setGoogleError(null);
    try {
      const { url } = await api<GoogleStartResponse>('/calendar/google/start');
      openUrl(url);
    } catch (e) {
      haptic.error();
      setGoogleError(errText(e, 'Could not open Google. Try again?'));
    } finally {
      setStarting(false);
    }
  };

  const saveLink = async () => {
    if (!looksLikeLink(value)) {
      haptic.error();
      setInputError('Paste the full calendar link. It starts with https:// or webcal://');
      return;
    }
    haptic.tap();
    setSaving(true);
    setInputError(null);
    try {
      const body: CalendarIcsRequest = { url: value.trim() };
      setStatus(await api<CalendarStatusResponse>('/calendar/ics', { method: 'PUT', body: JSON.stringify(body) }));
      setValue('');
      haptic.success();
    } catch (e) {
      haptic.error();
      setInputError(errText(e, 'Could not save that link. Try again?'));
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    haptic.tap();
    setSyncing(true);
    setSyncError(null);
    try {
      setStatus(await api<CalendarStatusResponse>('/calendar/sync', { method: 'POST' }));
      haptic.success();
    } catch (e) {
      haptic.error();
      setSyncError(errText(e, 'Could not sync just now. Try again in a sec?'));
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async (k: Kind) => {
    setStatus(await api<CalendarStatusResponse>(`/calendar/${k}`, { method: 'DELETE' }));
    haptic.success();
  };

  return (
    <div className="mx-auto max-w-xl px-5 pb-12">
      <h1 className="mt-6 text-[28px] font-bold tracking-tight">Connect your calendar</h1>
      <p className="mt-1 text-[15px] leading-relaxed text-muted">
        Groupie only sees when you're busy, never what it is. Your availability grid opens prefilled.
      </p>

      {!status && !loadError && (
        <div className={`${card} mt-5 p-5`}>
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

      {status && (
        <>
          {!anyConnected && (
            <p className="mt-5 rounded-2xl border border-line bg-panel/60 px-4 py-3 text-[14px] text-muted">
              No calendar connected yet. Pick one option below. It takes about a minute.
            </p>
          )}

          {google?.connected && (
            <ConnectionCard conn={google} count={status.busy_block_count} syncing={syncing} syncError={syncError} onSync={syncNow} onDisconnect={() => disconnect('google')} />
          )}
          {ics?.connected && (
            <ConnectionCard conn={ics} count={status.busy_block_count} syncing={syncing} syncError={syncError} onSync={syncNow} onDisconnect={() => disconnect('ics')} />
          )}

          {anyConnected && me.member && (
            <button
              className={`${primary} mt-4`}
              onClick={() => {
                haptic.tap();
                go('avail');
              }}
            >
              Fill your availability
            </button>
          )}

          {status.google_available && !google?.connected && (
            <section className={`${card} mt-4 p-5`}>
              <div className={label}>{anyConnected ? 'Add another' : 'Option 1'}</div>
              <h2 className="mt-2 text-[21px] font-semibold leading-snug">Google Calendar</h2>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">Sign in with Google and allow free/busy access. No event names, ever.</p>
              <button className={`${primary} mt-4`} onClick={startGoogle} disabled={starting}>
                {starting ? 'Opening Google...' : 'Connect Google Calendar'}
              </button>
              {googleError && (
                <p className="mt-2 px-1 text-[13px]" style={{ color: CORAL }}>
                  {googleError}
                </p>
              )}
              <p className="mt-3 text-[13px] text-muted">When Google says you're done, come back here.</p>
            </section>
          )}

          {!ics?.connected && (
            <section className={`${card} mt-4 p-5`}>
              <div className={label}>{anyConnected ? 'Add another' : status.google_available && !google?.connected ? 'Option 2' : 'Calendar link'}</div>
              <h2 className="mt-2 text-[21px] font-semibold leading-snug">Paste a calendar link</h2>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted">Works with Apple, Outlook, and Google. Find the link:</p>
              <ul className="mt-3 space-y-2">
                {GUIDES.map((g) => (
                  <li key={g.key} className="rounded-2xl border border-line bg-panel/60">
                    <button
                      className="flex min-h-11 w-full items-center justify-between px-4 py-3 text-left text-[15px] font-medium"
                      onClick={() => {
                        haptic.select();
                        setOpenGuide(openGuide === g.key ? null : g.key);
                      }}
                      aria-expanded={openGuide === g.key}
                    >
                      {g.title}
                      <span className="text-muted">{openGuide === g.key ? '-' : '+'}</span>
                    </button>
                    {openGuide === g.key && <p className="px-4 pb-3 text-[14px] leading-relaxed text-muted">{g.steps}</p>}
                  </li>
                ))}
              </ul>
              <form
                className="mt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveLink();
                }}
              >
                <div
                  className="rounded-2xl border bg-panel p-1.5 pl-4 transition-colors"
                  style={{ borderColor: inputError ? `${CORAL}88` : looksLikeLink(value) ? `${LIME}88` : '#3A3A3A' }}
                >
                  <input
                    value={value}
                    onChange={(e) => {
                      setValue(e.target.value);
                      if (inputError) setInputError(null);
                    }}
                    placeholder="https://... or webcal://..."
                    inputMode="url"
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={2000}
                    aria-label="Calendar link"
                    className="w-full min-w-0 bg-transparent py-2 text-[15px] outline-none placeholder:text-muted/70"
                  />
                </div>
                {inputError && (
                  <p className="mt-2 px-1 text-[13px] leading-snug" style={{ color: CORAL }}>
                    {inputError}
                  </p>
                )}
                <button type="submit" className={`${primary} mt-4`} disabled={!value.trim() || saving}>
                  {saving ? 'Connecting...' : 'Connect link'}
                </button>
              </form>
            </section>
          )}

          <p className="mt-5 text-[13px] leading-snug text-muted">
            Your link or Google access is encrypted. Groupie stores only start and end times for the next 2 weeks. Nobody in the group sees
            your calendar.
          </p>
        </>
      )}
    </div>
  );
}
