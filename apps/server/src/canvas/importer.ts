import { formatRubricContext } from '../parse.ts';
import { eq } from 'drizzle-orm';
import {
  CubbieImportPayload,
  IMPORT_RATE_LIMIT,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type CubbieImportResponse,
  type RubricCriterion,
} from '@groupie/shared';
import { env } from '../env.ts';
import { db, schema } from '../db/index.ts';
import { getGroup } from '../groups.ts';
import { expectingAssignment, ingestAssignment, type IngestResult } from '../intake.ts';
import { extractDocumentText, fileExtension } from '../parse.ts';
import { claimPairCode, getPairCode } from './pairCodes.ts';
import { verifySignature } from './crypto.ts';
import { runPersonalImport } from './personal.ts';

const { cubbieImports } = schema;

export const IMPORTED_MESSAGE = 'Sent to Groupie. Check your group.';
/** For a code made in a private chat: the plan arrives as a Telegram DM. */
export const PERSONAL_MESSAGE = 'Sent to Groupie. Check your Telegram messages.';
/** How long the HTTP request waits for the intake before answering anyway. */
export const INGEST_WAIT_MS = 25_000;

export type ImportReply = { status: number; body: CubbieImportResponse | { error: string; message: string } };

const fail = (status: number, error: string, message: string): ImportReply => ({ status, body: { error, message } });

// In-memory sliding windows, keyed like "ip:<addr>", "user:<id>" or "pc-create-ip:<addr>". One window per key.
const HOUR_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

/** Records a hit and returns false when the key is over `limit` within `windowMs` (default one hour). */
export function takeRateLimit(key: string, limit: number, now = Date.now(), windowMs = HOUR_MS): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export const resetRateLimits = () => hits.clear();

const RATE_LIMITED = () => fail(429, 'rate_limited', 'Too many imports. Try again in an hour.');

/** One format for rubrics everywhere, so the parse prompt's rubric rules recognize it. */
export const formatRubric = (criteria: RubricCriterion[]): string => formatRubricContext({ criteria });

/** The payload as stored: attachments keep their name and size but lose the base64. */
export function storablePayload(p: CubbieImportPayload) {
  return {
    ...p,
    attachments: p.attachments?.map(({ base64, ...a }) => (base64 ? { ...a, base64Length: base64.length } : a)),
  };
}

export class AttachmentError extends Error {}

/** Header, description, then each attachment's text, the way the intake expects one document. */
export async function buildIntakeText(p: CubbieImportPayload): Promise<string> {
  const a = p.assignment;
  const header = [
    `Course: ${p.course.name}${p.course.code && !p.course.name.includes(p.course.code) ? ` (${p.course.code})` : ''}`,
    `Assignment: ${a.title}`,
    a.pointsPossible != null ? `Points: ${a.pointsPossible}` : null,
    `Due: ${a.dueAt ?? 'no due date in Canvas'}`,
  ].filter(Boolean);
  const parts = [header.join('\n'), a.descriptionText.trim()].filter(Boolean);
  const files = p.attachments ?? [];
  if (files.length > MAX_ATTACHMENTS) throw new AttachmentError(`At most ${MAX_ATTACHMENTS} attachments`);
  const links: string[] = [];
  for (const f of files) {
    if (f.text) parts.push(`Attachment: ${f.filename}\n${f.text.trim()}`);
    else if (f.base64) {
      const bytes = Buffer.from(f.base64, 'base64');
      if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AttachmentError(`${f.filename} is over 10 MB`);
      try {
        const text = await extractDocumentText(new Uint8Array(bytes), fileExtension(f.filename, f.mimeType));
        parts.push(`Attachment: ${f.filename}\n${text.trim()}`);
      } catch {
        parts.push(`Attachment: ${f.filename} (could not be read)`);
      }
    }
    if (f.url) links.push(`- ${f.filename}: ${f.url}`);
  }
  if (links.length) parts.push(`Linked files (not downloaded):\n${links.join('\n')}`);
  return parts.join('\n\n');
}

