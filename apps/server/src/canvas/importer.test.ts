import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { IMPORT_RATE_LIMIT, PAIR_CODE_TTL_MS } from '@groupie/shared';
import { env } from '../env.ts';
import { db, schema } from '../db/index.ts';
import { bot } from '../bot/core.ts';
import { setTeamSize, upsertGroup } from '../groups.ts';
import { ingestAssignment } from '../intake.ts';
import { signBody } from './crypto.ts';
import { buildIntakeText, formatRubric, resetRateLimits, storablePayload } from './importer.ts';
import { createPairCode } from './pairCodes.ts';
import { startTestApp } from './testApp.ts';

vi.mock('../intake.ts', async (orig) => ({ ...(await orig<typeof import('../intake.ts')>()), ingestAssignment: vi.fn() }));
const ingest = vi.mocked(ingestAssignment);
const okResult = { ok: true as const, parsed: { assignment_title: 'x', due_date: null, tasks: [] } as never };

const fixture = (name: string) => fs.readFileSync(new URL(`../../../../fixtures/cubbie/${name}`, import.meta.url), 'utf8');
const full = JSON.parse(fixture('import_full.json'));
const textOnly = JSON.parse(fixture('import_text_only.json'));
const malformed = fixture('import_malformed.json');

const SECRET = 'test-hmac-secret';
const GROUP = -1001;
const USER = 4242;
let app: Awaited<ReturnType<typeof startTestApp>>;
const sendMessage = vi.spyOn(bot.api, 'sendMessage');
let ip = 0;

beforeAll(async () => {
  app = await startTestApp();
  upsertGroup(GROUP, 'Team');
  setTeamSize(GROUP, 4);
});
afterAll(() => app.close());
beforeEach(() => {
  env.cubbieHmacSecret = SECRET;
  resetRateLimits();
  ingest.mockReset();
  ingest.mockResolvedValue(okResult);
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({} as never);
  db.update(schema.groups).set({ status: 'setup' }).where(eq(schema.groups.id, GROUP)).run();
  ip++;
});

