import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { CalendarStatusResponse, GoogleStartResponse } from '@groupie/shared';
import { env } from '../env.ts';
import { db, schema } from '../db/index.ts';
import { decryptSecret } from '../canvas/crypto.ts';
import { calendarRouter } from './calendar.ts';
import { googleCallbackRouter } from './googleCallback.ts';
import { FREEBUSY_SCOPE, setGoogleUserClient, signOAuthState, verifyOAuthState, type GoogleUserClient } from '../googleUser.ts';
import { setIcsFetch, setIcsResolver } from '../icsBusy.ts';
import { busyBlocksFor, replaceBusyBlocks } from '../busy.ts';
import { resetSyncState, syncAll, syncCanvasBlocks, syncConnection } from '../calendarSync.ts';

const USER = 4242;
const OTHER = 4343;
const REFRESH = '1//REFRESHsecretTOKEN0123456789';
const CODE = '4/CODEsecret987';
const ICS_SECRET = 'privateSECRETabc123';
const ICS_URL = `https://calendar.google.com/calendar/ical/me%40gmail.com/${ICS_SECRET}/basic.ics`;
const NOW = new Date('2026-10-26T00:00:00Z');
const ICS = [
  'BEGIN:VCALENDAR',
  'X-WR-TIMEZONE:America/Phoenix',
  'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Secret Therapy Appointment', 'DTSTART:20261027T100000', 'DTEND:20261027T110000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Free time', 'TRANSP:TRANSPARENT', 'DTSTART:20261028T100000', 'DTEND:20261028T110000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:c', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261029', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:d', 'SUMMARY:Interview', 'DTSTART;TZID=America/New_York:20261030T090000', 'DTEND;TZID=America/New_York:20261030T093000', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const logs = vi.fn();
const seen: string[] = [];
let base = '';
let close: () => Promise<void>;
let icsResponse: () => Response | Promise<Response>;
const google = {
  authUrl: vi.fn((state: string) => `https://accounts.example.test/auth?state=${state}`),
  exchangeCode: vi.fn(async () => ({ refreshToken: REFRESH, scope: FREEBUSY_SCOPE })),
  freeBusy: vi.fn(async () => [
    { start: '2026-10-27T16:00:00Z', end: '2026-10-27T17:00:00Z' },
    { start: '2026-10-28T18:00:00Z', end: '2026-10-28T19:30:00Z' },
  ]),
  revoke: vi.fn(async () => {}),
} satisfies GoogleUserClient;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a) => logs(...a));
  Object.assign(env, {
    googleUserClientId: 'cid.apps.googleusercontent.com',
    googleUserClientSecret: 'client-secret',
    publicUrl: 'https://groupie.example.test',
    linkSigningSecret: 'link-secret',
    feedEncryptionKey: randomBytes(32).toString('base64'),
  });
  setIcsResolver(async () => ['93.184.216.34']);
  setIcsFetch(async () => icsResponse());
  const app = express();
  app.use(express.json());
  app.use('/api', googleCallbackRouter);
  app.use('/api', (req, res, next) => {
    const id = Number(req.header('x-test-user'));
    if (!id) return void res.status(401).json({ error: 'unauthorized' });
    res.locals.tgUser = { id, first_name: 'Test' };
    next();
  });
  app.use('/api', calendarRouter);
  const server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise<void>((r) => server.close(() => r()));
});

afterAll(async () => {
  await close();
  // Secrets and titles never reach a response or a log line.
  for (const s of [REFRESH, CODE, ICS_SECRET, 'Therapy', 'Interview']) {
    for (const body of seen) expect(body).not.toContain(s);
    for (const call of logs.mock.calls) expect(JSON.stringify(call)).not.toContain(s);
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  db.delete(schema.calendarConnections).run();
  db.delete(schema.busyBlocks).run();
  db.delete(schema.calendarEvents).run();
  resetSyncState();
  setGoogleUserClient(google);
  icsResponse = () => new Response(ICS, { status: 200 });
  env.googleUserClientId = 'cid.apps.googleusercontent.com';
});

async function call(method: string, path: string, body?: unknown, user: number | null = USER) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user) headers['x-test-user'] = String(user);
  const res = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  seen.push(text);
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    // html
  }
  return { status: res.status, text, body: json };
}

const blocks = (user = USER, source?: string) =>
  db
    .select()
    .from(schema.busyBlocks)
    .where(and(eq(schema.busyBlocks.telegramUserId, user), source ? eq(schema.busyBlocks.source, source as 'ics') : undefined))
    .all();

