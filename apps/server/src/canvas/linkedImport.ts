import { and, desc, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import {
  CUBBIE_SKILL_VERSION,
  CubbieLinkedImportPayload,
  IMPORT_RATE_LIMIT,
  PAIR_CODE_TTL_MS,
  type ImportTargetOption,
} from '@groupie/shared';
import { env } from '../env.ts';
import { db, schema } from '../db/index.ts';
import type { Group } from '../db/schema.ts';
import { getGroup } from '../groups.ts';
import { expectingAssignment } from '../intake.ts';
import { verifySignature } from './crypto.ts';
import { IMPORT_ERROR_STATUS, IMPORT_MESSAGES, newRequestId, runImportCore, takeRateLimit, type ImportOptions } from './importer.ts';
import { bearer, findLink, touchLink } from './link.ts';
import type { PairCode } from './pairCodes.ts';

/**
 * Code-free imports for linked students: POST /api/cubbie/import/linked. The Skill signs the body like the
 * code import and sends the student's link token as a bearer. The target comes from the body, else from the
 * student's one recent import code, else the server asks which group (choose_target).
 */

const { cubbieImports, cubbiePairCodes, members } = schema;

/** Every error the linked import can answer with: the import's list plus bad_link and choose_target. */
export const LINKED_ERROR_STATUS = { ...IMPORT_ERROR_STATUS, bad_link: 401, choose_target: 409 } as const;
export type LinkedErrorCode = keyof typeof LINKED_ERROR_STATUS;

/** Student-facing lines for the linked path (kept here, not in copy.ts). */
export const LINKED_MESSAGES = {
  badLink: 'Your Groupie link expired. Send /imessage in Groupie to relink.',
  chooseTarget: 'Which group should this go to?',
  notYourGroup: 'That is not one of your Groupie groups. Pick one from the list, or Just me.',
  inFlight: 'This assignment is being imported right now. Check your group in a moment.',
  serverError: 'Something went wrong on our side. Try again in a minute.',
} as const;

/** How far back a pair code counts as "the group you were just looking at". */
export const CONTEXT_WINDOW_MS = PAIR_CODE_TTL_MS;
/** Groups listed in a choose_target answer (Just me comes after them). */
export const MAX_TARGET_GROUPS = 5;
export const JUST_ME: ImportTargetOption = { kind: 'me', title: 'Just me' };

type LinkedErrorBody = { error: LinkedErrorCode; message: string; requestId: string; options?: ImportTargetOption[] };
export type LinkedReply = { status: number; body: object };

function linkedError(requestId: string, error: LinkedErrorCode, message: string, detail?: string, extra: object = {}): LinkedReply {
  console.warn(`[import] ${requestId} ${error} (linked${detail ? `, ${detail}` : ''})`);
  const body: LinkedErrorBody = { error, message, requestId, ...extra };
  return { status: LINKED_ERROR_STATUS[error], body };
}

// ---------------------------------------------------------------- Skill version (best effort, in memory)

const SKILL_UA = /groupie-import-skill\/(\d+)/i;
const skillVersions = new Map<number, number>();

/** The Skill version from a `groupie-import-skill/N` user agent, or null. */
export function skillVersionFrom(userAgent: string | undefined): number | null {
  const m = SKILL_UA.exec(userAgent ?? '');
  return m ? Number(m[1]) : null;
}

/** Remembers the Skill version this student was last seen on (since the last restart). */
export function noteSkillVersion(telegramUserId: number, userAgent: string | undefined): void {
  const v = skillVersionFrom(userAgent);
  if (v != null) skillVersions.set(telegramUserId, v);
}

/** True only when this student's Skill was seen on a version older than the current one. */
export const skillOutdated = (telegramUserId: number) => (skillVersions.get(telegramUserId) ?? CUBBIE_SKILL_VERSION) < CUBBIE_SKILL_VERSION;

export const resetSkillVersions = () => skillVersions.clear();

/** Middleware for /api/cubbie: notes the Skill version of any request that carries a live link token. */
export const skillVersionTap: RequestHandler = (req, _res, next) => {
  try {
    const ua = req.header('user-agent');
    const token = skillVersionFrom(ua) != null ? bearer(req.header('authorization')) : null;
    const link = token ? findLink(token) : undefined;
    if (link) noteSkillVersion(link.telegramUserId, ua);
  } catch (err) {
    console.error('[import] skill version tap failed', err);
  }
  next();
};

/** After a successful code import: notes the Skill version of the student who sent it. */
export function noteImportSkillVersion(importId: number, userAgent: string | undefined): void {
  if (skillVersionFrom(userAgent) == null) return;
  const row = db.select({ uid: cubbieImports.telegramUserId }).from(cubbieImports).where(eq(cubbieImports.id, importId)).get();
  if (row) noteSkillVersion(row.uid, userAgent);
}

// ---------------------------------------------------------------- targets

/** This student's unused import codes made in the last 30 minutes, newest first. */
export function recentImportCodes(telegramUserId: number, now = new Date()): PairCode[] {
  const iso = now.toISOString();
  const since = new Date(now.getTime() - CONTEXT_WINDOW_MS).toISOString();
  return db
    .select()
    .from(cubbiePairCodes)
    .where(
      and(
        eq(cubbiePairCodes.telegramUserId, telegramUserId),
        eq(cubbiePairCodes.purpose, 'import'),
        isNull(cubbiePairCodes.usedAt),
        gt(cubbiePairCodes.expiresAt, iso),
        gt(cubbiePairCodes.createdAt, since),
      ),
    )
    .orderBy(desc(cubbiePairCodes.createdAt))
    .all();
}

/** Groups the student joined (a members row) or made import codes for, newest first, that still exist. */
export function candidateGroups(telegramUserId: number): Group[] {
  const fromCodes = db
    .select({ id: cubbiePairCodes.groupChatId, at: cubbiePairCodes.createdAt })
    .from(cubbiePairCodes)
    .where(and(eq(cubbiePairCodes.telegramUserId, telegramUserId), eq(cubbiePairCodes.purpose, 'import'), isNotNull(cubbiePairCodes.groupChatId)))
    .all();
  const fromMembers = db
    .select({ id: members.groupId, at: members.createdAt })
    .from(members)
    .where(eq(members.tgUserId, telegramUserId))
    .all();
  const latest = new Map<number, string>();
  for (const r of [...fromCodes, ...fromMembers]) {
    if (r.id == null) continue;
    const seen = latest.get(r.id);
    if (!seen || r.at > seen) latest.set(r.id, r.at);
  }
  return [...latest.entries()]
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
    .map(([id]) => getGroup(id))
    .filter((g): g is Group => !!g);
}

/** The options of a choose_target answer: up to five groups, then Just me. */
export function targetOptions(telegramUserId: number): ImportTargetOption[] {
  const groups = candidateGroups(telegramUserId).slice(0, MAX_TARGET_GROUPS);
  return [...groups.map((g): ImportTargetOption => ({ kind: 'group', groupId: g.id, title: g.title ?? 'Your group' })), JUST_ME];
}

type Resolved = { group: Group | undefined; code: PairCode | undefined } | { choose: true; detail: string } | { notYours: true };

/** Where this import goes, from the explicit target or the student's recent codes. */
export function resolveTarget(telegramUserId: number, target: CubbieLinkedImportPayload['target'], now = new Date()): Resolved {
  const recent = recentImportCodes(telegramUserId, now);
  if (target?.kind === 'me') return { group: undefined, code: recent.find((c) => c.groupChatId == null) };
  if (target?.kind === 'group') {
    const group = candidateGroups(telegramUserId).find((g) => g.id === target.groupId);
    if (!group) return { notYours: true };
    return { group, code: recent.find((c) => c.groupChatId === group.id) };
  }
  const contexts = new Set(recent.map((c) => c.groupChatId));
  if (contexts.size === 0) return { choose: true, detail: 'no recent code' };
  if (contexts.size > 1) return { choose: true, detail: 'several recent codes' };
  const code = recent[0]!;
  if (code.groupChatId == null) return { group: undefined, code };
  const group = getGroup(code.groupChatId);
  return group ? { group, code } : { choose: true, detail: 'recent group gone' };
}

// ---------------------------------------------------------------- the handler

export type LinkedImportOptions = ImportOptions & { userAgent?: string };

/** Everything behind POST /api/cubbie/import/linked. Never throws. */
export async function handleLinkedImport(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  authorization: string | undefined,
  ip: string,
  opts: LinkedImportOptions = {},
): Promise<LinkedReply> {
  const requestId = opts.requestId ?? newRequestId();
  try {
    return await runLinked(rawBody, signature, authorization, ip, opts, requestId);
  } catch (err) {
    console.error(`[import] ${requestId} unexpected error (linked)`, err);
    return linkedError(requestId, 'server_error', LINKED_MESSAGES.serverError);
  }
}

async function runLinked(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  authorization: string | undefined,
  ip: string,
  opts: LinkedImportOptions,
  requestId: string,
): Promise<LinkedReply> {
  const M = IMPORT_MESSAGES;
  const L = LINKED_MESSAGES;
  const fail = (code: LinkedErrorCode, message: string, detail?: string, extra?: object) => linkedError(requestId, code, message, detail, extra);

  const secret = env.cubbiePublicSigningKey;
  if (!secret) return fail('server_error', M.importsOff, 'imports off');
  if (!rawBody) return fail('invalid_payload', M.notJson, 'no JSON body');
  if (!verifySignature(secret, rawBody, signature)) return fail('bad_signature', M.badSignature);
  // The identity comes only from the token. A user id in the body is never read.
  const token = bearer(authorization);
  const link = token ? findLink(token) : undefined;
  if (!link) return fail('bad_link', L.badLink, token ? 'unknown or revoked token' : 'no token');
  const uid = link.telegramUserId;

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return fail('invalid_payload', M.notJson, 'not JSON');
  }
  const parsed = CubbieLinkedImportPayload.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail('invalid_payload', M.badPayload, issue ? issue.path.join('.') || 'body' : undefined);
  }
  const p = parsed.data;

  if (!takeRateLimit(`ip:${ip}`, IMPORT_RATE_LIMIT.perIpPerHour)) return fail('rate_limited', M.rateLimited, 'ip');
  if (!takeRateLimit(`user:${uid}`, IMPORT_RATE_LIMIT.perUserPerHour)) return fail('rate_limited', M.rateLimited, 'user');
  const now = opts.now ?? new Date();
  touchLink(link.id, now);
  noteSkillVersion(uid, opts.userAgent);

  const resolved = resolveTarget(uid, p.target, now);
  if ('notYours' in resolved) return fail('invalid_payload', L.notYourGroup, 'target not owned');
  if ('choose' in resolved) return fail('choose_target', L.chooseTarget, resolved.detail, { options: targetOptions(uid) });
  const { group, code } = resolved;
  if (group && !expectingAssignment(group)) return fail('not_expecting', M.notExpecting);

  return runImportCore({
    telegramUserId: uid,
    group,
    code: code?.code ?? null,
    lockKey: code?.code ?? `linked:${uid}:${group?.id ?? 'me'}`,
    payload: p,
    requestId,
    opts,
    inFlightMessage: L.inFlight,
  });
}
