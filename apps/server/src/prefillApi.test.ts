import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AvailabilityMeResponse } from '@groupie/shared';
import { gridSlots } from './busyRead.ts';
import { db, schema } from './db/index.ts';
import { bot } from './bot/core.ts';
import { api } from './api.ts';

// Fake auth: `x-test-user` is a verified Telegram id, `x-test-link` a signed browser link for a member id.
vi.mock('./auth.ts', async (orig) => ({
  ...(await orig<typeof import('./auth.ts')>()),
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const link = Number(req.header('x-test-link'));
    if (link) {
      res.locals.link = { g: Number(req.header('x-test-group')), m: link, n: 'x', exp: Date.now() + 60_000 };
      return next();
    }
    const id = Number(req.header('x-test-user'));
    if (!id) return void res.status(401).json({ error: 'unauthorized' });
    res.locals.tgUser = { id, first_name: 'Test' };
    next();
  },
  isGroupMember: vi.fn(async () => true),
}));

const created = new Date().toISOString();
const G = -4001;
const ME = 8001; // has busy blocks
const AVA = 8002; // has busy blocks, someone else
const BEN = 8003; // no calendar
db.insert(schema.groups).values({ id: G, title: 'Team', tz: 'America/Phoenix', createdAt: created, status: 'scheduling', teamSize: 4 }).run();
db.insert(schema.members).values({ groupId: G, tgUserId: ME, name: 'Divyam', color: '#FF6B5B', createdAt: created }).run();
db.insert(schema.members).values({ groupId: G, tgUserId: AVA, name: 'Ava', color: '#FFB547', createdAt: created }).run();
db.insert(schema.members).values({ groupId: G, tgUserId: BEN, name: 'Ben', color: '#5BC0FF', createdAt: created }).run();
const emailOnly = db.insert(schema.members).values({ groupId: G, name: 'Cara', email: 'c@x.edu', color: '#C48CFF', createdAt: created }).returning().get();
const linked = db.select().from(schema.members).all().find((m) => m.tgUserId === AVA)!;

// Busy blocks on tomorrow's grid, in the middle of the day (Phoenix).
const slots = gridSlots('America/Phoenix'); // 26 rows a day, day by day
const myBusy = slots.slice(26 + 10, 26 + 12); // two slots tomorrow
const avaBusy = slots.slice(26 * 2 + 4, 26 * 2 + 8); // four slots the day after
const myStart = myBusy[0]!;
const myEnd = new Date(Date.parse(myBusy[1]!) + 30 * 60_000).toISOString();
db.insert(schema.busyBlocks).values({ telegramUserId: ME, startAt: myStart, endAt: myEnd, source: 'google' }).run();
db.insert(schema.busyBlocks)
  .values({ telegramUserId: AVA, startAt: avaBusy[0]!, endAt: new Date(Date.parse(avaBusy[3]!) + 30 * 60_000).toISOString(), source: 'ics' })
  .run();

let server: ReturnType<express.Express['listen']>;
let base = '';
beforeAll(async () => {
  vi.spyOn(bot.api, 'sendMessage').mockResolvedValue({ message_id: 1 } as never);
  vi.spyOn(bot.api, 'editMessageText').mockResolvedValue(true as never);
  vi.spyOn(bot.api, 'sendPoll').mockResolvedValue({ message_id: 2, poll: { id: 'p' } } as never);
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((r) => server.close(() => r()));
});

async function call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}
const asUser = (id: number) => ({ 'x-test-user': String(id) });
const asLink = (memberId: number) => ({ 'x-test-link': String(memberId), 'x-test-group': String(G) });

describe('GET /availability/me prefill', () => {
  it('prefills the caller from their own busy blocks only', async () => {
    const res = await call('GET', `/groups/${G}/availability/me`, asUser(ME));
    expect(res.status).toBe(200);
    const body = AvailabilityMeResponse.parse(JSON.parse(res.text));
    expect(body.prefill).toEqual({ prefilled: true, busy_slots: myBusy, hours: { start: 8, end: 22 } });
    for (const s of avaBusy) expect(res.text).not.toContain(s);
  });

  it('gives no prefill to members without calendar data', async () => {
    const res = await call('GET', `/groups/${G}/availability/me`, asUser(BEN));
    const body = AvailabilityMeResponse.parse(JSON.parse(res.text));
    expect(body.prefill).toBeUndefined();
    expect(body.slots).toEqual([]);
  });

  it('link members get prefill only through their own Telegram id', async () => {
    const none = JSON.parse((await call('GET', `/groups/${G}/availability/me`, asLink(emailOnly.id))).text);
    expect(none.prefill).toBeUndefined();
    const res = await call('GET', `/groups/${G}/availability/me`, asLink(linked.id));
    const body = AvailabilityMeResponse.parse(JSON.parse(res.text));
    expect(body.member.name).toBe('Ava');
    expect(body.prefill?.busy_slots).toEqual(avaBusy);
    for (const s of myBusy) expect(res.text).not.toContain(s);
  });

  it('keeps the prefill after saving, and the heatmap never shows busy blocks', async () => {
    const mine = slots.slice(26 + 2, 26 + 6);
    const put = await call('PUT', `/groups/${G}/availability/me`, asUser(ME), { slots: mine });
    expect(put.status).toBe(200);
    const me = AvailabilityMeResponse.parse(JSON.parse((await call('GET', `/groups/${G}/availability/me`, asUser(ME))).text));
    expect(me.slots).toEqual(mine);
    expect(me.prefill?.busy_slots).toEqual(myBusy);

    const heat = await call('GET', `/groups/${G}/heatmap`, asUser(BEN));
    expect(heat.text).not.toContain('busy');
    for (const s of [...myBusy, ...avaBusy]) expect(heat.text).not.toContain(s);
    expect(JSON.parse(heat.text).slots[mine[0]!]).toHaveLength(1);
  });
});