/** POSTs a payload (object or raw string), signed unless told otherwise. */
async function post(body: object | string, opts: { sig?: string | null; ip?: string } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': opts.ip ?? `10.0.0.${ip}` };
  const sig = opts.sig === undefined ? signBody(SECRET, raw) : opts.sig;
  if (sig) headers['x-groupie-signature'] = sig;
  const res = await fetch(`${app.base}/api/cubbie/import`, { method: 'POST', headers, body: raw });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const withCode = (payload: Record<string, unknown>, groupId: number | null = GROUP) => ({ ...payload, pairCode: createPairCode(USER, groupId).code });
const importRow = (id: unknown) => db.select().from(schema.cubbieImports).where(eq(schema.cubbieImports.id, Number(id))).get()!;

describe('signature and payload checks', () => {
  it('rejects a missing or wrong signature', async () => {
    const body = withCode(textOnly);
    expect((await post(body, { sig: null })).body.error).toBe('bad_signature');
    expect((await post(body, { sig: signBody('wrong', JSON.stringify(body)) })).status).toBe(401);
    expect((await post(body, { sig: 'sha256=00' })).status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });
  it('rejects a body changed after signing', async () => {
    const body = withCode(textOnly);
    const sig = signBody(SECRET, JSON.stringify(body));
    expect((await post({ ...body, course: { name: 'Other' } }, { sig })).status).toBe(401);
  });
  it('turns imports off with 503 when the server has no secret', async () => {
    env.cubbieHmacSecret = '';
    const r = await post(withCode(textOnly), { sig: signBody('', JSON.stringify(textOnly)) });
    expect(r.status).toBe(503);
  });
  it('rejects the malformed fixture with the first issue', async () => {
    const r = await post(malformed);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad_payload');
    expect(String(r.body.message).length).toBeGreaterThan(0);
  });
});

describe('pair code checks', () => {
  it('404s an unknown code', async () => {
    expect((await post({ ...textOnly, pairCode: 'ZZZZZZ' })).body.error).toBe('unknown_code');
  });
  it('accepts a code once, then 409 code_used', async () => {
    const body = withCode(textOnly);
    const first = await post(body);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, message: 'Sent to Groupie. Check your group.' });
    expect(importRow(first.body.importId).status).toBe('imported');
    expect((await post(body)).body.error).toBe('code_used');
  });
  it('lets exactly one of two concurrent imports with the same code through', async () => {
    ingest.mockImplementation(() => new Promise((r) => setTimeout(() => r(okResult), 30)));
    const body = withCode(textOnly);
    const results = await Promise.all([post(body), post(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(ingest).toHaveBeenCalledTimes(1);
  });
  it('409s an expired code', async () => {
    const pc = createPairCode(USER, GROUP, new Date(Date.now() - PAIR_CODE_TTL_MS - 1000));
    expect((await post({ ...textOnly, pairCode: pc.code })).body.error).toBe('code_expired');
  });
  it('409s not_expecting when the group already has its assignment', async () => {
    db.update(schema.groups).set({ status: 'active' }).where(eq(schema.groups.id, GROUP)).run();
    const r = await post(withCode(textOnly));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('not_expecting');
    expect(ingest).not.toHaveBeenCalled();
  });
  it('maps a not_expecting result from the intake too', async () => {
    ingest.mockResolvedValue({ ok: false, reason: 'not_expecting', message: 'already' });
    const body = withCode(textOnly);
    const r = await post(body);
    expect(r.body.error).toBe('not_expecting');
    expect(importRow(db.select().from(schema.cubbieImports).all().at(-1)!.id)).toMatchObject({ status: 'failed', error: 'already' });
  });
});

describe('rate limits', () => {
  it('limits per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i <= IMPORT_RATE_LIMIT.perIpPerHour; i++) statuses.push((await post({ ...textOnly, pairCode: 'ZZZZZZ' }, { ip: '9.9.9.9' })).status);
    expect(statuses.slice(0, -1).every((s) => s === 404)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
  it('limits per code owner across IPs', async () => {
    const pc = createPairCode(USER, GROUP);
    let last = 0;
    for (let i = 0; i <= IMPORT_RATE_LIMIT.perUserPerHour; i++) last = (await post({ ...textOnly, pairCode: pc.code }, { ip: `8.8.${i}.1` })).status;
    expect(last).toBe(429);
  });
});

describe('import content', () => {
  it('runs the full fixture through the intake with rubric, due date, course, and the decoded PDF', async () => {
    const r = await post(withCode(full));
    expect(r.status).toBe(200);
    const [groupId, input] = ingest.mock.calls[0];
    expect(groupId).toBe(GROUP);
    expect(input).toMatchObject({
      sourceLabel: 'Project 2: Campus Food Finder',
      dueDate: '2026-11-20T23:59:00-07:00',
      courseName: 'CSE 340: Software Engineering',
    });
    expect(input.extraContext).toContain('Implementation (30 pts): Search and hours work end to end; Partly working; Not working');
    expect(input.text).toContain('Assignment: Project 2: Campus Food Finder');
    expect(input.text).toContain('Points: 100');
    expect(input.text).toContain('Attachment: dining-hours-notes.txt');
    expect(input.text).toMatch(/Attachment: project2-spec\.pdf\n\S/);
    expect(input.text).not.toContain('(could not be read)');
    // Stored without the base64.
    const stored = JSON.stringify(importRow(r.body.importId).payload);
    expect(stored).not.toContain(full.attachments[0].base64.slice(0, 40));
    expect(stored).toContain('project2-spec.pdf');
  }, 20_000);
  it('lists url attachments as links and never fetches them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const text = await buildIntakeText({ ...textOnly, descriptionText: 'd', attachments: [{ filename: 'a.pdf', mimeType: 'application/pdf', url: 'https://canvas.asu.edu/files/1' }] });
    expect(text).toContain('- a.pdf: https://canvas.asu.edu/files/1');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it('rejects oversized base64 attachments', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 10).toString('base64');
    await expect(
      buildIntakeText({ ...textOnly, descriptionText: '', attachments: [{ filename: 'big.pdf', mimeType: 'application/pdf', base64: big }] }),
    ).rejects.toThrow(/10 MB/);
  });
  it('formats rubric and strips base64 for storage', () => {
    expect(formatRubric([{ name: 'A', points: 5, ratings: [] }])).toContain('A (5 pts)');
    expect(storablePayload({ ...full, attachments: [{ filename: 'x', mimeType: 'm', base64: 'QUJD' }] }).attachments).toEqual([
      { filename: 'x', mimeType: 'm', base64Length: 4 },
    ]);
  });
  it('answers ok while a slow intake keeps running, then records the result', async () => {
    let finish!: (v: typeof okResult) => void;
    ingest.mockImplementation(() => new Promise((r) => (finish = r)));
    const { handleImport } = await import('./importer.ts');
    const raw = JSON.stringify(withCode(textOnly));
    const reply = await handleImport(Buffer.from(raw), signBody(SECRET, raw), '1.2.3.4', { ingestWaitMs: 20 });
    expect(reply.status).toBe(200);
    const id = (reply.body as { importId: number }).importId;
    expect(importRow(id).status).toBe('received');
    finish(okResult);
    await new Promise((r) => setTimeout(r, 10));
    expect(importRow(id).status).toBe('imported');
  });
  it('422s other intake failures with the reason', async () => {
    ingest.mockResolvedValue({ ok: false, reason: 'too_short', message: 'Not enough assignment text.' });
    const r = await post(withCode(textOnly));
    expect(r).toMatchObject({ status: 422, body: { error: 'too_short' } });
  });
});

describe('codes without a group', () => {
  it('stores the import as failed and DMs the student', async () => {
    const r = await post(withCode(textOnly, null));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(importRow(r.body.importId)).toMatchObject({ status: 'failed', groupChatId: null });
    expect(ingest).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(USER, expect.stringContaining('/canvas'), expect.anything());
  });
  it('still answers when the DM fails', async () => {
    sendMessage.mockRejectedValue(new Error('bot was blocked'));
    expect((await post(withCode(textOnly, null))).status).toBe(200);
  });
});
