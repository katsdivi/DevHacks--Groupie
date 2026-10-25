import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { CubbieImportPayload, IMPORT_RATE_LIMIT, PAIR_CODE_TTL_MS } from '@groupie/shared';
import { env } from '../env.ts';
import { db, schema } from '../db/index.ts';
import { bot } from '../bot/core.ts';
import { getGroup, setTeamSize, upsertGroup } from '../groups.ts';
import { ingestAssignment, type IngestResult } from '../intake.ts';
import { signBody } from './crypto.ts';
import { IMPORT_ERROR_CODES, IMPORT_ERROR_STATUS, resetRateLimits } from './importer.ts';
import {
  DROPPED_ONE_LINE,
  FROM_CANVAS_CAPTION,
  postImportFiles,
  TELEGRAM_UPLOAD_LIMIT,
  TEXT_ONLY_LINE,
  tooBigForTelegram,
} from './afterImport.ts';
import { createPairCode, getPairCode } from './pairCodes.ts';
import { runPersonalImport } from './personal.ts';
import { assignmentSource } from './assignmentSource.ts';
import { startTestApp } from './testApp.ts';

vi.mock('../intake.ts', async (orig) => ({ ...(await orig<typeof import('../intake.ts')>()), ingestAssignment: vi.fn() }));
const ingest = vi.mocked(ingestAssignment);
vi.mock('./personal.ts', async (orig) => ({ ...(await orig<typeof import('./personal.ts')>()), runPersonalImport: vi.fn() }));
const personal = vi.mocked(runPersonalImport);
const okResult = { ok: true as const, parsed: { assignment_title: 'x', due_date: null, tasks: [] } as never };
const failResult: IngestResult = { ok: false, reason: 'failed', message: 'nope' };

const fixture = (name: string) => JSON.parse(fs.readFileSync(new URL(`../../../../fixtures/cubbie/${name}`, import.meta.url), 'utf8'));
const live = fixture('import_live_shape.json');
const full = fixture('import_full.json');
const textOnly = fixture('import_text_only.json');

const SECRET = 'fixes-secret';
const GROUP = -3003;
const USER = 7777;
let app: Awaited<ReturnType<typeof startTestApp>>;
const sendMessage = vi.spyOn(bot.api, 'sendMessage');
const sendDocument = vi.spyOn(bot.api, 'sendDocument');
const warn = vi.spyOn(console, 'warn');
let ip = 0;

