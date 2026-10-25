import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryItem, MemoryListResponse } from '@groupie/shared';
import { db, schema } from '../db/index.ts';
import { memoryRouter } from './memory.ts';

const G = -960001;
const STRANGERS_G = -960002;
const ME = 3001;
const AVA = 3002;
const OUTSIDER = 3003;

// Telegram membership: ME and AVA are in G; nobody is in STRANGERS_G.
vi.mock('../auth.ts', async (orig) => ({
  ...(await orig<typeof import('../auth.ts')>()),
  isGroupMember: vi.fn(async (groupId: number, userId: number) => groupId === G && (userId === ME || userId === AVA)),
}));

let server: ReturnType<express.Express['listen']>;
let base = '';
beforeAll(async () => {
  for (const id of [G, STRANGERS_G]) db.insert(schema.groups).values({ id, title: 'T', tz: 'America/Phoenix', createdAt: 'x' }).run();
  const app = express();
  app.use(express.json());
  // Stand-in for requireAuth: a verified Telegram user from a header, or a browser link.
  app.use((req, res, next) => {
    if (req.header('x-test-link')) res.locals.link = { g: G, m: 1, exp: Date.now() + 60_000 };
    else if (req.header('x-test-user')) res.locals.tgUser = { id: Number(req.header('x-test-user')), first_name: 'T' };
    next();
  });
  app.use('/api', memoryRouter);
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function call(method: string, path: string, user: number | 'link', body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(user === 'link' ? { 'x-test-link': '1' } : { 'x-test-user': String(user) }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null };
}
const list = async (user: number) => MemoryListResponse.parse((await call('GET', '/me/memory', user)).body).items;

describe('memory API', () => {
  let avaRow: MemoryItem;
  it('creates private facts by default and lists only the owner rows', async () => {
    const a = await call('POST', '/me/memory', AVA, { key: 'job', value: 'AVA_SECRET' });
    expect(a.status).toBe(201);
    avaRow = MemoryItem.parse(a.body);
    expect(avaRow).toMatchObject({ visibility: 'private', group_chat_id: null, source: 'mini_app' });
    const m = await call('POST', '/me/memory', ME, { key: 'focus', value: 'MINE' });
    expect(m.status).toBe(201);
    expect((await list(ME)).map((i) => i.value)).toEqual(['MINE']);
    expect((await list(AVA)).map((i) => i.value)).toEqual(['AVA_SECRET']);
  });

  it('ignores identity fields in the body', async () => {
    const r = await call('POST', '/me/memory', ME, { key: 'k', value: 'SPOOF', telegram_user_id: AVA, telegramUserId: AVA, user_id: AVA });
    expect(r.status).toBe(201);
    const owner = db.select().from(schema.userMemory).all().find((x) => x.value === 'SPOOF')!.telegramUserId;
    expect(owner).toBe(ME);
    expect((await list(AVA)).some((i) => i.value === 'SPOOF')).toBe(false);
  });

  it('sharing with a group needs the group id and membership', async () => {
    expect((await call('POST', '/me/memory', ME, { key: 'k', value: 'v', visibility: 'group' })).status).toBe(400);
    expect((await call('POST', '/me/memory', ME, { key: 'k', value: 'v', visibility: 'group', group_chat_id: STRANGERS_G })).status).toBe(403);
    expect((await call('POST', '/me/memory', OUTSIDER, { key: 'k', value: 'v', visibility: 'group', group_chat_id: G })).status).toBe(403);
    expect((await call('POST', '/me/memory', ME, { key: 'k', value: 'v', visibility: 'group', group_chat_id: -1 })).status).toBe(404);
    const ok = await call('POST', '/me/memory', ME, { key: 'k', value: 'SHARED', visibility: 'group', group_chat_id: G });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ visibility: 'group', group_chat_id: G });
  });

  it('a private fact never keeps a group id', async () => {
    const r = await call('POST', '/me/memory', ME, { key: 'k', value: 'v', visibility: 'private', group_chat_id: G });
    expect(r.body).toMatchObject({ visibility: 'private', group_chat_id: null });
  });

  it('owners can edit, share, unshare, and delete', async () => {
    const id = avaRow.id;
    const edited = await call('PATCH', `/me/memory/${id}`, AVA, { value: 'AVA_EDITED' });
    expect(edited.body).toMatchObject({ value: 'AVA_EDITED', visibility: 'private' });
    expect((await call('PATCH', `/me/memory/${id}`, AVA, { visibility: 'group' })).status).toBe(400);
    expect((await call('PATCH', `/me/memory/${id}`, AVA, { visibility: 'group', group_chat_id: STRANGERS_G })).status).toBe(403);
    const shared = await call('PATCH', `/me/memory/${id}`, AVA, { visibility: 'group', group_chat_id: G });
    expect(shared.body).toMatchObject({ visibility: 'group', group_chat_id: G });
    const unshared = await call('PATCH', `/me/memory/${id}`, AVA, { visibility: 'private' });
    expect(unshared.body).toMatchObject({ visibility: 'private', group_chat_id: null });
  });

  it('ids of other people answer 404, exactly like missing ids', async () => {
    const id = avaRow.id;
    const patch = await call('PATCH', `/me/memory/${id}`, ME, { value: 'HIJACK' });
    const missing = await call('PATCH', '/me/memory/999999', ME, { value: 'x' });
    expect(patch).toEqual(missing);
    expect(patch.status).toBe(404);
    expect((await call('DELETE', `/me/memory/${id}`, ME)).status).toBe(404);
    expect((await call('DELETE', '/me/memory/abc', ME)).status).toBe(404);
    expect((await list(AVA))[0]!.value).toBe('AVA_EDITED');
    expect((await call('DELETE', `/me/memory/${id}`, AVA)).status).toBe(204);
    expect(await list(AVA)).toEqual([]);
  });

  it('browser links cannot use memory', async () => {
    expect((await call('GET', '/me/memory', 'link')).status).toBe(401);
    expect((await call('POST', '/me/memory', 'link', { key: 'k', value: 'v' })).status).toBe(401);
  });
});
