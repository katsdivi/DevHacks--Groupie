import { db, schema } from './db/index.ts';
import { upsertMember } from './members.ts';

/**
 * Test fixture for the privacy tests: one group with three members, a second group, and unique
 * marker strings for every row so a leak is a plain substring match.
 */
export const G = -950001;
export const OTHER_G = -950002;
export const DIVYAM = 2001;
export const AVA = 2002;
export const BEN = 2003;
export const now = new Date('2026-10-26T15:00:00Z');

/** Rows that must never reach a group message (private, other courses, other groups). */
export const PRIVATE: Record<number, string[]> = {
  [DIVYAM]: ['DIVYAM_PRIV_SHIFT', 'DIVYAM_HST_ESSAY'],
  [AVA]: ['AVA_PRIV_SHIFT', 'AVA_BIO_LAB'],
  [BEN]: ['BEN_PRIV_SHIFT', 'BEN_MAT_QUIZ'],
};
export const ELSEWHERE = ['AVA_SHARED_ELSEWHERE', 'BEN_SHARED_ELSEWHERE'];
/** Rows shared with G, fine in G only. */
export const SHARED_HERE = ['DIVYAM_SHARED_HERE', 'AVA_SHARED_HERE', 'AVA_CSE_QUIZ'];
export const ALL_PRIVATE = Object.values(PRIVATE).flat();

const mem = (telegramUserId: number, key: string, value: string, visibility: 'private' | 'group', groupChatId: number | null) =>
  db.insert(schema.userMemory).values({ telegramUserId, key, value, source: 'chat', visibility, groupChatId, updatedAt: 'x' }).run();
const ev = (telegramUserId: number, uid: string, course: string, title: string) =>
  db.insert(schema.calendarEvents).values({ telegramUserId, uid, course, title, dueAt: '2026-10-28T06:59:00Z', kind: 'assignment', updatedAt: 'x' }).run();

export function seed() {
  for (const [id, title] of [[G, 'CSE squad'], [OTHER_G, 'Other squad']] as const) {
    db.insert(schema.groups)
      .values({ id, title, nickname: 'Motu', teamSize: 3, status: 'active', tz: 'America/Phoenix', canvasCourse: 'CSE 340: Software Engineering', createdAt: 'x' })
      .run();
  }
  upsertMember(G, DIVYAM, { name: 'Divyam', skills: ['coding'], weak_areas: [] });
  upsertMember(G, AVA, { name: 'Ava', skills: ['writing'], weak_areas: [] });
  upsertMember(G, BEN, { name: 'Ben', skills: ['presenting'], weak_areas: [] });
  upsertMember(OTHER_G, AVA, { name: 'Ava', skills: ['writing'], weak_areas: [] });
  upsertMember(OTHER_G, BEN, { name: 'Ben', skills: ['presenting'], weak_areas: [] });
  for (const id of [DIVYAM, AVA, BEN]) mem(id, 'job', PRIVATE[id]![0]!, 'private', null);
  mem(DIVYAM, 'focus', 'DIVYAM_SHARED_HERE', 'group', G);
  mem(AVA, 'busy', 'AVA_SHARED_HERE', 'group', G);
  mem(AVA, 'busy', 'AVA_SHARED_ELSEWHERE', 'group', OTHER_G);
  mem(BEN, 'busy', 'BEN_SHARED_ELSEWHERE', 'group', OTHER_G);
  ev(DIVYAM, 'd1', 'HST 101 (Fall 2026)', 'DIVYAM_HST_ESSAY');
  ev(AVA, 'a1', 'BIO 181 (Fall 2026)', 'AVA_BIO_LAB');
  ev(AVA, 'a2', 'CSE 340 (Fall 2026)', 'AVA_CSE_QUIZ');
  ev(BEN, 'b1', 'MAT 265 (Fall 2026)', 'BEN_MAT_QUIZ');
}

/** Every message content of an LLM call, joined. */
export const text = (messages: { content: string }[]) => messages.map((m) => m.content).join('\n');
