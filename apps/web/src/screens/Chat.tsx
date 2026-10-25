import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatHistoryResponse, ChatMessage, ChatRequest, ChatResponse, MeResponse } from '@groupie/shared';
import { api, ApiError } from '../api.ts';
import { haptic, tg } from '../telegram.ts';
import { Logo } from '../components/Logo.tsx';
import { RichText } from '../components/RichText.tsx';
import { ChatSkeleton } from '../components/Skeleton.tsx';

type Item = ChatMessage & {
  key: string;
  status?: 'sending' | 'failed';
  error?: string;
  /** Arrived in this session, so it animates in. */
  fresh?: boolean;
};

const MAX_LEN = 1000;
const GROUP_GAP_MS = 5 * 60 * 1000;
const CORAL = '#FF6B5B';

/** Server timestamps may be SQLite style ("2026-10-24 10:00:00", UTC) or ISO. */
function parseTime(s: string): Date {
  const iso = /[T]/.test(s) ? s : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const timeLabel = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function dayLabel(d: Date) {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return 'Today';
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function errorText(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

/* ---------- icons ---------- */

function PlaneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden>
      <path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
    </svg>
  );
}

function LockIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="3" y="7" width="10" height="7" rx="2" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" strokeLinecap="round" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M13 8a5 5 0 11-1.6-3.66" strokeLinecap="round" />
      <path d="M13 2.5V5h-2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowDown() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M8 3v10M3.5 8.5L8 13l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- pieces ---------- */

function Avatar({ show }: { show: boolean }) {
  return <div className="w-7 shrink-0 self-end">{show && <Logo size={28} />}</div>;
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-3" role="separator">
      <span className="h-px flex-1 border-t border-dashed border-line" />
      <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">{label}</span>
      <span className="h-px flex-1 border-t border-dashed border-line" />
    </div>
  );
}

