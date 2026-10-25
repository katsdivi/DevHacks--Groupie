import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAIR_CODE_TTL_MS, PairCodeResponse, PairCodeStatusResponse, FeedStatusResponse } from '@groupie/shared';
import { env } from '../env.ts';
import { db, schema } from '../db/index.ts';
import { isGroupMember } from '../auth.ts';
import { upsertGroup } from '../groups.ts';
import { createPairCode } from './pairCodes.ts';
import { setFeedFetch } from './poller.ts';
import { startTestApp } from './testApp.ts';
import { canvasCodeText } from './bot.ts';

vi.mock('../auth.ts', async (orig) => ({ ...(await orig<typeof import('../auth.ts')>()), isGroupMember: vi.fn(async () => true) }));

const sample = fs.readFileSync(new URL('../../../../fixtures/feed/sample.ics', import.meta.url), 'utf8');
const SECRET_PART = 'user_routesSECRET99';
const FEED = `https://canvas.asu.edu/feeds/calendars/${SECRET_PART}.ics`;
const USER = 5150;
const GROUP = -2002;
let app: Awaited<ReturnType<typeof startTestApp>>;
const logs = vi.fn();
const seen: string[] = [];

beforeAll(async () => {
  app = await startTestApp();
  upsertGroup(GROUP, 'Team');
  for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a) => logs(...a));
});
afterAll(async () => {
  await app.close();
  for (const body of seen) expect(body).not.toContain(SECRET_PART);
  for (const call of logs.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET_PART);
  vi.restoreAllMocks();
});
beforeEach(() => {
  env.feedEncryptionKey = randomBytes(32).toString('base64');
  setFeedFetch(async () => new Response(sample, { status: 200, headers: { etag: '"a"' } }));
});

