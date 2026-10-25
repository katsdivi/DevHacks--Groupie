import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrefsResponse } from '@groupie/shared';
import { db, schema } from '../db/index.ts';
import { env } from '../env.ts';
import { getPrefs, markCannotDm, setCanDm } from '../prefs.ts';
import { prefsRouter } from './prefs.ts';

const ME = 8101;
const OTHER = 8102;
let base = '';
let close: () => Promise<void>;

/** Same shape as the real mount: JSON body, fake auth from `x-test-user`, then the router. */
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res, next) => {
    const id = Number(req.header('x-test-user'));
    if (!id) return void res.status(401).json({ error: 'unauthorized' });
    res.locals.tgUser = { id, first_name: 'Test' };
    next();
  });
  app.use('/api', prefsRouter);
  const server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise<void>((r) => server.close(() => r()));
});
afterAll(() => close());
beforeEach(() => {
  db.delete(schema.userPrefs).run();
});

async function call(method: string, body?: unknown, user: number | null = ME) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user) headers['x-test-user'] = String(user);
  const res = await fetch(`${base}/api/me/prefs`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('GET /api/me/prefs', () => {
  it('needs auth', async () => {
    expect((await call('GET', undefined, null)).status).toBe(401);
  });
  it('creates defaults lazily with the start link', async () => {
    const res = await call('GET');
    expect(res.status).toBe(200);
    expect(PrefsResponse.parse(res.body)).toEqual({
      reminders_enabled: true,
      reminder_offsets: [48, 24, 3],
      quiet_start: '23:00',
      quiet_end: '08:00',
      tz: env.defaultTz,
      can_dm: false,
      start_link: `https://t.me/${env.botUsername}?start=reminders`,
    });
  });
});

describe('PUT /api/me/prefs', () => {
  it('saves, dedupes, and sorts offsets descending', async () => {
    const res = await call('PUT', { reminder_offsets: [3, 48, 24, 48], reminders_enabled: false, quiet_start: '22:30', tz: 'Asia/Kolkata' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reminder_offsets: [48, 24, 3], reminders_enabled: false, quiet_start: '22:30', quiet_end: '08:00', tz: 'Asia/Kolkata' });
    expect((await call('GET')).body).toMatchObject({ reminder_offsets: [48, 24, 3], tz: 'Asia/Kolkata' });
  });

  it.each([
    ['no offsets', { reminder_offsets: [] }],
    ['six offsets', { reminder_offsets: [72, 48, 24, 12, 6, 3] }],
    ['zero hours', { reminder_offsets: [0] }],
    ['over two weeks', { reminder_offsets: [337] }],
    ['fractional hours', { reminder_offsets: [1.5] }],
    ['bad time', { quiet_start: '24:00' }],
    ['bad time format', { quiet_end: '8:00' }],
    ['unknown zone', { tz: 'Mars/Olympus_Mons' }],
    ['wrong type', { reminders_enabled: 'yes' }],
  ])('rejects %s', async (_name, body) => {
    const before = (await call('GET')).body;
    const res = await call('PUT', body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_prefs');
    expect((await call('GET')).body).toEqual(before);
  });

  it('only ever changes the verified user, and cannot set can_dm', async () => {
    await call('GET', undefined, OTHER);
    const res = await call('PUT', { telegram_user_id: OTHER, telegramUserId: OTHER, user_id: OTHER, can_dm: true, reminder_offsets: [1] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reminder_offsets: [1], can_dm: false });
    expect(getPrefs(OTHER).reminderOffsets).toEqual([48, 24, 3]);
    expect(getPrefs(ME).canDm).toBe(false);
  });
});

describe('can_dm helpers', () => {
  it('setCanDm upserts and markCannotDm turns it off', () => {
    setCanDm(ME, true);
    expect(getPrefs(ME).canDm).toBe(true);
    markCannotDm(ME);
    expect(getPrefs(ME).canDm).toBe(false);
    markCannotDm(OTHER);
    expect(getPrefs(OTHER).canDm).toBe(false);
  });
});
