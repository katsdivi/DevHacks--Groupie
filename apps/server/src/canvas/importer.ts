import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import {
  CubbieImportPayload,
  IMPORT_RATE_LIMIT,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TEXT,
  MAX_ATTACHMENTS,
  type CubbieImportResponse,
  type RubricCriterion,
} from '@groupie/shared';
import { env } from '../env.ts';
import { db, schema } from '../db/index.ts';
import { getGroup } from '../groups.ts';
import { expectingAssignment, ingestAssignment, type IngestResult } from '../intake.ts';
import { extractDocumentText, fileExtension, formatRubricContext } from '../parse.ts';
import { getPairCode } from './pairCodes.ts';
import { verifySignature } from './crypto.ts';
import { runPersonalImport } from './personal.ts';
import { postImportFiles, recordCanvasImport, type ImportFile } from './afterImport.ts';

const { cubbieImports, cubbiePairCodes } = schema;

export const IMPORTED_MESSAGE = 'Sent to Groupie. Check your group.';
/** For a code made in a private chat: the plan arrives as a Telegram DM. */
export const PERSONAL_MESSAGE = 'Sent to Groupie. Check your Telegram messages.';
/** How long the HTTP request waits for the intake before answering anyway. */
export const INGEST_WAIT_MS = 25_000;

/**
 * Every error the import can answer with, and its HTTP status. The Cubbie Skill maps these to what it
 * tells the student. `not_expecting` is an addition to the original list (see docs/IMPORT_FIXES_ASSUMPTIONS.md).
 */
export const IMPORT_ERROR_STATUS = {
  bad_signature: 401,
  invalid_payload: 400,
  payload_too_large: 413,
  code_unknown: 404,
  code_used: 409,
  code_expired: 409,
  not_expecting: 409,
  rate_limited: 429,
  server_error: 500,
} as const;
export type ImportErrorCode = keyof typeof IMPORT_ERROR_STATUS;
export const IMPORT_ERROR_CODES = Object.keys(IMPORT_ERROR_STATUS) as ImportErrorCode[];

const NEW_CODE = 'Tap Get my code in Groupie for a new one.';
export const IMPORT_MESSAGES = {
  importsOff: 'Groupie is not set up for Canvas imports right now. Try again later.',
  badSignature: "Groupie couldn't confirm this came from the Groupie Skill. Reinstall the Skill and try again.",
  notJson: "Groupie couldn't read that request. Try sending it again?",
  badPayload: "Groupie couldn't read this assignment. Try sending it again?",
  tooLarge: 'That assignment is too big to send (15 MB max). Try again without the biggest file.',
  unknown: `That code does not exist. ${NEW_CODE}`,
  used: `That code was already used. ${NEW_CODE}`,
  inFlight: 'That code is being imported right now. Check your group in a moment.',
  expired: `That code expired. ${NEW_CODE}`,
  notExpecting: 'This group already has its assignment. Use /reset in the group to start over.',
  rateLimited: 'Too many imports. Try again in an hour.',
  serverError: 'Something went wrong on our side. Your code still works, so try again in a minute.',
  intakeFailed: "Groupie couldn't make tasks from this one. Your code still works, so try again, or drop the PDF in the group.",
} as const;

/** What the student hears when the intake turns the import down. The code stays usable in every case. */
const INTAKE_FAILURE_MESSAGES: Partial<Record<Exclude<IngestResult, { ok: true }>['reason'], string>> = {
  too_short: "Canvas didn't have much text for this one. Drop the assignment PDF in the group instead.",
  busy: 'Groupie is still reading the last one. Try again in a minute with the same code.',
  no_team_size: 'Set the team size first: send /setup in the group, then try again with the same code.',
  no_group: "Groupie isn't in that group anymore. Add it back, then try again with the same code.",
};

export type ImportErrorBody = { error: ImportErrorCode; message: string; requestId: string };
export type ImportReply = { status: number; body: CubbieImportResponse | ImportErrorBody };

/** A request id for logs and error bodies: Railway's when present, else a short random one. */
export const newRequestId = () => randomUUID().replace(/-/g, '').slice(0, 16);

/** The error reply. Logs one line with the request id and code (and a field path, never values). */
export function importError(requestId: string, error: ImportErrorCode, message: string, detail?: string): ImportReply {
  console.warn(`[import] ${requestId} ${error}${detail ? ` (${detail})` : ''}`);
  return { status: IMPORT_ERROR_STATUS[error], body: { error, message, requestId } };
}

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

/** One format for rubrics everywhere, so the parse prompt's rubric rules recognize it. */
export const formatRubric = (criteria: RubricCriterion[]): string => formatRubricContext({ criteria });

