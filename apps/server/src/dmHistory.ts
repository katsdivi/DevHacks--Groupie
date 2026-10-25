import { and, desc, eq, lt } from 'drizzle-orm';
import { db, schema } from './db/index.ts';
import type { ContextBuckets } from './contextPolicy.ts';
import type { ChatMessage } from './llm.ts';

/**
 * Step 18: the bot DM conversation, stored per verified Telegram user id so it survives restarts.
 * Every function takes ONLY the verified id (ctx.from.id or tgUser(res).id), never a body field.
 */

const { dmMessages } = schema;

/** Rows kept per user. Older ones are trimmed on every append. */
export const DM_KEEP = 50;
/** Turns sent to the model by default. */
export const DM_LOAD = 12;

type Role = 'user' | 'assistant';

/** Saves one message for this user and trims their history to the newest DM_KEEP rows, atomically. */
export function appendDm(userId: number, role: Role, content: string): void {
  db.transaction((tx) => {
    tx.insert(dmMessages).values({ telegramUserId: userId, role, content, createdAt: new Date().toISOString() }).run();
    // The oldest row still kept; everything older for this user goes.
    const cutoff = tx
      .select({ id: dmMessages.id })
      .from(dmMessages)
      .where(eq(dmMessages.telegramUserId, userId))
      .orderBy(desc(dmMessages.id))
      .limit(1)
      .offset(DM_KEEP - 1)
      .get();
    if (cutoff) tx.delete(dmMessages).where(and(eq(dmMessages.telegramUserId, userId), lt(dmMessages.id, cutoff.id))).run();
  });
}

/** This user's newest `limit` messages, oldest first. Never anyone else's. */
export function loadDm(userId: number, limit = DM_LOAD): ChatMessage[] {
  return db
    .select({ role: dmMessages.role, content: dmMessages.content })
    .from(dmMessages)
    .where(eq(dmMessages.telegramUserId, userId))
    .orderBy(desc(dmMessages.id))
    .limit(limit)
    .all()
    .reverse();
}

/** Deletes this user's DM history. Returns how many rows went. */
export function clearDm(userId: number): number {
  return db.delete(dmMessages).where(eq(dmMessages.telegramUserId, userId)).run().changes;
}

/**
 * DM history for a prompt, under the same owner-only rule as contextPolicy: the buckets must belong
 * to the verified sender, and only that sender's rows load.
 */
export function dmHistoryForAsker(asker: ContextBuckets['asker'], verifiedUserId: number, limit = DM_LOAD): ChatMessage[] {
  if (asker.telegramUserId !== verifiedUserId) throw new Error('DM history is owner-only');
  return loadDm(verifiedUserId, limit);
}

/** "Clear my chat": the Telegram DM only. The Mini App, tasks, memory, and reminders stay. */
export function clearMyChat(userId: number): { dm: number } {
  return { dm: clearDm(userId) };
}