describe('OAuth state', () => {
  it('round trips the user id and expires after 10 minutes', () => {
    const now = 1_800_000_000;
    const s = signOAuthState(USER, 'k', undefined, now);
    expect(verifyOAuthState(s, 'k', now + 599)).toBe(USER);
    expect(verifyOAuthState(s, 'k', now + 601)).toBeNull();
    expect(verifyOAuthState(s, 'other', now)).toBeNull();
    expect(verifyOAuthState(`${s}x`, 'k', now)).toBeNull();
    const [body, sig] = s.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), u: 1 })).toString('base64url');
    expect(verifyOAuthState(`${forged}.${sig}`, 'k', now)).toBeNull();
  });
});

describe('GET /api/calendar/google/start', () => {
  it('needs auth', async () => {
    expect((await call('GET', '/calendar/google/start', undefined, null)).status).toBe(401);
  });

  it('returns a consent URL with the free/busy scope, offline access, and signed state', async () => {
    const { realGoogleUserClient } = await import('../googleUser.ts');
    setGoogleUserClient({ ...google, authUrl: realGoogleUserClient.authUrl });
    const r = await call('GET', '/calendar/google/start');
    const u = new URL(GoogleStartResponse.parse(r.body).url);
    expect(u.host).toBe('accounts.google.com');
    expect(u.searchParams.get('scope')).toBe(FREEBUSY_SCOPE);
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('redirect_uri')).toBe('https://groupie.example.test/api/google/callback');
    expect(verifyOAuthState(u.searchParams.get('state')!, env.linkSigningSecret)).toBe(USER);
  });

  it('is 503 and google_available is false without a client id', async () => {
    env.googleUserClientId = '';
    expect((await call('GET', '/calendar/google/start')).status).toBe(503);
    expect(CalendarStatusResponse.parse((await call('GET', '/calendar/status')).body).google_available).toBe(false);
  });
});

describe('GET /api/google/callback', () => {
  it('stores the refresh token encrypted, syncs free/busy, and shows the success page', async () => {
    const state = signOAuthState(USER, env.linkSigningSecret);
    const r = await call('GET', `/google/callback?code=${encodeURIComponent(CODE)}&state=${state}`, undefined, null);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Calendar connected.');
    expect(r.text).toContain('You can go back to Telegram.');
    expect(google.exchangeCode).toHaveBeenCalledWith(CODE);
    const row = db.select().from(schema.calendarConnections).get()!;
    expect(row).toMatchObject({ telegramUserId: USER, kind: 'google', lastError: null });
    expect(row.tokenEncrypted).not.toContain(REFRESH);
    expect(decryptSecret(row.tokenEncrypted!)).toBe(REFRESH);
    expect(google.freeBusy).toHaveBeenCalledWith(REFRESH, NOW.toISOString(), '2026-11-09T00:00:00.000Z');
    const stored = blocks(USER, 'google');
    expect(stored.map((b) => [b.startAt, b.endAt])).toEqual([
      ['2026-10-27T16:00:00.000Z', '2026-10-27T17:00:00.000Z'],
      ['2026-10-28T18:00:00.000Z', '2026-10-28T19:30:00.000Z'],
    ]);
    expect(Object.keys(stored[0]).sort()).toEqual(['endAt', 'id', 'source', 'startAt', 'telegramUserId']);
  });

  it('rejects a bad or expired state with an error page and stores nothing', async () => {
    const old = signOAuthState(USER, env.linkSigningSecret, 600, Math.floor(NOW.getTime() / 1000) - 700);
    for (const state of [old, 'garbage', '']) {
      const r = await call('GET', `/google/callback?code=x&state=${state}`, undefined, null);
      expect(r.status).toBe(400);
      expect(r.text).toContain('This link expired');
    }
    expect(db.select().from(schema.calendarConnections).all()).toHaveLength(0);
  });

  it('shows an error page when the user declines or the scope is missing', async () => {
    const state = signOAuthState(USER, env.linkSigningSecret);
    expect((await call('GET', `/google/callback?error=access_denied&state=${state}`, undefined, null)).text).toContain('Calendar not connected');
    google.exchangeCode.mockResolvedValueOnce({ refreshToken: REFRESH, scope: 'openid' });
    expect((await call('GET', `/google/callback?code=x&state=${state}`, undefined, null)).text).toContain('keep that box checked');
    google.exchangeCode.mockRejectedValueOnce(new Error(`invalid code ${CODE}`));
    expect((await call('GET', `/google/callback?code=${CODE}&state=${state}`, undefined, null)).status).toBe(502);
    expect(db.select().from(schema.calendarConnections).all()).toHaveLength(0);
  });

  it('records a redacted error when Google refuses the refresh token', async () => {
    const state = signOAuthState(USER, env.linkSigningSecret);
    google.freeBusy.mockRejectedValueOnce(new Error(`invalid_grant for ${REFRESH}`));
    await call('GET', `/google/callback?code=x&state=${state}`, undefined, null);
    const s = CalendarStatusResponse.parse((await call('GET', '/calendar/status')).body);
    expect(s.connections.find((c) => c.kind === 'google')).toMatchObject({ connected: true, last_error: expect.stringMatching(/Connect Google Calendar again/) });
  });
});