/** The payload as stored: attachments keep their name and size but lose the base64. */
export function storablePayload(p: CubbieImportPayload) {
  return {
    ...p,
    attachments: p.attachments?.map(({ base64, ...a }) => (base64 ? { ...a, base64Length: base64.length } : a)),
  };
}

/** The intake text plus what happened to each attachment. */
export type PreparedIntake = {
  text: string;
  /** Attachments that came as bytes within the cap, to post in the group after the task list. */
  files: ImportFile[];
  /** Attachments over their cap (or past MAX_ATTACHMENTS), left out of the import. */
  dropped: string[];
};

/** Header, description, then each attachment's text, the way the intake expects one document. Never throws on a file. */
export async function prepareIntake(p: CubbieImportPayload): Promise<PreparedIntake> {
  const a = p.assignment;
  const code = p.course.code;
  const header = [
    `Course: ${p.course.name}${code && !p.course.name.includes(code) ? ` (${code})` : ''}`,
    `Assignment: ${a.title}`,
    a.pointsPossible != null ? `Points: ${a.pointsPossible}` : null,
    `Due: ${a.dueAt ?? 'no due date in Canvas'}`,
  ].filter(Boolean);
  const parts = [header.join('\n'), a.descriptionText.trim()].filter(Boolean);
  const all = p.attachments ?? [];
  const dropped = all.slice(MAX_ATTACHMENTS).map((f) => f.filename);
  if (dropped.length) console.warn(`[import] ${dropped.length} attachments past the first ${MAX_ATTACHMENTS} left out`);
  const files: ImportFile[] = [];
  const links: string[] = [];
  for (const f of all.slice(0, MAX_ATTACHMENTS)) {
    if (f.text) {
      if (f.text.length > MAX_ATTACHMENT_TEXT) {
        console.warn(`[import] attachment text over ${MAX_ATTACHMENT_TEXT} chars left out`);
        dropped.push(f.filename);
      } else parts.push(`Attachment: ${f.filename}\n${f.text.trim()}`);
    } else if (f.base64) {
      const bytes = Buffer.from(f.base64, 'base64');
      if (bytes.length > MAX_ATTACHMENT_BYTES) {
        console.warn(`[import] attachment over ${MAX_ATTACHMENT_BYTES} bytes left out`);
        dropped.push(f.filename);
        continue;
      }
      files.push({ filename: f.filename, mimeType: f.mimeType, bytes });
      try {
        const text = await extractDocumentText(new Uint8Array(bytes), fileExtension(f.filename, f.mimeType));
        parts.push(`Attachment: ${f.filename}\n${text.trim()}`);
      } catch {
        parts.push(`Attachment: ${f.filename} (could not be read)`);
      }
    } else if (!f.url) console.warn('[import] attachment with no text, bytes, or link ignored');
    if (f.url) links.push(`- ${f.filename}: ${f.url}`);
  }
  if (links.length) parts.push(`Linked files (not downloaded):\n${links.join('\n')}`);
  return { text: parts.join('\n\n'), files, dropped };
}

/** Just the intake text. */
export const buildIntakeText = async (p: CubbieImportPayload) => (await prepareIntake(p)).text;

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

/**
 * Codes with an import running right now (this process; Groupie runs one instance). A second request with
 * the same code gets code_used while the first runs. The code is only marked used after a successful import,
 * so a failed import leaves it usable.
 */
const inFlightCodes = new Set<string>();

/** Marks the code used after a successful import. Ignores the expiry, since the import already happened. */
function markCodeUsed(code: string, now: Date) {
  db.update(cubbiePairCodes)
    .set({ usedAt: now.toISOString() })
    .where(and(eq(cubbiePairCodes.code, code), isNull(cubbiePairCodes.usedAt)))
    .run();
}

export type ImportOptions = { ingestWaitMs?: number; now?: Date; requestId?: string };

/** Everything behind POST /api/cubbie/import. Pure in, status and body out. Never throws. */
export async function handleImport(rawBody: Buffer | undefined, signature: string | undefined, ip: string, opts: ImportOptions = {}): Promise<ImportReply> {
  const requestId = opts.requestId ?? newRequestId();
  try {
    return await runImport(rawBody, signature, ip, opts, requestId);
  } catch (err) {
    console.error(`[import] ${requestId} unexpected error`, err);
    return importError(requestId, 'server_error', IMPORT_MESSAGES.serverError);
  }
}

