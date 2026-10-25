import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PairCodeResponse, PairCodeStatusResponse } from '@groupie/shared';
import { env } from '../env.ts';
import { db, schema } from '../db/index.ts';
import { bot } from '../bot/core.ts';
import { setTeamSize, upsertGroup } from '../groups.ts';
import { ingestAssignment } from '../intake.ts';
import { parseAssignment } from '../parse.ts';
import { signBody } from './crypto.ts';
import { IMPORTED_MESSAGE, PERSONAL_MESSAGE, resetRateLimits } from './importer.ts';
import { hashToken } from './link.ts';
import { LINKED_MESSAGES, resetSkillVersions, skillOutdated, skillVersionTap } from './linkedImport.ts';
import { createPairCode, getPairCode } from './pairCodes.ts';
import { startTestApp } from './testApp.ts';

vi.mock('../intake.ts', async (orig) => ({ ...(await orig<typeof import('../intake.ts')>()), ingestAssignment: vi.fn() }));
const ingest = vi.mocked(ingestAssignment);
vi.mock('../parse.ts', async (orig) => ({ ...(await orig<typeof import('../parse.ts')>()), parseAssignment: vi.fn() }));
const parse = vi.mocked(parseAssignment);
vi.mock('../auth.ts', async (orig) => ({ ...(await orig<typeof import('../auth.ts')>()), isGroupMember: vi.fn(async () => true) }));

const plan = { assignment_title: 'Lab', due_date: null, tasks: [{ title: 'Do it', description: 'All of it', effort: 2, skill_tags: [] }] };
const okResult = { ok: true as const, parsed: { assignment_title: 'x', due_date: null, tasks: [] } as never };
const fixture = JSON.parse(fs.readFileSync(new URL('../../../../fixtures/cubbie/import_text_only.json', import.meta.url), 'utf8'));
const assignmentPayload: Record<string, unknown> = { ...fixture };
delete assignmentPayload.pairCode;

const SECRET = 'linked-hmac-secret';
const USER = 7777;
const OTHER = 8888;
const TOKEN = 'grp_linkedTOKENvalue_0123456789abcdefghijk';
const OTHER_TOKEN = 'grp_otherTOKENvalue_0123456789abcdefghijkl';
const [G1, G2, G3, STRANGER] = [-3001, -3002, -3003, -3009];
const ALL_GROUPS = [G1, G2, G3, STRANGER];

let app: Awaited<ReturnType<typeof startTestApp>>;
const sendMessage = vi.spyOn(bot.api, 'sendMessage');
let ip = 0;

const addLink = (uid: number, token: string, revoked = false) =>
  db
    .insert(schema.cubbieLinks)
    .values({ telegramUserId: uid, tokenHash: hashToken(token), createdAt: new Date().toISOString(), revokedAt: revoked ? new Date().toISOString() : null })
    .run();
const addMember = (groupId: number, uid: number) =>
  db.insert(schema.members).values({ groupId, tgUserId: uid, name: 'Ana', color: '#fff', createdAt: new Date().toISOString() }).run();

beforeAll(async () => {
  app = await startTestApp();
  for (const g of ALL_GROUPS) {
    upsertGroup(g, `Team ${g}`);
    setTeamSize(g, 3);
  }
  addLink(USER, TOKEN);
  addLink(OTHER, OTHER_TOKEN, true);
});
afterAll(() => app.close());
beforeEach(() => {
  env.cubbiePublicSigningKey = SECRET;
  resetRateLimits();
  resetSkillVersions();
  ingest.mockReset();
  ingest.mockResolvedValue(okResult);
  parse.mockReset();
  parse.mockResolvedValue(plan as never);
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({} as never);
  // Fresh slate per test: no codes, no members, groups expecting an assignment.
  db.delete(schema.cubbiePairCodes).run();
  db.delete(schema.members).run();
  for (const g of ALL_GROUPS) db.update(schema.groups).set({ status: 'setup' }).where(eq(schema.groups.id, g)).run();
  ip++;
});

type Opts = { token?: string | null; sig?: string | null; auth?: string; ua?: string };

/** POSTs to /api/cubbie/import/linked, signed and with USER's token unless told otherwise. */
async function postLinked(body: object, o: Opts = {}) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': `10.9.0.${ip}` };
  const sig = o.sig === undefined ? signBody(SECRET, raw) : o.sig;
  if (sig) headers['x-groupie-signature'] = sig;
  const token = o.token === undefined ? TOKEN : o.token;
  if (o.auth) headers.authorization = o.auth;
  else if (token) headers.authorization = `Bearer ${token}`;
  if (o.ua) headers['user-agent'] = o.ua;
  const res = await fetch(`${app.base}/api/cubbie/import/linked`, { method: 'POST', headers, body: raw });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const importRow = (id: unknown) => db.select().from(schema.cubbieImports).where(eq(schema.cubbieImports.id, Number(id))).get()!;
const importsBy = (uid: number) => db.select().from(schema.cubbieImports).where(eq(schema.cubbieImports.telegramUserId, uid)).all();

