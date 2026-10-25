import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { IMPORT_RATE_LIMIT, MAX_ATTACHMENT_TEXT, PAIR_CODE_TTL_MS } from '@groupie/shared';
import { env } from '../env.ts';
import { db, schema } from '../db/index.ts';
import { bot } from '../bot/core.ts';
import { setTeamSize, upsertGroup } from '../groups.ts';
import { ingestAssignment } from '../intake.ts';
import { parseAssignment } from '../parse.ts';
import { signBody } from './crypto.ts';
import { buildIntakeText, formatRubric, prepareIntake, resetRateLimits, storablePayload } from './importer.ts';
import { TEXT_ONLY_LINE } from './afterImport.ts';
import { createPairCode } from './pairCodes.ts';
import { applyFeedEvents } from './poller.ts';
import { deleteFeed } from './feeds.ts';
import { startTestApp } from './testApp.ts';

vi.mock('../intake.ts', async (orig) => ({ ...(await orig<typeof import('../intake.ts')>()), ingestAssignment: vi.fn() }));
const ingest = vi.mocked(ingestAssignment);
vi.mock('../parse.ts', async (orig) => ({ ...(await orig<typeof import('../parse.ts')>()), parseAssignment: vi.fn() }));
const parse = vi.mocked(parseAssignment);
const plan = {
  assignment_title: 'Project 2',
  due_date: null,
  tasks: [
    { title: 'Interview five students', description: 'Write a one page summary', effort: 3, skill_tags: ['research'] },
    { title: 'Integrate and proofread', description: 'Final pass', effort: 2, skill_tags: ['editing'] },
  ],
};
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
  env.cubbiePublicSigningKey = SECRET;
  resetRateLimits();
  ingest.mockReset();
  ingest.mockResolvedValue(okResult);
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({} as never);
  parse.mockReset();
  parse.mockResolvedValue(plan as never);
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
  it('turns imports off with server_error when the server has no secret', async () => {
    env.cubbiePublicSigningKey = '';
    const r = await post(withCode(textOnly), { sig: signBody('', JSON.stringify(textOnly)) });
    expect(r).toMatchObject({ status: 500, body: { error: 'server_error' } });
  });
  it('rejects the malformed fixture with the first issue', async () => {
    const r = await post(malformed);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_payload');
    expect(String(r.body.message).length).toBeGreaterThan(0);
  });
});

