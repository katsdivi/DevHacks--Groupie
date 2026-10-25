import { and, eq } from 'drizzle-orm';
import type { MemoryItem } from '@groupie/shared';
import { db, schema } from './db/index.ts';
import type { UserMemory } from './db/schema.ts';

/**
 * Personal memory (user_memory). Every helper takes the verified Telegram user id of the owner and
 * only ever reads or writes that owner's rows. A row id that belongs to someone else behaves like a
 * missing row, so callers can answer 404 without revealing that it exists.
 */

const { userMemory } = schema;
const KEY_MAX = 60;
const VALUE_MAX = 300;

export const memoryDto = (r: UserMemory): MemoryItem => ({
  id: r.id,
  key: r.key,
  value: r.value,
  source: r.source,
  visibility: r.visibility,
  group_chat_id: r.visibility === 'group' ? r.groupChatId : null,
  updated_at: r.updatedAt,
});

/** The owner's rows, oldest first. */
export function listMemory(ownerId: number): UserMemory[] {
  return db.select().from(userMemory).where(eq(userMemory.telegramUserId, ownerId)).orderBy(userMemory.id).all();
}

/** One row, only if `ownerId` owns it. */
export function getOwnMemory(ownerId: number, id: number): UserMemory | undefined {
  if (!Number.isInteger(id)) return undefined;
  return db.select().from(userMemory).where(and(eq(userMemory.id, id), eq(userMemory.telegramUserId, ownerId))).get();
}

export type NewMemory = {
  key: string;
  value: string;
  source: 'chat' | 'mini_app';
  visibility?: 'private' | 'group';
  groupChatId?: number | null;
};

export function createMemory(ownerId: number, m: NewMemory): UserMemory {
  const visibility = m.visibility ?? 'private';
  return db
    .insert(userMemory)
    .values({
      telegramUserId: ownerId,
      key: m.key.slice(0, KEY_MAX),
      value: m.value.slice(0, VALUE_MAX),
      source: m.source,
      visibility,
      groupChatId: visibility === 'group' ? (m.groupChatId ?? null) : null,
      updatedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

export type MemoryPatch = { value?: string; visibility?: 'private' | 'group'; groupChatId?: number | null };

/** Updates the owner's row. Private rows never keep a group id. Undefined when not theirs. */
export function updateMemory(ownerId: number, id: number, patch: MemoryPatch): UserMemory | undefined {
  const row = getOwnMemory(ownerId, id);
  if (!row) return undefined;
  const visibility = patch.visibility ?? row.visibility;
  const groupChatId = visibility === 'group' ? (patch.groupChatId ?? row.groupChatId) : null;
  return db
    .update(userMemory)
    .set({
      value: patch.value === undefined ? row.value : patch.value.slice(0, VALUE_MAX),
      visibility,
      groupChatId,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(userMemory.id, id), eq(userMemory.telegramUserId, ownerId)))
    .returning()
    .get();
}

/** Deletes the owner's row. False when not theirs. */
export function deleteMemory(ownerId: number, id: number): boolean {
  if (!getOwnMemory(ownerId, id)) return false;
  db.delete(userMemory).where(and(eq(userMemory.id, id), eq(userMemory.telegramUserId, ownerId))).run();
  return true;
}

const STOP = new Set(['the', 'a', 'an', 'that', 'my', 'i', 'me', 'about', 'to', 'of', 'on', 'in', 'and', 'or', 'is', 'am', 'are', 'it', 'what', 'thing']);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));

/**
 * Deletes the owner's rows whose key or value matches `needle`: the whole phrase as a substring,
 * or every meaningful word of it. Returns the deleted rows. Never touches anyone else's rows.
 */
export function forgetMatching(ownerId: number, needle: string): UserMemory[] {
  const phrase = needle.trim().toLowerCase();
  const want = words(phrase);
  if (!phrase || !want.length) return [];
  const hits = listMemory(ownerId).filter((r) => {
    const hay = `${r.key} ${r.value}`.toLowerCase();
    if (hay.includes(phrase)) return true;
    const have = new Set(words(hay));
    return want.every((w) => have.has(w) || [...have].some((h) => h.startsWith(w) || w.startsWith(h)));
  });
  for (const r of hits) deleteMemory(ownerId, r.id);
  return hits;
}

export type MemoryIntent = { kind: 'remember'; key: string; value: string } | { kind: 'forget'; needle: string };

const REMEMBER = /^\s*(?:please\s+)?(?:remember|note|don'?t\s+forget|do\s+not\s+forget|keep\s+in\s+mind)\b(?:\s+that\b)?[\s,:]*(.*)$/is;
const FORGET = /^\s*(?:please\s+)?forget\b(?:\s+about)?(?:\s+that\b)?[\s,:]*(.*)$/is;

/** Labels for common facts; the first matching rule wins, else the first few words of the fact. */
const KEY_RULES: [RegExp, string][] = [
  [/\b(work|works|working|shift|shifts|job)\b/i, 'work schedule'],
  [/\b(meet|meeting|available|availability|free|busy|before|after)\b/i, 'availability'],
  [/\b(prefer|like|love|hate|rather)\b/i, 'preference'],
  [/\b(class|classes|course|courses|lab|exam|exams|quiz)\b/i, 'classes'],
];

function keyFor(value: string): string {
  for (const [re, key] of KEY_RULES) if (re.test(value)) return key;
  return value.split(/\s+/).slice(0, 4).join(' ').replace(/[.,!?;:]+$/, '').toLowerCase().slice(0, KEY_MAX) || 'note';
}

/**
 * Deterministic memory intent for the private chat. "remember I work Tuesday nights", "note that I
 * can't meet before 10am", "don't forget ...", "keep in mind ..." save; "forget <x>" deletes.
 * "note" alone needs "that" after it so ordinary sentences starting with "note" are not saved.
 */
export function parseMemoryIntent(text: string): MemoryIntent | null {
  const forget = FORGET.exec(text);
  if (forget) {
    const needle = forget[1]!.trim().replace(/[.!?]+$/, '');
    return needle ? { kind: 'forget', needle } : null;
  }
  if (/^\s*(?:please\s+)?note\b/i.test(text) && !/^\s*(?:please\s+)?note\s+that\b/i.test(text)) return null;
  const m = REMEMBER.exec(text);
  if (!m) return null;
  const value = m[1]!.trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
  if (!value || value.endsWith('?')) return null;
  return { kind: 'remember', key: keyFor(value), value: value.slice(0, VALUE_MAX) };
}