describe('PUT /api/calendar/ics', () => {
  it('saves the link encrypted, syncs busy blocks without titles, and never returns the link', async () => {
    const r = await call('PUT', '/calendar/ics', { url: ICS_URL.replace('https://', 'webcal://') });
    expect(r.status).toBe(200);
    const s = CalendarStatusResponse.parse(r.body);
    expect(s.connections.find((c) => c.kind === 'ics')).toMatchObject({ connected: true, last_error: null });
    expect(s.busy_block_count).toBe(2);
    expect(blocks(USER, 'ics').map((b) => [b.startAt, b.endAt])).toEqual([
      ['2026-10-27T17:00:00.000Z', '2026-10-27T18:00:00.000Z'], // Phoenix floating
      ['2026-10-30T13:00:00.000Z', '2026-10-30T13:30:00.000Z'], // TZID New York
    ]);
    const row = db.select().from(schema.calendarConnections).get()!;
    expect(row.icsUrlEncrypted).not.toContain(ICS_SECRET);
    expect(decryptSecret(row.icsUrlEncrypted!)).toBe(ICS_URL);
  });

  it.each(['http://example.com/a.ics', 'https://127.0.0.1/a.ics', 'https://localhost/a.ics', 'nope', `https://x.com/${'a'.repeat(2000)}`])(
    'rejects %s',
    async (url) => {
      const r = await call('PUT', '/calendar/ics', { url });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('bad_ics_url');
      expect(db.select().from(schema.calendarConnections).all()).toHaveLength(0);
    },
  );

  it('redacts the link from fetch errors', async () => {
    icsResponse = () => {
      throw new Error(`connect ECONNREFUSED ${ICS_URL}`);
    };
    const r = await call('PUT', '/calendar/ics', { url: ICS_URL });
    const ics = CalendarStatusResponse.parse(r.body).connections.find((c) => c.kind === 'ics')!;
    expect(ics.last_error).toContain('[link]');
    expect(ics.last_error).not.toContain('calendar.google.com');
    const row = db.select().from(schema.calendarConnections).get()!;
    expect(row.lastError).not.toContain(ICS_SECRET);
  });

  it('records HTTP errors and backs off in the background job', async () => {
    icsResponse = () => new Response('gone', { status: 404 });
    await call('PUT', '/calendar/ics', { url: ICS_URL });
    let fetches = 0;
    icsResponse = () => {
      fetches++;
      return new Response(ICS);
    };
    await syncAll();
    expect(fetches).toBe(0); // still backing off
    await call('POST', '/calendar/sync');
    expect(fetches).toBe(1); // manual sync ignores backoff
  });
});

describe('status and disconnect', () => {
  it('lists both kinds without links or tokens', async () => {
    const s = CalendarStatusResponse.parse((await call('GET', '/calendar/status')).body);
    expect(s).toEqual({
      google_available: true,
      connections: [
        { kind: 'google', connected: false, last_sync_at: null, last_error: null },
        { kind: 'ics', connected: false, last_sync_at: null, last_error: null },
      ],
      busy_block_count: 0,
    });
  });

  it('DELETE removes the link and only that source of blocks', async () => {
    await call('PUT', '/calendar/ics', { url: ICS_URL });
    replaceBusyBlocks(USER, 'google', [{ start: '2026-10-27T20:00:00Z', end: '2026-10-27T21:00:00Z' }]);
    expect(blocks(USER, 'ics')).toHaveLength(2);
    const r = await call('DELETE', '/calendar/ics');
    expect(r.status).toBe(200);
    expect(blocks(USER, 'ics')).toHaveLength(0);
    expect(blocks(USER, 'google')).toHaveLength(1);
    expect(db.select().from(schema.calendarConnections).all()).toHaveLength(0);
    expect((await call('DELETE', '/calendar/zoom')).status).toBe(400);
  });

  it('DELETE google revokes and forgets the token', async () => {
    const state = signOAuthState(USER, env.linkSigningSecret);
    await call('GET', `/google/callback?code=x&state=${state}`, undefined, null);
    expect(blocks(USER, 'google')).toHaveLength(2);
    await call('DELETE', '/calendar/google');
    expect(google.revoke).toHaveBeenCalledWith(REFRESH);
    expect(blocks(USER, 'google')).toHaveLength(0);
    expect(db.select().from(schema.calendarConnections).all()).toHaveLength(0);
  });
});