describe('pair code checks', () => {
  it('404s an unknown code', async () => {
    expect((await post({ ...textOnly, pairCode: 'ZZZZZZ' })).body.error).toBe('code_unknown');
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
  it('drops oversized attachments and goes on without them', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 10).toString('base64');
    const prepared = await prepareIntake({
      ...textOnly,
      attachments: [
        { filename: 'big.pdf', mimeType: 'application/pdf', base64: big },
        { filename: 'long.txt', mimeType: 'text/plain', text: 'x'.repeat(MAX_ATTACHMENT_TEXT + 1) },
        { filename: 'ok.txt', mimeType: 'text/plain', text: 'Fine notes' },
      ],
    });
    expect(prepared.dropped).toEqual(['big.pdf', 'long.txt']);
    expect(prepared.files).toEqual([]);
    expect(prepared.text).toContain('Attachment: ok.txt\nFine notes');
    expect(prepared.text).not.toContain('big.pdf');
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
  it('answers server_error for intake failures, with a friendly message', async () => {
    for (const reason of ['too_short', 'failed', 'busy'] as const) {
      ingest.mockResolvedValueOnce({ ok: false, reason, message: 'Get a new code and try again.' });
      const r = await post(withCode(textOnly));
      expect(r).toMatchObject({ status: 500, body: { error: 'server_error' } });
      expect(String(r.body.message)).not.toContain('new code');
    }
  });
});

describe('personal imports (code made in a private chat)', () => {
  let n = 0;
  /** The text-only fixture with a fresh title, so earlier imports of the same item do not count as a twin. */
  const fresh = () => ({ ...textOnly, assignment: { ...textOnly.assignment, title: `Lab ${++n}` } });
  const eventsFor = (uid: string) => db.select().from(schema.calendarEvents).where(eq(schema.calendarEvents.uid, uid)).all();

  it('plans for one, DMs the plan, and adds the due date to the student calendar', async () => {
    const r = await post(withCode(textOnly, null));
    expect(r).toMatchObject({ status: 200, body: { ok: true, message: 'Sent to Groupie. Check your Telegram messages.' } });
    expect(importRow(r.body.importId)).toMatchObject({ status: 'imported', groupChatId: null });
    expect(ingest).not.toHaveBeenCalled();
    expect(parse).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0]![1]).toBe(1);
    const [to, text, opts] = sendMessage.mock.calls[0]!;
    expect(to).toBe(USER);
    expect(opts).toMatchObject({ parse_mode: 'HTML' });
    expect(text).toContain('<b>Project 2: Campus Food Finder</b>');
    expect(text).toContain('CSE 340: Software Engineering');
    expect(text).toContain('Due Fri Nov 20, 11:59 PM (Arizona time)');
    expect(text).toContain('1. Interview five students <i>(3 pt, half a day)</i>');
    expect(text).toContain('2. Integrate and proofread');
    expect(text).toContain('Upcoming');
    const [row] = eventsFor(`cubbie-import-${r.body.importId}`);
    expect(row).toMatchObject({
      telegramUserId: USER,
      kind: 'assignment',
      course: 'CSE 340: Software Engineering',
      title: 'Project 2: Campus Food Finder',
      dueAt: '2026-11-21T06:59:00.000Z',
      url: 'https://canvas.asu.edu/courses/123456/assignments/7654321',
      removedAt: null,
    });
  });
  it('passes the rubric to the plan and shows points', async () => {
    const r = await post(withCode(full, null));
    expect(r.status).toBe(200);
    expect(parse.mock.calls[0]![3]).toContain('Implementation (30 pts)');
    expect(String(sendMessage.mock.calls[0]![1])).toContain('100 points');
  }, 20_000);
  it('says so and skips the calendar when Canvas has no due date', async () => {
    const body = withCode({ ...textOnly, assignment: { ...textOnly.assignment, dueAt: null } }, null);
    const r = await post(body);
    expect(r.status).toBe(200);
    expect(eventsFor(`cubbie-import-${r.body.importId}`)).toHaveLength(0);
    const text = String(sendMessage.mock.calls[0]![1]);
    expect(text).toContain('No due date in Canvas');
    expect(text).toContain("didn't add it to your Upcoming list");
  });
  it('still DMs the details and keeps the due date when the plan fails', async () => {
    parse.mockRejectedValue(new Error('groq down'));
    const r = await post(withCode(fresh(), null));
    expect(r.status).toBe(200);
    expect(String(sendMessage.mock.calls[0]![1])).toContain("couldn't turn this one into steps");
    expect(eventsFor(`cubbie-import-${r.body.importId}`)).toHaveLength(1);
    expect(importRow(r.body.importId).status).toBe('imported');
  });
  it('escapes HTML from Canvas and the LLM', async () => {
    parse.mockResolvedValue({ ...plan, tasks: [{ ...plan.tasks[0]!, title: '<script>x</script>' }] } as never);
    await post(withCode({ ...textOnly, assignment: { ...textOnly.assignment, title: 'A <b> & B' } }, null));
    const text = String(sendMessage.mock.calls[0]![1]);
    expect(text).toContain('A &lt;b&gt; &amp; B');
    expect(text).toContain('&lt;script&gt;');
  });
  it('still answers when the DM fails', async () => {
    sendMessage.mockRejectedValue(new Error('bot was blocked'));
    expect((await post(withCode(textOnly, null))).status).toBe(200);
  });
  it('keeps imported items when the Canvas feed polls or is disconnected', async () => {
    const r = await post(withCode(fresh(), null));
    const uid = `cubbie-import-${r.body.importId}`;
    applyFeedEvents(USER, []);
    expect(eventsFor(uid)[0]!.removedAt).toBeNull();
    deleteFeed(USER);
    expect(eventsFor(uid)).toHaveLength(1);
  });
  it('does not add a second item when the same assignment is already in the calendar', async () => {
    const body = fresh();
    const first = await post(withCode(body, null));
    const again = await post(withCode(body, null));
    expect(eventsFor(`cubbie-import-${first.body.importId}`)).toHaveLength(1);
    expect(eventsFor(`cubbie-import-${again.body.importId}`)).toHaveLength(0);
    expect(String(sendMessage.mock.calls[1]![1])).toContain('Upcoming list');
  });
  it('rejects a link code as an unknown import code', async () => {
    const pc = createPairCode(USER, null, new Date(), undefined, 'link');
    expect((await post({ ...textOnly, pairCode: pc.code })).body.error).toBe('code_unknown');
  });
});

describe('group imports are unchanged', () => {
  it('goes through the group intake, not the personal plan', async () => {
    const r = await post(withCode(textOnly));
    expect(r.body.message).toBe('Sent to Groupie. Check your group.');
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(parse).not.toHaveBeenCalled();
    // The only group message from the importer is the text-only line (the intake posts the task list).
    expect(sendMessage.mock.calls.map((c) => c[1])).toEqual([TEXT_ONLY_LINE]);
    expect(db.select().from(schema.calendarEvents).all().some((e) => e.uid === `cubbie-import-${r.body.importId}`)).toBe(false);
  });
});