function TypingBubble({ nickname }: { nickname: string }) {
  return (
    <div className="flex animate-enter items-end gap-2 pt-3" role="status" aria-label={`${nickname} is typing`}>
      <Avatar show />
      <div className="flex h-[42px] items-center gap-1.5 rounded-[20px] rounded-bl-md bg-panel px-4">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 rounded-full bg-muted"
            style={{ animation: 'groupie-typing 1.2s ease-in-out infinite', animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function CenterState({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="flex h-full animate-enter flex-col items-center justify-center px-8 pb-16 text-center">
      <Logo size={56} />
      <h1 className="mt-6 text-[24px] font-bold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-muted">{body}</p>
      {children}
    </div>
  );
}

/* ---------- screen ---------- */

export function Chat({ me }: { me: MeResponse }) {
  const nick = me.group.nickname;
  const color = me.member?.color ?? '#F5F5F5';
  const firstName = me.user.first_name || me.member?.name || 'friend';

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const stick = useRef(false);
  const firstScroll = useRef(true);
  const seq = useRef(0);

  const [top, setTop] = useState(64);
  const [items, setItems] = useState<Item[] | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [pill, setPill] = useState(false);

  // The chat fills whatever is left under the app header.
  useLayoutEffect(() => {
    const measure = () => {
      // Sum offsetTop up the chain: unlike getBoundingClientRect it ignores the enter animation's transform.
      let y = 0;
      for (let n = rootRef.current as HTMLElement | null; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
      setTop(y);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // No MainButton here, and no swipe-to-close while scrolling the thread.
  useEffect(() => {
    if (!tg) return;
    tg.MainButton.hide();
    const swipes = tg.isVersionAtLeast('7.7') && tg.disableVerticalSwipes;
    if (swipes) tg.disableVerticalSwipes?.();
    return () => {
      if (swipes) tg?.enableVerticalSwipes?.();
    };
  }, []);

  useEffect(() => {
    if (!me.member) return;
    let live = true;
    api<ChatHistoryResponse>(`/agent/history?group=${me.group.id}`)
      .then((res) => {
        if (!live) return;
        setItems(res.messages.map((m) => ({ ...m, key: `m${m.id}` })));
        setSuggestions(res.suggestions);
      })
      .catch((e) => live && setLoadError(errorText(e, 'Could not reach Groupie. Try again in a sec?')));
    return () => {
      live = false;
    };
  }, [me.group.id, me.member, attempt]);

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Follow new messages while the reader is at the bottom (or just sent something).
  useLayoutEffect(() => {
    if (!items) return;
    if (stick.current || atBottom.current) {
      scrollToBottom(!firstScroll.current);
      stick.current = false;
    }
    firstScroll.current = false;
  }, [items, busy, scrollToBottom]);

  // Keyboard opening shrinks the viewport: keep the latest message in view.
  useEffect(() => {
    const vv = window.visualViewport;
    const onResize = () => {
      if (atBottom.current) scrollToBottom(false);
    };
    vv?.addEventListener('resize', onResize);
    window.addEventListener('resize', onResize);
    return () => {
      vv?.removeEventListener('resize', onResize);
      window.removeEventListener('resize', onResize);
    };
  }, [scrollToBottom]);

  // Grow the textarea up to about four lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 22 * 4 + 20)}px`;
  }, [draft]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    atBottom.current = near;
    if (near) setPill(false);
  }, []);

  const send = useCallback(
    async (raw: string, retry?: Item) => {
      const content = raw.trim().slice(0, MAX_LEN);
      if (!content || busy) return;
      haptic.tap();
      const key = retry?.key ?? `local-${++seq.current}`;
      const optimistic: Item = {
        id: -1,
        key,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
        status: 'sending',
        fresh: true,
      };
      stick.current = true;
      setPill(false);
      // A retried message moves to the end so the reply lands right under it.
      setItems((list) => [...(list ?? []).filter((i) => i.key !== key), optimistic]);
      setBusy(true);
      try {
        const body: ChatRequest = { group_id: me.group.id, message: content };
        const res = await api<ChatResponse>('/agent/chat', { method: 'POST', body: JSON.stringify(body) });
        setItems((list) => [
          ...(list ?? []).map((i) => (i.key === key ? { ...res.user, key, fresh: true } : i)),
          { ...res.reply, key: `m${res.reply.id}`, fresh: true },
        ]);
        if (!atBottom.current) setPill(true);
        haptic.success();
      } catch (e) {
        haptic.error();
        setItems((list) =>
          (list ?? []).map((i) =>
            i.key === key ? { ...i, status: 'failed', error: errorText(e, `${nick} did not get that one.`) } : i,
          ),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, me.group.id, nick],
  );

  const submit = useCallback(() => {
    if (!draft.trim() || busy) return;
    const text = draft;
    setDraft('');
    send(text);
    inputRef.current?.focus();
  }, [draft, busy, send]);

  const shell = (children: ReactNode) => (
    <div
      ref={rootRef}
      className="relative flex flex-col"
      style={{ height: `calc(min(100dvh, var(--tg-viewport-height, 100dvh)) - ${top}px)` }}
    >
      <style>{`@keyframes groupie-typing{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-5px);opacity:1}}`}</style>
      {children}
    </div>
  );

  if (!me.member) {
    return shell(
      <CenterState
        title="Add your details first"
        body={`${nick} needs to know who you are before the two of you can talk shop. Tap Back and add your details, then come say hi.`}
      />,
    );
  }

  if (loadError) {
    return shell(
      <CenterState title="The chat got lost" body={loadError}>
        <button
          className="mt-8 rounded-full bg-text px-7 py-3 text-[15px] font-semibold text-ink active:scale-[0.98]"
          onClick={() => {
            haptic.tap();
            setLoadError(null);
            setAttempt((a) => a + 1);
          }}
        >
          Try again
        </button>
      </CenterState>,
    );
  }

  if (!items) return shell(<ChatSkeleton />);

  const empty = items.length === 0 && !busy;
  const canSend = draft.trim().length > 0 && !busy;

  return shell(
    <>
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto overscroll-contain px-4 [mask-image:linear-gradient(to_bottom,transparent,black_14px)]"
        >
          <div className="mx-auto flex min-h-full max-w-xl flex-col pt-3 pb-4">
            {empty ? (
              <EmptyState
                nick={nick}
                firstName={firstName}
                color={color}
                suggestions={suggestions}
                onPick={(s) => send(s)}
              />
            ) : (
              <>
                <div className="mt-auto" />
                <div className="mx-auto mb-1 flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1 text-[12px] text-muted">
                  <LockIcon className="h-3 w-3" />
                  Private to you. Your team can't see this.
                </div>
                <Thread items={items} color={color} onRetry={(i) => send(i.content, i)} busy={busy} />
                {busy && <TypingBubble nickname={nick} />}
              </>
            )}
          </div>
        </div>

        {pill && (
          <button
            onClick={() => {
              haptic.tap();
              setPill(false);
              scrollToBottom(true);
            }}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 animate-enter items-center gap-1.5 rounded-full border border-line-strong bg-panel py-1.5 pr-3.5 pl-3 text-[13px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.45)] active:scale-[0.97]"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            New message
            <ArrowDown />
          </button>
        )}
      </div>

      <form
        className="border-t border-dashed border-line bg-ink px-3 pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="mx-auto flex max-w-xl items-end gap-2 rounded-[22px] border border-line-strong bg-panel py-1 pr-1 pl-4 transition-colors focus-within:border-muted">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={MAX_LEN}
            placeholder={`Message ${nick}`}
            aria-label={`Message ${nick}`}
            enterKeyHint="send"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => {
              if (atBottom.current) setTimeout(() => scrollToBottom(true), 250);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className="block max-h-[108px] min-h-[38px] flex-1 resize-none bg-transparent py-2 text-[16px] leading-[22px] text-text outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            className="mb-px flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink transition-all duration-150 active:scale-90 disabled:bg-line disabled:text-muted"
            style={canSend ? { background: color } : undefined}
          >
            <PlaneIcon />
          </button>
        </div>
        {draft.length > MAX_LEN - 150 && (
          <div className={`mx-auto mt-1 max-w-xl px-4 text-right text-[11px] tabular-nums ${draft.length >= MAX_LEN ? 'text-[#FF6B5B]' : 'text-muted'}`}>
            {draft.length}/{MAX_LEN}
          </div>
        )}
      </form>
    </>,
  );
}

function EmptyState({
  nick,
  firstName,
  color,
  suggestions,
  onPick,
}: {
  nick: string;
  firstName: string;
  color: string;
  suggestions: string[];
  onPick: (s: string) => void;
}) {
  return (
    <div className="flex flex-1 animate-enter flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
        <div className="relative">
          <Logo size={64} />
          <span
            className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink text-ink"
            style={{ background: color }}
          >
            <LockIcon className="h-3 w-3" />
          </span>
        </div>
        <h1 className="mt-6 max-w-[18rem] text-[24px] font-bold leading-tight tracking-tight">
          Hey {firstName}, it's {nick}.
        </h1>
        <p className="mt-2 max-w-[17rem] text-[15px] leading-relaxed text-muted">
          This chat is just us; your team can't see it. Ask me about your tasks, deadlines or the next meetup.
        </p>
        <div className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3 py-1.5 text-[13px] font-medium text-muted">
          <LockIcon />
          Private to you
        </div>
      </div>

      {suggestions.length > 0 && (
        <div>
          <div className="mb-2.5 px-1 text-[12px] font-medium uppercase tracking-widest text-muted">Try asking</div>
          <div className="flex flex-col items-start gap-2">
            {suggestions.map((s, i) => (
              <button
                key={s}
                onClick={() => onPick(s)}
                className="max-w-full animate-enter rounded-[18px] rounded-bl-md border border-dashed border-line-strong px-4 py-2.5 text-left text-[15px] leading-snug transition-colors active:scale-[0.98] active:bg-panel"
                style={{ animationDelay: `${120 + i * 70}ms`, animationFillMode: 'both' }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Thread({
  items,
  color,
  busy,
  onRetry,
}: {
  items: Item[];
  color: string;
  busy: boolean;
  onRetry: (i: Item) => void;
}) {
  const rows: ReactNode[] = [];
  items.forEach((m, idx) => {
    const prev = items[idx - 1];
    const next = items[idx + 1];
    const at = parseTime(m.created_at);
    const newDay = !prev || dayKey(parseTime(prev.created_at)) !== dayKey(at);
    const joinsPrev =
      !newDay && prev?.role === m.role && at.getTime() - parseTime(prev.created_at).getTime() < GROUP_GAP_MS;
    const joinsNext =
      next?.role === m.role &&
      dayKey(parseTime(next.created_at)) === dayKey(at) &&
      parseTime(next.created_at).getTime() - at.getTime() < GROUP_GAP_MS &&
      !m.status &&
      !next.status;
    const lastInGroup = !joinsNext;

    if (newDay) rows.push(<DaySeparator key={`d-${m.key}`} label={dayLabel(at)} />);

    const mine = m.role === 'user';
    const failed = m.status === 'failed';
    const corner = mine
      ? `${joinsPrev ? 'rounded-tr-md' : ''} rounded-br-md`
      : `${joinsPrev ? 'rounded-tl-md' : ''} rounded-bl-md`;

    rows.push(
      <div
        key={m.key}
        className={`${joinsPrev ? 'pt-1' : 'pt-3'} ${m.fresh ? 'animate-enter' : ''}`}
      >
        <div className={`flex items-end gap-2 ${mine ? 'justify-end' : ''}`}>
          {!mine && <Avatar show={lastInGroup} />}
          {mine ? (
            <button
              type="button"
              disabled={!failed || busy}
              onClick={() => onRetry(m)}
              className={`max-w-[80%] rounded-[20px] px-3.5 py-2 text-left text-[15.5px] leading-[1.4] break-words whitespace-pre-wrap transition-all ${corner} ${
                m.status === 'sending' ? 'opacity-90' : ''
              } ${failed ? 'border-[1.5px] border-dashed text-text active:scale-[0.98]' : 'text-ink'}`}
              style={failed ? { borderColor: CORAL, background: `${color}14` } : { background: color }}
            >
              {m.content}
            </button>
          ) : (
            <div
              className={`max-w-[84%] rounded-[20px] bg-panel px-3.5 py-2.5 text-[15.5px] leading-[1.45] break-words text-text/95 ${corner}`}
            >
              <RichText text={m.content} accent={color} />
            </div>
          )}
          {failed && (
            <span
              className="mb-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-ink"
              style={{ background: CORAL }}
              aria-hidden
            >
              !
            </span>
          )}
        </div>
        {failed ? (
          <div className="mt-1.5 flex flex-col items-end gap-0.5 pr-7 text-right">
            <span className="max-w-[80%] text-[12.5px] leading-snug text-muted">{m.error}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRetry(m)}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#FF6B5B] disabled:opacity-50"
            >
              <RetryIcon />
              Not sent. Tap to retry
            </button>
          </div>
        ) : (
          lastInGroup &&
          m.status !== 'sending' && (
            <div className={`mt-1 text-[11px] tabular-nums text-muted ${mine ? 'pr-1 text-right' : 'pl-10'}`}>
              {timeLabel(at)}
            </div>
          )
        )}
      </div>,
    );
  });
  return <>{rows}</>;
}