describe('linked import: success', () => {
  it('goes to the group of the one recent code, and marks that code used', async () => {
    const pc = createPairCode(USER, G1);
    const r = await postLinked(assignmentPayload);
    expect(r).toMatchObject({ status: 200, body: { ok: true, message: IMPORTED_MESSAGE } });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0]![0]).toBe(G1);
    expect(importRow(r.body.importId)).toMatchObject({ telegramUserId: USER, groupChatId: G1, pairCode: pc.code });
    await vi.waitFor(() => expect(getPairCode(pc.code)?.usedAt).not.toBeNull());
  });

  it('shows up in the Mini App status of the context code', async () => {
    const pc = createPairCode(USER, G1);
    await postLinked(assignmentPayload);
    const res = await fetch(`${app.base}/api/cubbie/pair-code/${pc.code}`, { headers: { 'x-test-user': String(USER) } });
    expect(PairCodeStatusResponse.parse(await res.json())).toMatchObject({ status: 'imported', linked: true });
  });

  it('goes to an explicit group the student joined, with no code at all', async () => {
    addMember(G2, USER);
    const r = await postLinked({ ...assignmentPayload, target: { kind: 'group', groupId: G2 } });
    expect(r.status).toBe(200);
    expect(ingest.mock.calls[0]![0]).toBe(G2);
    expect(importRow(r.body.importId)).toMatchObject({ groupChatId: G2, pairCode: null });
  });

  it('goes to me as a personal plan', async () => {
    const r = await postLinked({ ...assignmentPayload, target: { kind: 'me' } });
    expect(r).toMatchObject({ status: 200, body: { ok: true, message: PERSONAL_MESSAGE } });
    expect(ingest).not.toHaveBeenCalled();
    expect(parse).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![0]).toBe(USER);
    expect(importRow(r.body.importId)).toMatchObject({ groupChatId: null, pairCode: null, status: 'imported' });
  });

  it('uses a recent DM code as the context for me, and marks it used', async () => {
    const pc = createPairCode(USER, null);
    const r = await postLinked(assignmentPayload);
    expect(r.body.message).toBe(PERSONAL_MESSAGE);
    expect(importRow(r.body.importId).pairCode).toBe(pc.code);
    expect(getPairCode(pc.code)?.usedAt).not.toBeNull();
  });

  it('leaves the context code unused when the intake fails', async () => {
    const pc = createPairCode(USER, G1);
    ingest.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'nope' });
    const r = await postLinked(assignmentPayload);
    expect(r.body.error).toBe('server_error');
    expect(getPairCode(pc.code)?.usedAt).toBeNull();
  });

  it('keeps not_expecting for a group that already has its assignment', async () => {
    createPairCode(USER, G1);
    db.update(schema.groups).set({ status: 'active' }).where(eq(schema.groups.id, G1)).run();
    expect(await postLinked(assignmentPayload)).toMatchObject({ status: 409, body: { error: 'not_expecting' } });
  });
});

