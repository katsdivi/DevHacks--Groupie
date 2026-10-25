import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { CUBBIE_LINK_RATE_LIMITS, CubbieLinkResponse, CubbieMeResponse, PAIR_CODE_TTL_MS } from '@groupie/shared';
import { env } from '../env.ts';
import { db, schema } from '../db/index.ts';
import { bot } from '../bot/core.ts';
import { upsertGroup } from '../groups.ts';
import { signBody } from './crypto.ts';
import { resetRateLimits } from './importer.ts';
import { LINKED_DM, hashToken, linkCodeText, revokeAllLinks } from './link.ts';
import { personalCanvasCodeText } from './bot.ts';
import { createPairCode } from './pairCodes.ts';
import { startTestApp } from './testApp.ts';

const SECRET = 'link-test-secret';
const OWNER = 7001;
const OTHER = 7002;
const STRANGER = 7003;
const G1 = -3001;
const G2 = -3002;
const MARKERS = ['OTHER_CAL_MARKER', 'OTHER_MEMORY_MARKER', 'OWNER_MEMORY_MARKER', 'NOT_MY_GROUP_MARKER', 'OTHER_EMAIL_MARKER'];
let app: Awaited<ReturnType<typeof startTestApp>>;
const sendMessage = vi.spyOn(bot.api, 'sendMessage');
let ip = 0;

const now = new Date();
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

function seed() {
  upsertGroup(G1, 'CSE 340 Team');
  upsertGroup(G2, 'Other Team');
  db.update(schema.groups).set({ assignmentTitle: 'Project 2', dueDate: inDays(10).slice(0, 10), status: 'active' }).where(eq(schema.groups.id, G1)).run();
  db.update(schema.groups).set({ assignmentTitle: 'NOT_MY_GROUP_MARKER' }).where(eq(schema.groups.id, G2)).run();
  const member = (groupId: number, tgUserId: number, name: string, email: string | null = null) =>
    db.insert(schema.members).values({ groupId, tgUserId, name, email, color: '#FF6B5B', createdAt: now.toISOString() }).returning().get();
  const me = member(G1, OWNER, 'Ana');
  const other = member(G1, OTHER, 'Ben', 'OTHER_EMAIL_MARKER@asu.edu');
  member(G2, STRANGER, 'Cy');
  const task = (groupId: number, title: string, assigneeMemberId: number, status: 'todo' | 'done' | 'on_track' = 'todo', effort = 3) =>
    db.insert(schema.tasks).values({ groupId, title, effort, assigneeMemberId, status }).run();
  task(G1, 'Write the report', me.id, 'on_track', 5);
  task(G1, 'Make slides', me.id, 'done', 2);
  task(G1, 'Build prototype', other.id);
  const strangerId = db.select().from(schema.members).where(eq(schema.members.tgUserId, STRANGER)).get()!.id;
  task(G2, 'NOT_MY_GROUP_MARKER task', strangerId);
  db.insert(schema.meetings)
    .values({ groupId: G1, start: inDays(2), end: new Date(Date.parse(inDays(2)) + 3_600_000).toISOString(), mode: 'zoom', meetLink: 'https://zoom.us/j/123' })
    .run();
  db.insert(schema.meetings).values({ groupId: G2, start: inDays(1), end: inDays(1.1), mode: 'meet', meetLink: 'https://meet.google.com/NOT_MY_GROUP_MARKER' }).run();
  const cal = (telegramUserId: number, uid: string, title: string, dueAt: string, course = 'CSE 340 (Fall 2026)') =>
    db.insert(schema.calendarEvents).values({ telegramUserId, uid, course, title, dueAt, kind: 'assignment', updatedAt: now.toISOString() }).run();
  cal(OWNER, 'o1', 'Lab 4', inDays(3));
  cal(OWNER, 'o2', 'Far away essay', inDays(20));
  cal(OTHER, 'x1', 'OTHER_CAL_MARKER', inDays(2));
  cal(OTHER, 'x2', 'OTHER_CAL_MARKER private', inDays(1), 'HST 101');
  const memory = (telegramUserId: number, value: string, visibility: 'private' | 'group') =>
    db.insert(schema.userMemory).values({ telegramUserId, key: 'note', value, source: 'chat', visibility, groupChatId: visibility === 'group' ? G1 : null, updatedAt: now.toISOString() }).run();
  memory(OTHER, 'OTHER_MEMORY_MARKER', 'private');
  memory(OTHER, 'OTHER_MEMORY_MARKER shared', 'group');
  memory(OWNER, 'OWNER_MEMORY_MARKER', 'private');
}

