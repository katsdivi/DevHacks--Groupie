import { and, eq, isNull, lte, notInArray, or } from 'drizzle-orm';
import { FEED_POLL_INTERVAL_MS, type FeedEvent } from '@groupie/shared';
import { db, schema } from '../db/index.ts';
import { decryptSecret, feedKey } from './crypto.ts';
import { getFeed, safeErrorMessage } from './feeds.ts';
import { parseCanvasFeed } from './ics.ts';

const { calendarFeeds, calendarEvents } = schema;

export const FEED_FETCH_TIMEOUT_MS = 20_000;
export const MAX_BACKOFF_MS = 12 * 60 * 60 * 1000;
const TICK_MS = 60_000;

type FetchFn = typeof fetch;
let fetchImpl: FetchFn = (...args) => fetch(...args);

/** Swaps the fetch used for feeds (tests). Returns the previous one. */
export function setFeedFetch(f: FetchFn): FetchFn {
  const prev = fetchImpl;
  fetchImpl = f;
  return prev;
}

/** Wait after the Nth failure in a row: 30 min, 1 h, 2 h, ... capped at 12 h. */
export const backoffMs = (failures: number) => Math.min(MAX_BACKOFF_MS, FEED_POLL_INTERVAL_MS * 2 ** Math.max(0, failures - 1));

export type PollResult = { ok: true; changed: boolean; count: number } | { ok: false; error: string };

const inFlight = new Map<number, Promise<PollResult>>();

/** Upserts the feed's events and marks UIDs missing from it as removed. */
export function applyFeedEvents(telegramUserId: number, events: FeedEvent[], now = new Date()) {
  const iso = now.toISOString();
  db.transaction((tx) => {
    for (const e of events) {
      const fields = { course: e.course, title: e.title, dueAt: e.dueAt, description: e.description, url: e.url, kind: e.kind };
      tx.insert(calendarEvents)
        .values({ telegramUserId, uid: e.uid, ...fields, removedAt: null, updatedAt: iso })
        .onConflictDoUpdate({
          target: [calendarEvents.telegramUserId, calendarEvents.uid],
          set: { ...fields, removedAt: null, updatedAt: iso },
        })
        .run();
    }
    const uids = events.map((e) => e.uid);
    const missing = and(
      eq(calendarEvents.telegramUserId, telegramUserId),
      isNull(calendarEvents.removedAt),
      uids.length ? notInArray(calendarEvents.uid, uids) : undefined,
    );
    tx.update(calendarEvents).set({ removedAt: iso, updatedAt: iso }).where(missing).run();
  });
}

async function doPoll(telegramUserId: number, now: () => Date): Promise<PollResult> {
  const feed = getFeed(telegramUserId);
  if (!feed) return { ok: false, error: 'no_feed' };
  let url: string | null = null;
  try {
    try {
      url = decryptSecret(feed.feedUrlEncrypted);
    } catch {
      throw new Error('Could not read the saved feed. Paste it again.');
    }
    const headers: Record<string, string> = { accept: 'text/calendar' };
    if (feed.etag) headers['if-none-match'] = feed.etag;
    if (feed.lastModified) headers['if-modified-since'] = feed.lastModified;
    const res = await fetchImpl(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS) });
    const t = now();
    const ok = { lastPolledAt: t.toISOString(), lastError: null, failures: 0, nextPollAt: new Date(t.getTime() + FEED_POLL_INTERVAL_MS).toISOString() };
    if (res.status === 304) {
      db.update(calendarFeeds).set(ok).where(eq(calendarFeeds.telegramUserId, telegramUserId)).run();
      return { ok: true, changed: false, count: 0 };
    }
    if (!res.ok) throw new Error(`Canvas answered HTTP ${res.status}`);
    const events = parseCanvasFeed(await res.text());
    applyFeedEvents(telegramUserId, events, t);
    db.update(calendarFeeds)
      .set({ ...ok, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') })
      .where(eq(calendarFeeds.telegramUserId, telegramUserId))
      .run();
    return { ok: true, changed: true, count: events.length };
  } catch (err) {
    const error = safeErrorMessage(err, url);
    const failures = feed.failures + 1;
    const t = now();
    db.update(calendarFeeds)
      .set({ lastPolledAt: t.toISOString(), lastError: error, failures, nextPollAt: new Date(t.getTime() + backoffMs(failures)).toISOString() })
      .where(eq(calendarFeeds.telegramUserId, telegramUserId))
      .run();
    console.warn(`Feed poll failed for user ${telegramUserId}: ${error}`);
    return { ok: false, error };
  }
}

/** Fetches one user's feed now (conditional GET) and stores the result. Never throws. */
export function pollFeed(telegramUserId: number, now: () => Date = () => new Date()): Promise<PollResult> {
  const running = inFlight.get(telegramUserId);
  if (running) return running;
  const p = doPoll(telegramUserId, now).finally(() => inFlight.delete(telegramUserId));
  inFlight.set(telegramUserId, p);
  return p;
}

/** Polls every feed whose next_poll_at is due, one at a time. */
export async function pollDueFeeds(now = new Date()) {
  const due = db
    .select({ id: calendarFeeds.telegramUserId })
    .from(calendarFeeds)
    .where(or(isNull(calendarFeeds.nextPollAt), lte(calendarFeeds.nextPollAt, now.toISOString())))
    .all();
  for (const { id } of due) await pollFeed(id);
  return due.length;
}

/** Starts the background poller. Returns a stop function. */
export function startFeedPoller(): () => void {
  if (!feedKey()) {
    console.log('Calendar feeds are off (set FEED_ENCRYPTION_KEY to 32 bytes of base64)');
    return () => {};
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await pollDueFeeds();
    } catch (err) {
      console.error('Feed poller tick failed', safeErrorMessage(err));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