async function call(method: string, path: string, body?: unknown, user: number | null = USER) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user) headers['x-test-user'] = String(user);
  const res = await fetch(`${app.base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  seen.push(text);
  return { status: res.status, body: JSON.parse(text) as Record<string, unknown> };
}

describe('POST /api/cubbie/pair-code', () => {
  it('needs auth', async () => {
    expect((await call('POST', '/cubbie/pair-code', {}, null)).status).toBe(401);
  });
  it('makes a code without a group (no body at all)', async () => {
    const res = await fetch(`${app.base}/api/cubbie/pair-code`, { method: 'POST', headers: { 'x-test-user': String(USER) } });
    const body = PairCodeResponse.parse(await res.json());
    expect(body.cubbieMessage).toBe(`Groupie import ${body.code}`);
    const row = db.select().from(schema.cubbiePairCodes).all().find((r) => r.code === body.code)!;
    expect(row).toMatchObject({ telegramUserId: USER, groupChatId: null, usedAt: null });
    expect(new Date(body.expiresAt).getTime() - new Date(row.createdAt).getTime()).toBe(PAIR_CODE_TTL_MS);
  });
  it('ties the code to a group the caller is in', async () => {
    const r = await call('POST', '/cubbie/pair-code', { groupChatId: GROUP });
    expect(r.status).toBe(200);
    expect(db.select().from(schema.cubbiePairCodes).all().find((x) => x.code === r.body.code)?.groupChatId).toBe(GROUP);
  });
  it('rejects groups the caller is not in, or unknown groups', async () => {
    vi.mocked(isGroupMember).mockResolvedValueOnce(false);
    expect((await call('POST', '/cubbie/pair-code', { groupChatId: GROUP })).body.error).toBe('not_a_member');
    expect((await call('POST', '/cubbie/pair-code', { groupChatId: -999 })).status).toBe(404);
    expect((await call('POST', '/cubbie/pair-code', { groupChatId: 'x' })).status).toBe(400);
  });
});

describe('GET /api/cubbie/pair-code/:code', () => {
  it('reports waiting, then the latest import', async () => {
    const pc = createPairCode(USER, GROUP);
    expect(PairCodeStatusResponse.parse((await call('GET', `/cubbie/pair-code/${pc.code.toLowerCase()}`)).body)).toMatchObject({ status: 'waiting' });
    db.insert(schema.cubbieImports)
      .values({ pairCode: pc.code, telegramUserId: USER, groupChatId: GROUP, payload: { assignment: { title: 'P2' } }, status: 'failed', error: 'nope', createdAt: new Date().toISOString() })
      .run();
    expect((await call('GET', `/cubbie/pair-code/${pc.code}`)).body).toMatchObject({ status: 'failed', assignmentTitle: 'P2', error: 'nope' });
  });
  it('reports expired codes', async () => {
    const pc = createPairCode(USER, null, new Date(Date.now() - PAIR_CODE_TTL_MS - 1));
    expect((await call('GET', `/cubbie/pair-code/${pc.code}`)).body.status).toBe('expired');
  });
  it('hides other people\'s codes and junk as unknown', async () => {
    const pc = createPairCode(USER + 1, null);
    expect((await call('GET', `/cubbie/pair-code/${pc.code}`)).status).toBe(404);
    expect((await call('GET', '/cubbie/pair-code/0O1IL0')).body.error).toBe('unknown_code');
  });
});

describe('feed endpoints', () => {
  it('rejects feeds from other hosts', async () => {
    const r = await call('PUT', '/feed', { feedUrl: 'https://evil.example/feeds/x.ics' });
    expect(r).toMatchObject({ status: 400, body: { error: 'bad_feed_url' } });
  });
  it('refuses to store feeds without a valid key', async () => {
    env.feedEncryptionKey = 'c2hvcnQ=';
    expect((await call('PUT', '/feed', { feedUrl: FEED })).status).toBe(503);
  });
  it('saves encrypted, polls right away, and reports status without the URL', async () => {
    const r = await call('PUT', '/feed', { feedUrl: FEED.replace('https://', 'webcal://') });
    expect(r.status).toBe(200);
    expect(FeedStatusResponse.parse(r.body)).toMatchObject({ connected: true, eventCount: 9, lastError: null });
    const row = db.select().from(schema.calendarFeeds).all().find((f) => f.telegramUserId === USER)!;
    expect(row.feedUrlEncrypted).not.toContain(SECRET_PART);
    expect((await call('GET', '/feed/status')).body.courses).toEqual(['CSE 340 (Fall 2026)', 'HST 101 (Fall 2026)']);
    const up = await call('GET', '/feed/upcoming');
    const events = up.body.events as { dueAt: string }[];
    expect(events.length).toBeGreaterThan(0);
    expect(events.map((e) => e.dueAt)).toEqual([...events.map((e) => e.dueAt)].sort());
  });
  it('keeps the URL out of errors when the poll fails', async () => {
    setFeedFetch(async () => {
      throw new TypeError(`fetch failed ${FEED}`);
    });
    const r = await call('PUT', '/feed', { feedUrl: FEED });
    expect(r.body.connected).toBe(true);
    expect(String(r.body.lastError)).toContain('[feed url]');
  });
  it('disconnects and deletes events', async () => {
    await call('PUT', '/feed', { feedUrl: FEED });
    const r = await call('DELETE', '/feed');
    expect(r.body).toMatchObject({ connected: false, eventCount: 0 });
    expect(db.select().from(schema.calendarEvents).all().filter((e) => e.telegramUserId === USER)).toHaveLength(0);
    expect((await call('GET', '/feed/upcoming')).body.events).toEqual([]);
  });
});

describe('/canvas reply', () => {
  it('shows the code, the exact Cubbie message, and the time limit', () => {
    const t = canvasCodeText('K7Q2MX');
    expect(t).toContain('<code>Groupie import K7Q2MX</code>');
    expect(t).toContain('text Cubbie this within 15 minutes');
    expect(t).toContain('Install this skill: https://github.com/katsdivi/groupie-cubbie-skill/tree/main/groupie-import');
  });
});
