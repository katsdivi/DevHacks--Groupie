import { randomInt } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { PAIR_CODE_ALPHABET, PAIR_CODE_LENGTH, PAIR_CODE_TTL_MS, type ImportStatus, type PairCodeStatusResponse } from '@groupie/shared';
import { db, schema } from '../db/index.ts';

const { cubbiePairCodes, cubbieImports } = schema;

export type PairCode = typeof cubbiePairCodes.$inferSelect;
export type PairCodePurpose = PairCode['purpose'];

/** A random code from the no-lookalike alphabet. */
export function randomCode(): string {
  let out = '';
  for (let i = 0; i < PAIR_CODE_LENGTH; i++) out += PAIR_CODE_ALPHABET[randomInt(PAIR_CODE_ALPHABET.length)];
  return out;
}

/** Makes and stores a fresh single-use code. Retries on the (very rare) collision. */
export function createPairCode(
  telegramUserId: number,
  groupChatId: number | null,
  now = new Date(),
  gen = randomCode,
  purpose: PairCodePurpose = 'import',
): PairCode {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row: PairCode = {
      code: gen(),
      telegramUserId,
      groupChatId,
      expiresAt: new Date(now.getTime() + PAIR_CODE_TTL_MS).toISOString(),
      usedAt: null,
      createdAt: now.toISOString(),
      purpose,
    };
    try {
      db.insert(cubbiePairCodes).values(row).run();
      return row;
    } catch (err) {
      if ((err as { code?: string }).code !== 'SQLITE_CONSTRAINT_PRIMARYKEY') throw err;
    }
  }
  throw new Error('Could not make a unique pair code');
}

export const getPairCode = (code: string) => db.select().from(cubbiePairCodes).where(eq(cubbiePairCodes.code, code)).get();

/** Marks the code used. Returns false if another request got there first or it expired. Atomic. */
export function claimPairCode(code: string, now = new Date()): boolean {
  const iso = now.toISOString();
  const res = db
    .update(cubbiePairCodes)
    .set({ usedAt: iso })
    .where(and(eq(cubbiePairCodes.code, code), isNull(cubbiePairCodes.usedAt), gt(cubbiePairCodes.expiresAt, iso)))
    .run();
  return res.changes === 1;
}

export const latestImport = (code: string) =>
  db.select().from(cubbieImports).where(eq(cubbieImports.pairCode, code)).orderBy(desc(cubbieImports.id)).limit(1).get();

/** Live status for the Mini App. */
export function pairCodeStatus(pc: PairCode, now = new Date()): PairCodeStatusResponse {
  const imp = latestImport(pc.code);
  let status: ImportStatus;
  if (imp) status = imp.status;
  else if (pc.usedAt) status = 'received';
  else status = pc.expiresAt <= now.toISOString() ? 'expired' : 'waiting';
  const payload = imp?.payload as { assignment?: { title?: string } } | undefined;
  return {
    code: pc.code,
    status,
    expiresAt: pc.expiresAt,
    assignmentTitle: payload?.assignment?.title ?? null,
    error: imp?.error ?? null,
  };
}