describe('Canvas busy blocks', () => {
  const ev = (uid: string, kind: 'event' | 'assignment', dueAt: string, removedAt: string | null = null) =>
    db.insert(schema.calendarEvents).values({ telegramUserId: USER, uid, course: 'CSE 340', title: `Title ${uid}`, dueAt, kind, removedAt, updatedAt: NOW.toISOString() }).run();

  it('turns timed events into one hour blocks and ignores due dates, all-day, removed, and far events', () => {
    ev('event-1', 'event', '2026-10-27T19:00:00.000Z');
    ev('event-assignment-2', 'assignment', '2026-10-28T06:59:00.000Z');
    ev('event-3', 'event', '2026-10-29T07:00:00.000Z'); // Phoenix midnight: all-day
    ev('event-4', 'event', '2026-10-30T19:00:00.000Z', NOW.toISOString());
    ev('event-5', 'event', '2026-12-30T19:00:00.000Z');
    expect(syncCanvasBlocks(USER)).toBe(1);
    expect(blocks(USER, 'canvas').map((b) => [b.startAt, b.endAt])).toEqual([['2026-10-27T19:00:00.000Z', '2026-10-27T20:00:00.000Z']]);
  });

  it('syncAll refreshes Canvas blocks and clears them when events go away', async () => {
    ev('event-1', 'event', '2026-10-27T19:00:00.000Z');
    await syncAll();
    expect(blocks(USER, 'canvas')).toHaveLength(1);
    db.update(schema.calendarEvents).set({ removedAt: NOW.toISOString() }).run();
    await syncAll();
    expect(blocks(USER, 'canvas')).toHaveLength(0);
  });
});

describe('busyBlocksFor', () => {
  it('returns blocks overlapping [from, to) for that user only, soonest first', () => {
    replaceBusyBlocks(USER, 'ics', [
      { start: '2026-10-27T10:00:00Z', end: '2026-10-27T11:00:00Z' },
      { start: '2026-10-27T08:00:00Z', end: '2026-10-27T09:00:00Z' },
    ]);
    replaceBusyBlocks(USER, 'canvas', [{ start: '2026-10-27T12:00:00Z', end: '2026-10-27T13:00:00Z' }]);
    replaceBusyBlocks(OTHER, 'ics', [{ start: '2026-10-27T10:00:00Z', end: '2026-10-27T11:00:00Z' }]);
    expect(busyBlocksFor(USER, '2026-10-27T00:00:00Z', '2026-10-28T00:00:00Z')).toEqual([
      { startAt: '2026-10-27T08:00:00.000Z', endAt: '2026-10-27T09:00:00.000Z', source: 'ics' },
      { startAt: '2026-10-27T10:00:00.000Z', endAt: '2026-10-27T11:00:00.000Z', source: 'ics' },
      { startAt: '2026-10-27T12:00:00.000Z', endAt: '2026-10-27T13:00:00.000Z', source: 'canvas' },
    ]);
    // Edges: a block ending exactly at `from` or starting exactly at `to` is not included.
    expect(busyBlocksFor(USER, new Date('2026-10-27T09:00:00Z'), new Date('2026-10-27T10:00:00Z'))).toEqual([]);
    expect(busyBlocksFor(USER, '2026-10-27T10:30:00Z', '2026-10-27T10:31:00Z')).toHaveLength(1);
    expect(busyBlocksFor(OTHER, '2026-10-27T00:00:00Z', '2026-10-28T00:00:00Z')).toHaveLength(1);
  });

  it('replacing one source is atomic and merges overlaps', async () => {
    replaceBusyBlocks(USER, 'ics', [
      { start: '2026-10-27T10:00:00Z', end: '2026-10-27T11:00:00Z' },
      { start: '2026-10-27T10:30:00Z', end: '2026-10-27T12:00:00Z' },
      { start: 'bad', end: '2026-10-27T12:00:00Z' },
    ]);
    expect(busyBlocksFor(USER, '2026-10-27T00:00:00Z', '2026-10-28T00:00:00Z')).toEqual([
      { startAt: '2026-10-27T10:00:00.000Z', endAt: '2026-10-27T12:00:00.000Z', source: 'ics' },
    ]);
    expect(await syncConnection(USER, 'ics')).toEqual({ ok: false, error: 'not_connected' });
  });
});