beforeAll(async () => {
  app = await startTestApp();
  upsertGroup(GROUP, 'Team');
  setTeamSize(GROUP, 4);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => app.close());
beforeEach(() => {
  env.cubbiePublicSigningKey = SECRET;
  resetRateLimits();
  ingest.mockReset();
  ingest.mockResolvedValue(okResult);
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({ message_id: 1 } as never);
  sendDocument.mockReset();
  sendDocument.mockResolvedValue({ message_id: 2, document: { file_id: 'tg-doc-1', file_unique_id: 'u', file_name: 'project2-spec.pdf', mime_type: 'application/pdf' } } as never);
  warn.mockReset();
  warn.mockImplementation(() => {});
  db.update(schema.groups).set({ status: 'setup', canvasImportId: null, canvasFileAt: null }).where(eq(schema.groups.id, GROUP)).run();
  ip++;
});

type Res = { status: number; body: Record<string, unknown> };
async function post(body: object | string, opts: { sig?: string | null; headers?: Record<string, string> } = {}): Promise<Res> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${ip}`, ...opts.headers };
  const sig = opts.sig === undefined ? signBody(SECRET, raw) : opts.sig;
  if (sig) headers['x-groupie-signature'] = sig;
  const res = await fetch(`${app.base}/api/cubbie/import`, { method: 'POST', headers, body: raw });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const withCode = (payload: Record<string, unknown>, groupId: number | null = GROUP) => ({ ...payload, pairCode: createPairCode(USER, groupId).code });
const usedAt = (code: string) => getPairCode(code)!.usedAt;
const settle = () => new Promise((r) => setTimeout(r, 20));

/** Every error reply has exactly the documented shape and status. */
function expectRejection(r: Res, code: string) {
  expect(IMPORT_ERROR_CODES).toContain(code);
  expect(r.status).toBe(IMPORT_ERROR_STATUS[code as keyof typeof IMPORT_ERROR_STATUS]);
  expect(Object.keys(r.body).sort()).toEqual(['error', 'message', 'requestId']);
  expect(r.body.error).toBe(code);
  expect(String(r.body.message).length).toBeGreaterThan(10);
  expect(String(r.body.requestId).length).toBeGreaterThan(0);
}

describe('every rejection explains itself', () => {
  it('has exactly the documented codes', () => {
    expect([...IMPORT_ERROR_CODES].sort()).toEqual(
      ['bad_signature', 'code_expired', 'code_unknown', 'code_used', 'invalid_payload', 'not_expecting', 'payload_too_large', 'rate_limited', 'server_error'].sort(),
    );
  });
  it('bad_signature', async () => {
    expectRejection(await post(withCode(live), { sig: 'sha256=00' }), 'bad_signature');
  });
  it('invalid_payload for broken JSON, a schema miss, and no JSON body', async () => {
    expectRejection(await post('{"pairCode": '), 'invalid_payload');
    expectRejection(await post({ ...withCode(live), course: {} }), 'invalid_payload');
    const res = await fetch(`${app.base}/api/cubbie/import`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' });
    expectRejection({ status: res.status, body: (await res.json()) as Record<string, unknown> }, 'invalid_payload');
  });
  it('payload_too_large over 15 MB, as JSON', async () => {
    const big = JSON.stringify({ ...withCode(live), pad: 'x'.repeat(15 * 1024 * 1024 + 10) });
    expectRejection(await post(big, { sig: 'sha256=00' }), 'payload_too_large');
  }, 20_000);
  it('accepts a body just under 15 MB', async () => {
    const body = withCode({ ...live, pad: 'x'.repeat(14 * 1024 * 1024) });
    expect((await post(body)).status).toBe(200);
  }, 20_000);
  it('code_unknown, code_used, code_expired', async () => {
    expectRejection(await post({ ...live, pairCode: 'ZZZZZZ' }), 'code_unknown');
    const body = withCode(live);
    expect((await post(body)).status).toBe(200);
    expectRejection(await post(body), 'code_used');
    const old = createPairCode(USER, GROUP, new Date(Date.now() - PAIR_CODE_TTL_MS - 1000));
    expectRejection(await post({ ...live, pairCode: old.code }), 'code_expired');
  });
  it('not_expecting when the group already has its assignment', async () => {
    db.update(schema.groups).set({ status: 'active' }).where(eq(schema.groups.id, GROUP)).run();
    expectRejection(await post(withCode(live)), 'not_expecting');
  });
  it('rate_limited', async () => {
    let last: Res | undefined;
    for (let i = 0; i <= IMPORT_RATE_LIMIT.perIpPerHour; i++) last = await post({ ...live, pairCode: 'ZZZZZZ' }, { headers: { 'x-forwarded-for': '7.7.7.7' } });
    expectRejection(last!, 'rate_limited');
  });
  it('server_error when imports are off and when the intake fails', async () => {
    ingest.mockResolvedValue(failResult);
    expectRejection(await post(withCode(live)), 'server_error');
    env.cubbiePublicSigningKey = '';
    expectRejection(await post(withCode(live), { sig: null }), 'server_error');
  });
  it('uses the Railway request id and logs one line per rejection, never the payload', async () => {
    const r = await post({ ...live, pairCode: 'ZZZZZZ' }, { headers: { 'x-railway-request-id': 'req-abc123' } });
    expect(r.body.requestId).toBe('req-abc123');
    expect(warn.mock.calls.map((c) => c.join(' '))).toEqual(['[import] req-abc123 code_unknown']);
    await post({ ...withCode(live), course: {} }, { headers: { 'x-railway-request-id': 'req-2' } });
    const line = warn.mock.calls.at(-1)!.join(' ');
    expect(line).toMatch(/^\[import\] req-2 invalid_payload/);
    expect(line).not.toContain('Placeholder');
  });
});

describe('the code is marked used only after a successful import', () => {
  it('keeps the code usable after an intake failure, then a retry succeeds, then code_used', async () => {
    const body = withCode(live);
    ingest.mockResolvedValueOnce(failResult);
    expectRejection(await post(body), 'server_error');
    expect(usedAt(body.pairCode)).toBeNull();
    expect((await post(body)).status).toBe(200);
    expect(usedAt(body.pairCode)).not.toBeNull();
    expectRejection(await post(body), 'code_used');
  });
  it('keeps the code usable after invalid_payload and a thrown intake', async () => {
    const body = withCode(live);
    expectRejection(await post({ ...body, assignment: { title: '' } }), 'invalid_payload');
    ingest.mockRejectedValueOnce(new Error('boom'));
    expectRejection(await post(body), 'server_error');
    expect(usedAt(body.pairCode)).toBeNull();
    expect((await post(body)).status).toBe(200);
  });
  it('lets one of two concurrent requests win', async () => {
    ingest.mockImplementation(() => new Promise((r) => setTimeout(() => r(okResult), 40)));
    const body = withCode(live);
    const results = await Promise.all([post(body), post(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error).toBe('code_used');
    expect(ingest).toHaveBeenCalledTimes(1);
  });
  it('holds the lock past a timeout answer and frees the code if the intake then fails', async () => {
    let finish!: (r: IngestResult) => void;
    ingest.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const { handleImport } = await import('./importer.ts');
    const body = withCode(live);
    const raw = JSON.stringify(body);
    const first = await handleImport(Buffer.from(raw), signBody(SECRET, raw), '1.1.1.1', { ingestWaitMs: 10 });
    expect(first.status).toBe(200);
    expectRejection(await post(body), 'code_used');
    finish(failResult);
    await settle();
    expect(usedAt(body.pairCode)).toBeNull();
    expect((await post(body)).status).toBe(200);
  });
  it('marks a personal import used only when it produced something', async () => {
    const body = withCode(live, null);
    personal.mockResolvedValueOnce({ plan: null, calendarSaved: false });
    expectRejection(await post(body), 'server_error');
    expect(usedAt(body.pairCode)).toBeNull();
    personal.mockResolvedValueOnce({ plan: null, calendarSaved: true });
    expect((await post(body)).status).toBe(200);
    expect(usedAt(body.pairCode)).not.toBeNull();
  });
});

describe('schema tolerance', () => {
  it('validates the live shape fixture', () => {
    const p = CubbieImportPayload.parse(live);
    expect(p.rubric).toBeUndefined();
    expect(p.assignment).toMatchObject({ descriptionText: '', pointsPossible: 100 });
    expect(p.attachments).toHaveLength(1);
  });
  it('imports the live shape: attachment text reaches the intake, the code is used, the group remembers the import', async () => {
    const body = withCode(live);
    const r = await post(body);
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    const input = ingest.mock.calls[0]![1];
    expect(input.text).toContain('Attachment: placeholder-assignment-brief.docx\nPlaceholder brief.');
    expect(input.text).toContain('Points: 100');
    expect(usedAt(body.pairCode)).not.toBeNull();
    expect(getGroup(GROUP)!.canvasImportId).toBe(r.body.importId);
  });
  it('tolerates extra fields, no attachments, the old description key, and a bad url', () => {
    const p = CubbieImportPayload.parse({
      ...live,
      extra: { anything: true },
      course: { name: 'C', code: null, id: 5 },
      assignment: { title: 'T', dueAt: null, description: 'Old key text', url: 'not a url', html: '<p>x</p>' },
      attachments: undefined,
    });
    expect(p.assignment.descriptionText).toBe('Old key text');
    expect(p.assignment.url).toBeUndefined();
    expect(CubbieImportPayload.parse({ ...live, attachments: undefined, rubric: undefined }).attachments).toBeUndefined();
    expect(CubbieImportPayload.parse({ ...live, assignment: { ...live.assignment, dueAt: undefined } }).assignment.dueAt).toBeNull();
  });
  it('ignores an attachment with no text and no bytes, with a log line', async () => {
    const r = await post(withCode({ ...live, attachments: [{ filename: 'mystery.bin', mimeType: 'application/zip', id: 9 }, ...live.attachments] }));
    expect(r.status).toBe(200);
    expect(ingest.mock.calls[0]![1].text).not.toContain('mystery.bin');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('no text, bytes, or link ignored'))).toBe(true);
  });
});

describe('files after a group import', () => {
  it('posts a bytes attachment as a document with the caption', async () => {
    const r = await post(withCode(full));
    expect(r.status).toBe(200);
    expect(sendDocument).toHaveBeenCalledTimes(1);
    const [chat, , opts] = sendDocument.mock.calls[0]!;
    expect(chat).toBe(GROUP);
    expect(opts).toMatchObject({ caption: FROM_CANVAS_CAPTION });
    expect(assignmentSource(GROUP)).toMatchObject({ fileId: 'tg-doc-1', fileName: 'project2-spec.pdf', mimeType: 'application/pdf' });
    expect(sendMessage.mock.calls.map((c) => c[1])).not.toContain(TEXT_ONLY_LINE);
  }, 20_000);
  it('posts the one text-only line when Cubbie sent text only', async () => {
    await post(withCode(live));
    expect(sendDocument).not.toHaveBeenCalled();
    expect(assignmentSource(GROUP).fileId).toBeUndefined();
    expect(assignmentSource(GROUP).canvasText).toContain('Placeholder brief.');
    expect(sendMessage.mock.calls.map((c) => [c[0], c[1]])).toEqual([[GROUP, TEXT_ONLY_LINE]]);
  });
  it('says one file was too big when an attachment was dropped', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 10).toString('base64');
    const r = await post(withCode({ ...live, attachments: [...live.attachments, { filename: 'huge.pdf', mimeType: 'application/pdf', base64: big }] }));
    expect(r.status).toBe(200);
    expect(sendMessage.mock.calls.map((c) => c[1])).toEqual([TEXT_ONLY_LINE, DROPPED_ONE_LINE]);
  }, 20_000);
  it('posts nothing after a failed intake', async () => {
    ingest.mockResolvedValue(failResult);
    await post(withCode(live));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(getGroup(GROUP)!.canvasImportId).toBeNull();
  });
  it('skips a file over the Telegram limit and says so', async () => {
    await postImportFiles(GROUP, [{ filename: 'giant.pdf', bytes: Buffer.alloc(TELEGRAM_UPLOAD_LIMIT + 1) }], 0);
    expect(sendDocument).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls.map((c) => c[1])).toEqual([tooBigForTelegram('giant.pdf')]);
  });
  it('sends nothing from the text-only fixture without attachments beyond the one line', async () => {
    await post(withCode(textOnly));
    expect(sendMessage.mock.calls.map((c) => c[1])).toEqual([TEXT_ONLY_LINE]);
  });
});