describe('linked import: bad_link', () => {
  it.each([
    ['missing', { token: null }],
    ['unknown', { token: 'grp_neverIssued_0123456789abcdefghijklmnop' }],
    ['revoked', { token: OTHER_TOKEN }],
    ['malformed header', { auth: 'Basic abc' }],
  ] as [string, Opts][])('rejects a %s token with 401 bad_link', async (_label, o) => {
    createPairCode(USER, G1);
    const r = await postLinked(assignmentPayload, o);
    expect(r).toMatchObject({ status: 401, body: { error: 'bad_link', message: LINKED_MESSAGES.badLink } });
    expect(typeof r.body.requestId).toBe('string');
    expect(ingest).not.toHaveBeenCalled();
  });

  it('rejects the public key plus a guessed user id', async () => {
    const before = importsBy(USER).length;
    createPairCode(USER, G1);
    const guess = { ...assignmentPayload, telegramUserId: USER, userId: USER, target: { kind: 'group', groupId: G1 } };
    expect((await postLinked(guess, { token: null })).body.error).toBe('bad_link');
    expect((await postLinked(guess, { auth: `Bearer ${USER}` })).body.error).toBe('bad_link');
    expect((await postLinked(guess, { token: hashToken(TOKEN) })).body.error).toBe('bad_link');
    expect(importsBy(USER).length).toBe(before);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('still needs the signature with a good token', async () => {
    createPairCode(USER, G1);
    expect(await postLinked(assignmentPayload, { sig: null })).toMatchObject({ status: 401, body: { error: 'bad_signature' } });
    expect((await postLinked(assignmentPayload, { sig: signBody('wrong', '{}') })).body.error).toBe('bad_signature');
  });
});

describe('linked import: choose_target', () => {
  it('asks when there is no recent code, listing joined and code groups plus Just me', async () => {
    addMember(G2, USER);
    const old = createPairCode(USER, G3, new Date(Date.now() - 2 * 60 * 60 * 1000));
    expect(old.groupChatId).toBe(G3);
    const r = await postLinked(assignmentPayload);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'choose_target', message: LINKED_MESSAGES.chooseTarget });
    const options = r.body.options as { kind: string; groupId?: number; title: string }[];
    expect(options.map((o) => o.groupId ?? o.kind).sort()).toEqual([G2, G3, 'me'].sort());
    expect(options.at(-1)).toEqual({ kind: 'me', title: 'Just me' });
    expect(options.find((o) => o.groupId === G2)?.title).toBe(`Team ${G2}`);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('asks when recent codes point at more than one place', async () => {
    createPairCode(USER, G1);
    createPairCode(USER, G2);
    const r = await postLinked(assignmentPayload);
    expect(r.body.error).toBe('choose_target');
    const ids = (r.body.options as { groupId?: number }[]).map((o) => o.groupId).filter(Boolean);
    expect(ids.sort()).toEqual([G1, G2].sort());
  });

  it('treats a group code and a DM code as two places', async () => {
    createPairCode(USER, G1);
    createPairCode(USER, null);
    expect((await postLinked(assignmentPayload)).body.error).toBe('choose_target');
  });

  it('lists at most five groups', async () => {
    const extra = [-3101, -3102, -3103, -3104, -3105, -3106];
    for (const g of extra) {
      upsertGroup(g, `Extra ${g}`);
      addMember(g, USER);
    }
    const r = await postLinked(assignmentPayload);
    expect((r.body.options as unknown[]).length).toBe(6);
  });

  it('round trip: the follow-up with a target lands and marks that group code used', async () => {
    const a = createPairCode(USER, G1);
    const b = createPairCode(USER, G2);
    expect((await postLinked(assignmentPayload)).body.error).toBe('choose_target');
    const r = await postLinked({ ...assignmentPayload, target: { kind: 'group', groupId: G2 } });
    expect(r.status).toBe(200);
    expect(ingest.mock.calls[0]![0]).toBe(G2);
    await vi.waitFor(() => expect(getPairCode(b.code)?.usedAt).not.toBeNull());
    expect(getPairCode(a.code)?.usedAt).toBeNull();
  });
});

describe('linked import: target ownership', () => {
  it('rejects a group the student never joined or made a code for', async () => {
    addMember(STRANGER, OTHER);
    const r = await postLinked({ ...assignmentPayload, target: { kind: 'group', groupId: STRANGER } });
    expect(r).toMatchObject({ status: 400, body: { error: 'invalid_payload', message: LINKED_MESSAGES.notYourGroup } });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('rejects an unknown group, and accepts one the student made a code for', async () => {
    expect((await postLinked({ ...assignmentPayload, target: { kind: 'group', groupId: -999999 } })).body.error).toBe('invalid_payload');
    createPairCode(USER, G3, new Date(Date.now() - 3 * 60 * 60 * 1000));
    expect((await postLinked({ ...assignmentPayload, target: { kind: 'group', groupId: G3 } })).status).toBe(200);
  });

  it('rejects a malformed target', async () => {
    expect((await postLinked({ ...assignmentPayload, target: { kind: 'everyone' } })).body.error).toBe('invalid_payload');
  });
});

describe('pair-code API: linked and skillOutdated', () => {
  const makeCode = async (uid: number) => {
    const res = await fetch(`${app.base}/api/cubbie/pair-code`, { method: 'POST', headers: { 'x-test-user': String(uid) } });
    return PairCodeResponse.parse(await res.json());
  };

  it('says linked for a linked student and not for others', async () => {
    expect(await makeCode(USER)).toMatchObject({ linked: true });
    expect((await makeCode(OTHER)).linked).toBe(false);
    expect((await makeCode(4321)).linked).toBe(false);
  });

  it('flags an outdated Skill once one is seen, and clears it on the current one', async () => {
    expect((await makeCode(USER)).skillOutdated).toBeUndefined();
    await postLinked({ ...assignmentPayload, target: { kind: 'me' } }, { ua: 'groupie-import-skill/2' });
    expect((await makeCode(USER)).skillOutdated).toBe(true);
    await postLinked({ ...assignmentPayload, target: { kind: 'me' } }, { ua: 'groupie-import-skill/3' });
    expect((await makeCode(USER)).skillOutdated).toBeUndefined();
  });
});

describe('skillVersionTap', () => {
  const tap = (headers: Record<string, string>) => {
    const next = vi.fn();
    const req = { header: (n: string) => headers[n.toLowerCase()] } as never;
    skillVersionTap(req, {} as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  };

  it('notes the version only for a live token, and always calls next', () => {
    tap({ 'user-agent': 'groupie-import-skill/2', authorization: `Bearer ${OTHER_TOKEN}` });
    expect(skillOutdated(OTHER)).toBe(false);
    tap({ 'user-agent': 'curl/8', authorization: `Bearer ${TOKEN}` });
    expect(skillOutdated(USER)).toBe(false);
    tap({ 'user-agent': 'groupie-import-skill/2', authorization: `Bearer ${TOKEN}` });
    expect(skillOutdated(USER)).toBe(true);
    tap({});
  });
});
