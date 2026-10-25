import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MeResponse, SplitResponse, WorkloadResponse } from '@groupie/shared';
import { db, schema } from './db/index.ts';
import { env } from './env.ts';
import { api } from './api.ts';

// Fake Telegram auth from `x-test-user`, and everyone counts as being in the chat.
vi.mock('./auth.ts', async (orig) => ({
  ...(await orig<typeof import('./auth.ts')>()),
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const id = Number(req.header('x-test-user'));
    if (!id) return void res.status(401).json({ error: 'unauthorized' });
    res.locals.tgUser = { id, first_name: 'Test' };
    next();
  },
  isGroupMember: vi.fn(async () => true),
}));

const created = new Date().toISOString();
const G = -3001;
const ME = 7001;
const STRANGER = 7002;
db.insert(schema.groups)
  .values({ id: G, title: 'Team', tz: 'America/Phoenix', createdAt: created, assignmentTitle: 'Project 2', status: 'split_ready', canvasCourse: 'CSE 340' })
  .run();
const me = db.insert(schema.members).values({ groupId: G, tgUserId: ME, name: 'Divyam', color: '#FF6B5B', createdAt: created }).returning().get();
db.insert(schema.members).values({ groupId: G, tgUserId: 7003, name: 'Ava', color: '#FFB547', createdAt: created }).run();
for (const [title, effort] of [['A', 3], ['B', 2], ['C', 2]] as const) {
  db.insert(schema.tasks).values({ groupId: G, title, effort, assigneeMemberId: me.id }).run();
}
for (const d of [1, 2, 3, 4]) {
  db.insert(schema.calendarEvents)
    .values({ telegramUserId: ME, uid: `x${d}`, course: 'HST 101 (Fall 2026)', title: `History reading ${d}`, dueAt: new Date(Date.now() + d * 86_400_000).toISOString(), kind: 'assignment', updatedAt: created })
    .run();
}

let server: ReturnType<express.Express['listen']>;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  env.loadAwareSplit = false;
  await new Promise<void>((r) => server.close(() => r()));
});

async function call(method: string, path: string, user: number, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': String(user) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

describe('PATCH /api/groups/:id/members/me/workload', () => {
  it('starts off, turns on, and shows up in /me', async () => {
    const before = MeResponse.parse(JSON.parse((await call('GET', `/me?group=${G}`, ME)).text));
    expect(before.member?.share_workload).toBe(false);
    // The setup checklist rides along, scoped to this group, with details already done.
    expect(before.setup?.group?.id).toBe(G);
    expect(before.setup?.steps.find((s) => s.key === 'details')?.done).toBe(true);

    const on = await call('PATCH', `/groups/${G}/members/me/workload`, ME, { shareWorkload: true });
    expect(on.status).toBe(200);
    expect(WorkloadResponse.parse(JSON.parse(on.text)).member).toMatchObject({ id: me.id, share_workload: true });

    const after = MeResponse.parse(JSON.parse((await call('GET', `/me?group=${G}`, ME)).text));
    expect(after.member?.share_workload).toBe(true);

    const off = await call('PATCH', `/groups/${G}/members/me/workload`, ME, { shareWorkload: false });
    expect(WorkloadResponse.parse(JSON.parse(off.text)).member.share_workload).toBe(false);
  });

  it('rejects a bad body and callers who have not joined', async () => {
    expect((await call('PATCH', `/groups/${G}/members/me/workload`, ME, { shareWorkload: 'yes' })).status).toBe(400);
    const stranger = await call('PATCH', `/groups/${G}/members/me/workload`, STRANGER, { shareWorkload: true });
    expect(stranger.status).toBe(409);
    expect(JSON.parse(stranger.text).error).toBe('not_joined');
  });
});

describe('GET /api/groups/:id/split', () => {
  it('has no calendar counts or course names, even for an opted-in busy member', async () => {
    env.loadAwareSplit = true;
    await call('PATCH', `/groups/${G}/members/me/workload`, ME, { shareWorkload: true });
    const res = await call('GET', `/groups/${G}/split`, ME);
    expect(res.status).toBe(200);
    SplitResponse.parse(JSON.parse(res.text));
    expect(res.text).not.toMatch(/\d+\s*due/i);
    for (const hidden of ['HST', 'History', 'Fall 2026', 'Busy', 'busy']) expect(res.text).not.toContain(hidden);
  });
});
