import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, schema } from '../db/index.ts';
import { appendDm, loadDm } from '../dmHistory.ts';
import { history } from '../agent.ts';
import { upsertMember } from '../members.ts';
import type { Member } from '../db/schema.ts';
import { chatRouter } from './chat.ts';

const ME = 8301;
const OTHER = 8302;
const G = -980001;
let base = '';
let close: () => Promise<void>;
let mine: Member;
let theirs: Member;

/** Same shape as the real mount: JSON body, fake auth from `x-test-user` (or a browser link), then the router. */
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res, next) => {
    if (req.header('x-test-link')) {
      res.locals.link = { g: G };
      return next();
    }
    const id = Number(req.header('x-test-user'));
    if (!id) return void res.status(401).json({ error: 'unauthorized' });
    res.locals.tgUser = { id, first_name: 'Test' };
    next();
  });
  app.use('/api', chatRouter);
  const server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise<void>((r) => server.close(() => r()));
  db.insert(schema.groups).values({ id: G, title: 't', nickname: 'Motu', status: 'active', tz: 'America/Phoenix', createdAt: 'x' }).run();
  mine = upsertMember(G, ME, { name: 'Me', skills: [], weak_areas: [] });
  theirs = upsertMember(G, OTHER, { name: 'Other', skills: [], weak_areas: [] });
});
afterAll(() => close());
beforeEach(() => {
  db.delete(schema.dmMessages).run();
  db.delete(schema.agentMessages).run();
  for (const [uid, m] of [[ME, mine], [OTHER, theirs]] as const) {
    appendDm(uid, 'user', `dm ${uid}`);
    db.insert(schema.agentMessages).values({ memberId: m.id, role: 'user', content: `app ${uid}`, createdAt: 'x' }).run();
  }
});

async function del(headers: Record<string, string>, body?: unknown) {
  const res = await fetch(`${base}/api/me/chat`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('DELETE /api/me/chat', () => {
  it('needs Telegram auth', async () => {
    expect((await del({})).status).toBe(401);
    expect((await del({ 'x-test-link': '1' })).status).toBe(401);
    expect(loadDm(ME)).toHaveLength(1);
  });

  it("clears the caller's DM and Mini App chat, and nobody else's", async () => {
    const res = await del({ 'x-test-user': String(ME) });
    expect(res).toEqual({ status: 200, body: { ok: true, cleared: { dm: 1, app: 1 } } });
    expect(loadDm(ME)).toEqual([]);
    expect(history(mine.id)).toEqual([]);
    expect(loadDm(OTHER).map((m) => m.content)).toEqual([`dm ${OTHER}`]);
    expect(history(theirs.id).map((m) => m.content)).toEqual([`app ${OTHER}`]);
  });

  it('ignores any user id in the body', async () => {
    const res = await del({ 'x-test-user': String(ME) }, { telegram_user_id: OTHER, userId: OTHER, user: { id: OTHER } });
    expect(res.status).toBe(200);
    expect(loadDm(ME)).toEqual([]);
    expect(loadDm(OTHER)).toHaveLength(1);
    expect(history(theirs.id)).toHaveLength(1);
  });
});
