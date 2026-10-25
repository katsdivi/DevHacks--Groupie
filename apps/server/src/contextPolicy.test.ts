import { beforeAll, describe, expect, it } from 'vitest';
import { db, schema } from './db/index.ts';
import { upsertMember } from './members.ts';
import { buildContext, renderContext } from './contextPolicy.ts';

const G = -900001;
const OTHER_G = -900002;
const ME = 1001;
const AVA = 1002;
const now = new Date('2026-10-26T15:00:00Z');
const mem = (telegramUserId: number, key: string, value: string, visibility: 'private' | 'group', groupChatId: number | null) =>
  db.insert(schema.userMemory).values({ telegramUserId, key, value, source: 'chat', visibility, groupChatId, updatedAt: 'x' }).run();
const ev = (telegramUserId: number, uid: string, course: string, title: string, dueAt: string) =>
  db.insert(schema.calendarEvents).values({ telegramUserId, uid, course, title, dueAt, kind: 'assignment', updatedAt: 'x' }).run();

beforeAll(() => {
  for (const [id, title] of [[G, 'CSE squad'], [OTHER_G, 'Other squad']] as const) {
    db.insert(schema.groups).values({ id, title, nickname: 'Motu', teamSize: 2, status: 'active', tz: 'America/Phoenix', canvasCourse: 'CSE 340: Software Engineering', createdAt: 'x' }).run();
  }
  upsertMember(G, ME, { name: 'Divyam', skills: ['coding'], weak_areas: [] });
  upsertMember(G, AVA, { name: 'Ava', skills: ['writing'], weak_areas: [] });
  mem(ME, 'job', 'MY_PRIVATE_SHIFT', 'private', null);
  mem(ME, 'focus', 'MY_SHARED_FOCUS', 'group', G);
  mem(AVA, 'job', 'AVA_PRIVATE_SHIFT', 'private', null);
  mem(AVA, 'busy', 'AVA_SHARED_HERE', 'group', G);
  mem(AVA, 'busy', 'AVA_SHARED_ELSEWHERE', 'group', OTHER_G);
  ev(ME, 'u1', 'CSE 340 (Fall 2026)', 'MY_CSE_HW', '2026-10-28T06:59:00Z');
  ev(ME, 'u2', 'HST 101 (Fall 2026)', 'MY_HST_ESSAY', '2026-10-28T06:59:00Z');
  ev(AVA, 'u3', 'CSE 340 (Fall 2026)', 'AVA_CSE_QUIZ', '2026-10-29T17:00:00Z');
  ev(AVA, 'u4', 'BIO 181 (Fall 2026)', 'AVA_BIO_LAB', '2026-10-29T17:00:00Z');
});

describe('buildContext policy', () => {
  it('group mode never loads private rows, not even the asker own', () => {
    const b = buildContext({ askerId: ME, groupChatId: G, mode: 'group', now });
    const text = JSON.stringify(b) + renderContext(b);
    for (const secret of ['MY_PRIVATE_SHIFT', 'MY_HST_ESSAY', 'AVA_PRIVATE_SHIFT', 'AVA_BIO_LAB', 'AVA_SHARED_ELSEWHERE']) {
      expect(text).not.toContain(secret);
    }
    for (const ok of ['MY_SHARED_FOCUS', 'AVA_SHARED_HERE', 'MY_CSE_HW', 'AVA_CSE_QUIZ']) expect(text).toContain(ok);
    expect(b.ownPrivate).toEqual({ profile: null, memory: [], calendarItems: [] });
  });
  it('private mode adds only the asker own private rows', () => {
    const b = buildContext({ askerId: ME, groupChatId: G, mode: 'private', now });
    const text = JSON.stringify(b) + renderContext(b);
    for (const ok of ['MY_PRIVATE_SHIFT', 'MY_HST_ESSAY']) expect(text).toContain(ok);
    for (const secret of ['AVA_PRIVATE_SHIFT', 'AVA_BIO_LAB', 'AVA_SHARED_ELSEWHERE']) expect(text).not.toContain(secret);
  });
  it('a non-member asker gets group facts but nobody private rows', () => {
    const b = buildContext({ askerId: 9999, groupChatId: G, mode: 'private', now });
    const text = JSON.stringify(b) + renderContext(b);
    for (const secret of ['MY_PRIVATE_SHIFT', 'AVA_PRIVATE_SHIFT', 'MY_HST_ESSAY', 'AVA_BIO_LAB']) expect(text).not.toContain(secret);
  });
});