/** The promise's value, or 'timeout' after `ms` (the work keeps running). */
async function raceTimeout<T>(work: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
    timer.unref();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const setImport = (id: number, status: 'imported' | 'failed', error: string | null) =>
  db.update(cubbieImports).set({ status, error }).where(eq(cubbieImports.id, id)).run();

const finishImport = (id: number, r: IngestResult) => setImport(id, r.ok ? 'imported' : 'failed', r.ok ? null : r.message);

export type ImportOptions = { ingestWaitMs?: number; now?: Date };

/** Everything behind POST /api/cubbie/import. Pure in, status and body out. */
export async function handleImport(rawBody: Buffer | undefined, signature: string | undefined, ip: string, opts: ImportOptions = {}): Promise<ImportReply> {
  const secret = env.cubbiePublicSigningKey;
  if (!secret) return fail(503, 'imports_off', 'Cubbie imports are not set up on this server.');
  if (!rawBody || !verifySignature(secret, rawBody, signature)) return fail(401, 'bad_signature', 'Signature check failed.');

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return fail(400, 'bad_payload', "Groupie couldn't read that request. Try again?");
  }
  const parsed = CubbieImportPayload.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue) console.warn(`[import] rejected: ${issue.path.join('.') || 'body'}: ${issue.message}`);
    return fail(400, 'bad_payload', "Groupie couldn't read this assignment. Try sending it again?");
  }
  const p = parsed.data;

  if (!takeRateLimit(`ip:${ip}`, IMPORT_RATE_LIMIT.perIpPerHour)) return RATE_LIMITED();
  const pc = getPairCode(p.pairCode);
  // A link code is not an import code; it looks the same as a missing one.
  if (!pc || pc.purpose !== 'import') return fail(404, 'unknown_code', 'That code does not exist. Tap Get my code in Groupie for a new one.');
  if (!takeRateLimit(`user:${pc.telegramUserId}`, IMPORT_RATE_LIMIT.perUserPerHour)) return RATE_LIMITED();
  const now = opts.now ?? new Date();
  if (pc.usedAt) return fail(409, 'code_used', 'That code was already used. Tap Get my code in Groupie for a new one.');
  if (pc.expiresAt <= now.toISOString()) return fail(409, 'code_expired', 'That code expired. Tap Get my code in Groupie for a new one.');

  const group = pc.groupChatId != null ? getGroup(pc.groupChatId) : undefined;
  if (group && !expectingAssignment(group)) {
    return fail(409, 'not_expecting', 'This group already has its assignment. Use /reset in the group to start over.');
  }
  // Single use: only one request can flip used_at from NULL.
  if (!claimPairCode(pc.code, now)) {
    const again = getPairCode(pc.code);
    return again?.usedAt
      ? fail(409, 'code_used', 'That code was already used. Tap Get my code in Groupie for a new one.')
      : fail(409, 'code_expired', 'That code expired. Tap Get my code in Groupie for a new one.');
  }

  const importId = db
    .insert(cubbieImports)
    .values({
      pairCode: pc.code,
      telegramUserId: pc.telegramUserId,
      groupChatId: group?.id ?? null,
      payload: storablePayload(p),
      status: 'received',
      createdAt: now.toISOString(),
    })
    .returning({ id: cubbieImports.id })
    .get().id;

  let text: string;
  try {
    text = await buildIntakeText(p);
  } catch (err) {
    const message = err instanceof AttachmentError ? err.message : 'Could not read the attachments.';
    setImport(importId, 'failed', message);
    return fail(400, 'bad_payload', message);
  }
  const extraContext = p.rubric ? formatRubric(p.rubric.criteria) : undefined;

  // A code made in a private chat: the student's own assignment, planned for one and sent by DM.
  if (!group) {
    const personal = runPersonalImport(pc.telegramUserId, importId, p, text, extraContext).then(
      (r) => setImport(importId, r.plan || r.calendarSaved ? 'imported' : 'failed', r.plan ? null : 'No plan could be made.'),
      (err: unknown) => {
        console.error('Personal import failed', err);
        setImport(importId, 'failed', 'Could not make a plan.');
      },
    );
    await raceTimeout(personal, opts.ingestWaitMs ?? INGEST_WAIT_MS);
    return { status: 200, body: { ok: true, importId, message: PERSONAL_MESSAGE } };
  }

  const ingest = ingestAssignment(group.id, {
    text,
    sourceLabel: p.assignment.title,
    extraContext,
    dueDate: p.assignment.dueAt,
    courseName: p.course.name,
    source: 'canvas',
  }).then(
    (r) => {
      finishImport(importId, r);
      return r;
    },
    (err: unknown) => {
      console.error('Cubbie import intake failed', err);
      const r: IngestResult = { ok: false, reason: 'failed', message: "I couldn't make sense of this one. Get a new code and try again." };
      finishImport(importId, r);
      return r;
    },
  );

  const result = await raceTimeout(ingest, opts.ingestWaitMs ?? INGEST_WAIT_MS);

  if (result === 'timeout' || result.ok) return { status: 200, body: { ok: true, importId, message: IMPORTED_MESSAGE } };
  if (result.reason === 'not_expecting') return fail(409, 'not_expecting', result.message);
  return fail(422, result.reason, result.message);
}