beforeAll(async () => {
  app = await startTestApp();
  seed();
});
afterAll(() => app.close());
beforeEach(() => {
  env.cubbiePublicSigningKey = SECRET;
  resetRateLimits();
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({} as never);
  ip++;
});

async function link(body: object | string, opts: { sig?: string | null; ip?: string } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': opts.ip ?? `10.1.0.${ip}` };
  const sig = opts.sig === undefined ? signBody(SECRET, raw) : opts.sig;
  if (sig) headers['x-groupie-signature'] = sig;
  const res = await fetch(`${app.base}/api/cubbie/link`, { method: 'POST', headers, body: raw });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function withToken(method: 'GET' | 'DELETE', path: string, token: string | null, ipAddr = `10.2.0.${ip}`) {
  const headers: Record<string, string> = { 'x-forwarded-for': ipAddr };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${app.base}/api/cubbie${path}`, { method, headers });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Record<string, unknown> };
}

const linkCode = (user = OWNER, at = new Date()) => createPairCode(user, null, at, undefined, 'link').code;
async function newLink(user = OWNER): Promise<string> {
  const r = await link({ pairCode: linkCode(user) });
  expect(r.status).toBe(200);
  return CubbieLinkResponse.parse(r.body).token;
}

describe('bot texts', () => {
  it('tells the student exactly what to text Cubbie', () => {
    expect(linkCodeText('K7Q2MX')).toContain('Then text Cubbie: <code>Groupie link K7Q2MX</code>');
    expect(personalCanvasCodeText('K7Q2MX')).toContain('<code>Groupie import K7Q2MX &lt;assignment name&gt;</code>');
    for (const t of [linkCodeText('K7Q2MX'), personalCanvasCodeText('K7Q2MX')]) {
      expect(t).toContain('Install this skill: https://github.com/katsdivi/groupie-cubbie-skill/tree/main/groupie-import');
    }
    expect(personalCanvasCodeText('K7Q2MX')).toContain("I'll send you a plan here.");
  });
});

describe('POST /api/cubbie/link', () => {
  it('needs a valid signature', async () => {
    const body = { pairCode: linkCode() };
    expect((await link(body, { sig: null })).status).toBe(401);
    expect((await link(body, { sig: signBody('wrong', JSON.stringify(body)) })).body.error).toBe('bad_signature');
    // The code is still usable after the failed tries.
    expect((await link(body)).status).toBe(200);
  });
  it('is off without the signing key', async () => {
    env.cubbiePublicSigningKey = '';
    expect((await link({ pairCode: linkCode() }, { sig: 'sha256=00' })).status).toBe(503);
  });
  it('trades a link code for a token once, stores only the hash, and DMs the student', async () => {
    const code = linkCode();
    const r = await link({ pairCode: code.toLowerCase() });
    expect(r.status).toBe(200);
    const body = CubbieLinkResponse.parse(r.body);
    expect(body.name).toBe('Ana');
    expect(body.token.length).toBeGreaterThanOrEqual(43);
    expect(sendMessage).toHaveBeenCalledWith(OWNER, LINKED_DM);
    const rows = db.select().from(schema.cubbieLinks).where(eq(schema.cubbieLinks.telegramUserId, OWNER)).all();
    expect(rows.at(-1)!.tokenHash).toBe(hashToken(body.token));
    expect(JSON.stringify(db.select().from(schema.cubbieLinks).all())).not.toContain(body.token);
    expect(JSON.stringify(db.select().from(schema.cubbiePairCodes).all())).not.toContain(body.token);
    const again = await link({ pairCode: code });
    expect(again).toMatchObject({ status: 409, body: { error: 'code_used' } });
    expect(JSON.stringify(again.body)).not.toContain(body.token);
  });
  it('rejects expired, unknown, and import codes', async () => {
    const old = linkCode(OWNER, new Date(Date.now() - PAIR_CODE_TTL_MS - 1000));
    expect((await link({ pairCode: old })).body.error).toBe('code_expired');
    expect((await link({ pairCode: 'ZZZZZZ' })).body.error).toBe('unknown_code');
    const importCode = createPairCode(OWNER, null).code;
    expect((await link({ pairCode: importCode })).status).toBe(404);
    expect((await link({ pairCode: 'nope' })).body.error).toBe('bad_payload');
  });
  it('rate limits per IP', async () => {
    let last = 0;
    for (let i = 0; i <= CUBBIE_LINK_RATE_LIMITS.linkPerIp.limit; i++) last = (await link({ pairCode: 'ZZZZZZ' }, { ip: '9.9.9.9' })).status;
    expect(last).toBe(429);
  });
  it('replaces the old token when the student links again', async () => {
    const first = await newLink();
    const second = await newLink();
    expect((await withToken('GET', '/me', first)).status).toBe(401);
    expect((await withToken('GET', '/me', second)).status).toBe(200);
  });
});

describe('GET /api/cubbie/me', () => {
  it('401s without a token, with an unknown token, and with a malformed header', async () => {
    expect((await withToken('GET', '/me', null)).status).toBe(401);
    expect((await withToken('GET', '/me', 'grp_unknownunknownunknown')).body.error).toBe('not_linked');
    const res = await fetch(`${app.base}/api/cubbie/me`, { headers: { authorization: 'Basic abc' } });
    expect(res.status).toBe(401);
  });
  it("returns only the owner's groups, tasks, meeting and calendar", async () => {
    const token = await newLink();
    const r = await withToken('GET', '/me', token);
    expect(r.status).toBe(200);
    const me = CubbieMeResponse.parse(r.body);
    expect(me.name).toBe('Ana');
    expect(me.groups).toHaveLength(1);
    const g = me.groups[0]!;
    expect(g).toMatchObject({ title: 'CSE 340 Team', assignmentTitle: 'Project 2', myTasksLeft: 1, groupTasksDone: 1, groupTasksTotal: 3 });
    expect([10, 11]).toContain(g.daysLeft);
    expect(g.myTasks).toEqual([
      { title: 'Write the report', status: 'on_track', points: 5 },
      { title: 'Make slides', status: 'done', points: 2 },
    ]);
    expect(g.nextMeeting).toMatchObject({ mode: 'zoom', joinUrl: 'https://zoom.us/j/123' });
    expect(g.nextMeeting!.label.length).toBeGreaterThan(3);
    expect(me.upcoming.map((u) => u.title)).toEqual(['Lab 4']);
    expect(me.counts).toEqual({ myTasksLeft: 1, upcoming: 1, groups: 1 });
    expect(me.summary).toBe('1 task left, 1 thing due in the next 7 days');
    for (const m of MARKERS) expect(r.text).not.toContain(m);
    expect(r.text).not.toContain('Build prototype');
    expect(r.text).not.toContain('Ben');
    const row = db.select().from(schema.cubbieLinks).where(eq(schema.cubbieLinks.tokenHash, hashToken(token))).get()!;
    expect(row.lastUsedAt).not.toBeNull();
  });
  it('rate limits per token', async () => {
    const token = await newLink();
    let last = 0;
    for (let i = 0; i <= CUBBIE_LINK_RATE_LIMITS.mePerToken.limit; i++) last = (await withToken('GET', '/me', token, `10.3.${i}.1`)).status;
    expect(last).toBe(429);
  });
  it('rate limits per IP, even for unknown tokens', async () => {
    let last = 0;
    for (let i = 0; i <= CUBBIE_LINK_RATE_LIMITS.mePerIp.limit; i++) last = (await withToken('GET', '/me', 'grp_guessguessguessguess', '9.8.7.6')).status;
    expect(last).toBe(429);
  });
});

describe('unlinking', () => {
  it('DELETE /api/cubbie/link revokes that token', async () => {
    const token = await newLink();
    expect((await withToken('DELETE', '/link', token)).status).toBe(200);
    expect((await withToken('GET', '/me', token)).status).toBe(401);
    expect((await withToken('DELETE', '/link', token)).status).toBe(401);
  });
  it('/unlink revokes every token of the user', async () => {
    const token = await newLink();
    expect(revokeAllLinks(OWNER)).toBe(1);
    expect((await withToken('GET', '/me', token)).status).toBe(401);
    expect(revokeAllLinks(OWNER)).toBe(0);
  });
});