async function runImport(rawBody: Buffer | undefined, signature: string | undefined, ip: string, opts: ImportOptions, requestId: string): Promise<ImportReply> {
  const M = IMPORT_MESSAGES;
  const fail = (code: ImportErrorCode, message: string, detail?: string) => importError(requestId, code, message, detail);

  const secret = env.cubbiePublicSigningKey;
  if (!secret) return fail('server_error', M.importsOff, 'imports off');
  if (!rawBody) return fail('invalid_payload', M.notJson, 'no JSON body');
  if (!verifySignature(secret, rawBody, signature)) return fail('bad_signature', M.badSignature);

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return fail('invalid_payload', M.notJson, 'not JSON');
  }
  const parsed = CubbieImportPayload.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail('invalid_payload', M.badPayload, issue ? issue.path.join('.') || 'body' : undefined);
  }
  const p = parsed.data;

  if (!takeRateLimit(`ip:${ip}`, IMPORT_RATE_LIMIT.perIpPerHour)) return fail('rate_limited', M.rateLimited, 'ip');
  const pc = getPairCode(p.pairCode);
  // A link code is not an import code; it looks the same as a missing one.
  if (!pc || pc.purpose !== 'import') return fail('code_unknown', M.unknown);
  if (!takeRateLimit(`user:${pc.telegramUserId}`, IMPORT_RATE_LIMIT.perUserPerHour)) return fail('rate_limited', M.rateLimited, 'user');
  const now = opts.now ?? new Date();
  if (pc.usedAt) return fail('code_used', M.used);
  if (inFlightCodes.has(pc.code)) return fail('code_used', M.inFlight, 'in flight');
  if (pc.expiresAt <= now.toISOString()) return fail('code_expired', M.expired);

  const group = pc.groupChatId != null ? getGroup(pc.groupChatId) : undefined;
  if (group && !expectingAssignment(group)) return fail('not_expecting', M.notExpecting);

  // Single use: the code is locked from here and marked used only once the import succeeds.
  inFlightCodes.add(pc.code);
  const release = () => inFlightCodes.delete(pc.code);
  let work: Promise<unknown> | undefined;
  try {
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

    let prepared: PreparedIntake;
    try {
      prepared = await prepareIntake(p);
    } catch (err) {
      console.error(`[import] ${requestId} attachments failed`, err);
      setImport(importId, 'failed', 'Could not read the attachments.');
      return fail('server_error', M.serverError, 'attachments');
    }
    const extraContext = p.rubric ? formatRubric(p.rubric.criteria) : undefined;
    const waitMs = opts.ingestWaitMs ?? INGEST_WAIT_MS;

    // A code made in a private chat: the student's own assignment, planned for one and sent by DM.
    if (!group) {
      const personal = runPersonalImport(pc.telegramUserId, importId, p, prepared.text, extraContext).then(
        (r) => {
          const ok = !!(r.plan || r.calendarSaved);
          setImport(importId, ok ? 'imported' : 'failed', r.plan ? null : 'No plan could be made.');
          if (ok) markCodeUsed(pc.code, opts.now ?? new Date());
          return ok;
        },
        (err: unknown) => {
          console.error('Personal import failed', err);
          setImport(importId, 'failed', 'Could not make a plan.');
          return false;
        },
      );
      work = personal.then(release, release);
      const ok = await raceTimeout(personal, waitMs);
      if (ok === false) return fail('server_error', M.intakeFailed, 'personal plan failed');
      return { status: 200, body: { ok: true, importId, message: PERSONAL_MESSAGE } };
    }

    const ingest = ingestAssignment(group.id, {
      text: prepared.text,
      sourceLabel: p.assignment.title,
      extraContext,
      dueDate: p.assignment.dueAt,
      courseName: p.course.name,
      source: 'canvas',
    }).then(
      async (r) => {
        finishImport(importId, r);
        if (r.ok) {
          try {
            markCodeUsed(pc.code, opts.now ?? new Date());
            recordCanvasImport(group.id, importId);
            await postImportFiles(group.id, prepared.files, prepared.dropped.length);
          } catch (err) {
            console.error(`[import] ${requestId} after-import step failed`, err);
          }
        }
        return r;
      },
      (err: unknown) => {
        console.error('Cubbie import intake failed', err);
        const r: IngestResult = { ok: false, reason: 'failed', message: M.intakeFailed };
        finishImport(importId, r);
        return r;
      },
    );
    work = ingest.then(release, release);

    const result = await raceTimeout(ingest, waitMs);
    if (result === 'timeout' || result.ok) return { status: 200, body: { ok: true, importId, message: IMPORTED_MESSAGE } };
    if (result.reason === 'not_expecting') return fail('not_expecting', M.notExpecting, 'intake');
    // Intake failures (too short, parse failed, busy, no team size): the code stays usable.
    return fail('server_error', INTAKE_FAILURE_MESSAGES[result.reason] ?? M.intakeFailed, `intake ${result.reason}`);
  } finally {
    // The lock lasts as long as the import runs, even past a timeout answer.
    if (!work) release();
  }
}
