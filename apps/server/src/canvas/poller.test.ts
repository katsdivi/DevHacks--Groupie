import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { env } from '../env.ts';
import { db, schema } from '../db/index.ts';
import { feedStatus, getFeed, saveFeed, upcomingEvents } from './feeds.ts';
import { MAX_BACKOFF_MS, backoffMs, pollDueFeeds, pollFeed, setFeedFetch } from './poller.ts';

const sample = fs.readFileSync(new URL('../../../../fixtures/feed/sample.ics', import.meta.url), 'utf8');
const FEED = 'https://canvas.asu.edu/feeds/calendars/user_pollerSECRET42.ics';
const USER = 777;

type Call = { url: string; headers: Record<string, string> };
let calls: Call[] = [];
let next: () => Response | Promise<Response>;
const logs = vi.fn();

beforeAll(() => {
  env.feedEncryptionKey = randomBytes(32).toString('base64');
  setFeedFetch(async (input, init) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    return next();
  });
  for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a) => logs(...a));
});
afterAll(() => {
  // The secret URL must never reach a log line.
  for (const call of logs.mock.calls) expect(JSON.stringify(call)).not.toContain('pollerSECRET42');
  vi.restoreAllMocks();
});
beforeEach(() => {
  calls = [];
  db.delete(schema.calendarEvents).run();
  db.delete(schema.calendarFeeds).run();
  saveFeed(USER, FEED);
});

const ics = (body = sample, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers });
const event = (uid: string) =>
  db.select().from(schema.calendarEvents).where(and(eq(schema.calendarEvents.telegramUserId, USER), eq(schema.calendarEvents.uid, uid))).get();

describe('pollFeed', () => {
  it('fetches the decrypted URL and upserts every event', async () => {
    next = () => ics(sample, { etag: '"v1"', 'last-modified': 'Sat, 24 Oct 2026 12:00:00 GMT' });
    expect(await pollFeed(USER)).toEqual({ ok: true, changed: true, count: 9 });
    expect(calls[0].url).toBe(FEED);
    const s = feedStatus(USER);
    expect(s).toMatchObject({ connected: true, lastError: null, eventCount: 9, courses: ['CSE 340 (Fall 2026)', 'HST 101 (Fall 2026)'] });
    expect(getFeed(USER)).toMatchObject({ etag: '"v1"', lastModified: 'Sat, 24 Oct 2026 12:00:00 GMT', failures: 0 });
    // Polling the same feed again updates in place (no duplicates).
    await pollFeed(USER);
    expect(db.select().from(schema.calendarEvents).all()).toHaveLength(9);
  });

  it('sends conditional headers and treats 304 as no change', async () => {
    next = () => ics(sample, { etag: '"v1"', 'last-modified': 'Sat, 24 Oct 2026 12:00:00 GMT' });
    await pollFeed(USER);
    next = () => new Response(null, { status: 304 });
    expect(await pollFeed(USER)).toEqual({ ok: true, changed: false, count: 0 });
    expect(calls[1].headers).toMatchObject({ 'if-none-match': '"v1"', 'if-modified-since': 'Sat, 24 Oct 2026 12:00:00 GMT' });
    expect(feedStatus(USER).eventCount).toBe(9);
  });

  it('marks UIDs missing from the feed as removed and clears it when they return', async () => {
    next = () => ics();
    await pollFeed(USER);
    const without = sample.replace(/BEGIN:VEVENT\r?\n(?:(?!END:VEVENT)[\s\S])*UID:event-assignment-7654322[\s\S]*?END:VEVENT\r?\n/, '');
    next = () => ics(without);
    await pollFeed(USER);
    expect(event('event-assignment-7654322')?.removedAt).not.toBeNull();
    expect(event('event-assignment-7654321')?.removedAt).toBeNull();
    expect(feedStatus(USER).eventCount).toBe(8);
    next = () => ics();
    await pollFeed(USER);
    expect(event('event-assignment-7654322')?.removedAt).toBeNull();
  });

  it('never treats a non-calendar body as an empty feed', async () => {
    next = () => ics();
    await pollFeed(USER);
    next = () => ics('<html>Please log in</html>');
    expect((await pollFeed(USER)).ok).toBe(false);
    expect(feedStatus(USER).eventCount).toBe(9);
  });

  it('backs off on failure with a redacted error', async () => {
    const t0 = new Date('2026-10-24T12:00:00Z');
    next = () => {
      throw Object.assign(new TypeError(`fetch failed for ${FEED}`), { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND canvas.asu.edu' } });
    };
    const r = await pollFeed(USER, () => t0);
    expect(r.ok).toBe(false);
    let f = getFeed(USER)!;
    expect(f.failures).toBe(1);
    expect(f.lastError).not.toContain('pollerSECRET42');
    expect(f.lastError).not.toContain('canvas.asu.edu');
    expect(new Date(f.nextPollAt!).getTime() - t0.getTime()).toBe(backoffMs(1));
    next = () => new Response('nope', { status: 500 });
    await pollFeed(USER, () => t0);
    f = getFeed(USER)!;
    expect(f.failures).toBe(2);
    expect(f.lastError).toBe('Canvas answered HTTP 500');
    expect(new Date(f.nextPollAt!).getTime() - t0.getTime()).toBe(backoffMs(2));
    expect(backoffMs(2)).toBe(2 * backoffMs(1));
    expect(backoffMs(50)).toBe(MAX_BACKOFF_MS);
    expect(JSON.stringify(feedStatus(USER))).not.toContain('pollerSECRET42');
    // Success resets the counter.
    next = () => ics();
    await pollFeed(USER);
    expect(getFeed(USER)).toMatchObject({ failures: 0, lastError: null });
  });

  it('times out slow feeds', async () => {
    next = () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    };
    await pollFeed(USER);
    expect(getFeed(USER)!.lastError).toBe('Timed out reaching Canvas');
  });
});

describe('pollDueFeeds and upcoming', () => {
  it('polls only feeds that are due', async () => {
    next = () => ics();
    expect(await pollDueFeeds()).toBe(1);
    expect(await pollDueFeeds()).toBe(0); // next poll is 30 minutes out
    expect(calls).toHaveLength(1);
  });

  it('lists upcoming items soonest first, skipping past and removed ones', async () => {
    next = () => ics();
    await pollFeed(USER);
    const now = new Date('2026-10-28T00:00:00Z');
    const list = upcomingEvents(USER, now);
    expect(list[0].uid).toBe('event-assignment-7654322'); // Oct 28 06:59Z
    expect(list.every((e) => e.dueAt >= now.toISOString())).toBe(true);
    expect(list.map((e) => e.dueAt)).toEqual([...list.map((e) => e.dueAt)].sort());
    expect(list.find((e) => e.uid === 'event-assignment-8800001')).toBeUndefined(); // Oct 27, past
  });
});
