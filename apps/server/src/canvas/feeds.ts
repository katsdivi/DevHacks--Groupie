import { and, asc, eq, gte, isNull, notLike } from 'drizzle-orm';
import type { FeedEvent, FeedStatusResponse } from '@groupie/shared';
import { db, schema } from '../db/index.ts';
import { encryptSecret } from './crypto.ts';

const { calendarFeeds, calendarEvents } = schema;

export const REDACTED = '[feed url]';

/**
 * Removes a feed URL from any text (error messages, logs). Pass the real URL when known; it also strips
 * anything that looks like a feed link or the feed host, since fetch errors can quote either.
 */
export function redactFeedUrl(text: string, url?: string | null): string {
  let out = text;
  if (url) {
    out = out.split(url).join(REDACTED);
    try {
      const u = new URL(url);
      out = out.split(u.pathname).join(REDACTED).split(u.host).join(REDACTED);
    } catch {
      // not a URL, nothing more to strip
    }
  }
  return out
    .replace(/\b(?:https?|webcal):\/\/[^\s"'<>]*/gi, (m) => (/\/feeds\//i.test(m) ? REDACTED : m))
    .replace(/\/feeds\/[^\s"'<>]*/gi, REDACTED)
    .replace(/canvas\.asu\.edu/gi, REDACTED);
}

/** Error to a short, URL-free message for `last_error` and logs. */
export function safeErrorMessage(err: unknown, url?: string | null): string {
  const e = err as { name?: string; message?: string; cause?: { message?: string; code?: string } };
  let msg = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'Timed out reaching Canvas' : (e?.message ?? String(err));
  if (e?.cause?.code) msg += ` (${e.cause.code})`;
  return redactFeedUrl(msg, url).slice(0, 300);
}

export const getFeed = (telegramUserId: number) =>
  db.select().from(calendarFeeds).where(eq(calendarFeeds.telegramUserId, telegramUserId)).get();

/** Encrypts and saves the feed, resetting poll state so the next poll is a full fetch. */
export function saveFeed(telegramUserId: number, feedUrl: string, now = new Date()) {
  const feedUrlEncrypted = encryptSecret(feedUrl);
  const reset = { feedUrlEncrypted, etag: null, lastModified: null, lastError: null, failures: 0, nextPollAt: now.toISOString() };
  db.insert(calendarFeeds)
    .values({ telegramUserId, createdAt: now.toISOString(), ...reset })
    .onConflictDoUpdate({ target: calendarFeeds.telegramUserId, set: reset })
    .run();
}

/** Disconnects the feed and forgets its events (Cubbie imports are kept: they did not come from the feed). */
export function deleteFeed(telegramUserId: number) {
  db.transaction((tx) => {
    tx.delete(calendarFeeds).where(eq(calendarFeeds.telegramUserId, telegramUserId)).run();
    tx.delete(calendarEvents)
      .where(and(eq(calendarEvents.telegramUserId, telegramUserId), notLike(calendarEvents.uid, 'cubbie-import-%')))
      .run();
  });
}

const liveEvents = (telegramUserId: number) =>
  db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.telegramUserId, telegramUserId), isNull(calendarEvents.removedAt)))
    .all();

export function feedStatus(telegramUserId: number): FeedStatusResponse {
  const feed = getFeed(telegramUserId);
  const events = feed ? liveEvents(telegramUserId) : [];
  const courses = [...new Set(events.map((e) => e.course).filter((c): c is string => !!c))].sort();
  return {
    connected: !!feed,
    lastPolledAt: feed?.lastPolledAt ?? null,
    lastError: feed?.lastError ? redactFeedUrl(feed.lastError) : null,
    eventCount: events.length,
    courses,
  };
}

/** The caller's items due from now on, soonest first. */
export function upcomingEvents(telegramUserId: number, now = new Date(), limit = 50): FeedEvent[] {
  return db
    .select()
    .from(calendarEvents)
    .where(
      and(eq(calendarEvents.telegramUserId, telegramUserId), isNull(calendarEvents.removedAt), gte(calendarEvents.dueAt, now.toISOString())),
    )
    .orderBy(asc(calendarEvents.dueAt))
    .limit(limit)
    .all()
    .map((e) => ({ uid: e.uid, course: e.course, title: e.title, dueAt: e.dueAt, description: e.description, url: e.url, kind: e.kind }));
}
