import { beforeEach, describe, expect, it } from 'vitest';
import { db, schema } from './db/index.ts';
import { appendDm, clearDm, clearMyChat, DM_KEEP, dmHistoryForAsker, loadDm } from './dmHistory.ts';
import { upsertMember } from './members.ts';

const A = 7201;
const B = 7202;
const G1 = -970001;
const G2 = -970002;

beforeEach(() => {
  db.delete(schema.dmMessages).run();
  db.delete(schema.agentMessages).run();
});

const contents = (userId: number, limit?: number) => loadDm(userId, limit).map((m) => m.content);

describe('dm history store', () => {
  it('loads oldest first, newest `limit` only, defaulting to 12', () => {
    for (let i = 0; i < 20; i++) appendDm(A, i % 2 ? 'assistant' : 'user', `a${i}`);
    expect(contents(A)).toEqual(Array.from({ length: 12 }, (_, i) => `a${i + 8}`));
    expect(contents(A, 3)).toEqual(['a17', 'a18', 'a19']);
    expect(loadDm(A, 1)[0]).toEqual({ role: 'assistant', content: 'a19' });
  });

  it('trims each user to the newest 50 rows, without touching anyone else', () => {
    for (let i = 0; i < 5; i++) appendDm(B, 'user', `b${i}`);
    for (let i = 0; i < 70; i++) appendDm(A, 'user', `a${i}`);
    const rows = db.select().from(schema.dmMessages).all();
    expect(rows.filter((r) => r.telegramUserId === A)).toHaveLength(DM_KEEP);
    expect(DM_KEEP).toBe(50);
    expect(contents(A, 100)[0]).toBe('a20');
    expect(contents(A, 100).at(-1)).toBe('a69');
    expect(contents(B, 100)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4']);
  });

  it("never loads another user's rows", () => {
    appendDm(A, 'user', 'A_MARKER');
    appendDm(B, 'user', 'B_MARKER');
    appendDm(B, 'assistant', 'B_REPLY_MARKER');
    expect(contents(A, 100)).toEqual(['A_MARKER']);
    expect(contents(A, 100).join()).not.toContain('B_');
  });

  it('the asker helper refuses buckets that are not the verified sender', () => {
    appendDm(B, 'user', 'B_MARKER');
    const askerB = { telegramUserId: B, memberId: null, name: null };
    expect(() => dmHistoryForAsker(askerB, A)).toThrow(/owner-only/);
    expect(dmHistoryForAsker(askerB, B).map((m) => m.content)).toEqual(['B_MARKER']);
  });

  it('clearDm clears only that user', () => {
    appendDm(A, 'user', 'x');
    appendDm(B, 'user', 'y');
    expect(clearDm(A)).toBe(1);
    expect(loadDm(A)).toEqual([]);
    expect(contents(B)).toEqual(['y']);
  });

  it('clearMyChat wipes only that user\'s Telegram DM and leaves Mini App chat alone', () => {
    for (const id of [G1, G2]) {
      db.insert(schema.groups).values({ id, title: 't', nickname: 'Motu', status: 'active', tz: 'America/Phoenix', createdAt: 'x' }).run();
    }
    const a1 = upsertMember(G1, A, { name: 'A', skills: [], weak_areas: [] });
    const a2 = upsertMember(G2, A, { name: 'A', skills: [], weak_areas: [] });
    const b1 = upsertMember(G1, B, { name: 'B', skills: [], weak_areas: [] });
    for (const m of [a1, a2, b1]) {
      db.insert(schema.agentMessages).values({ memberId: m.id, role: 'user', content: `m${m.id}`, createdAt: 'x' }).run();
    }
    appendDm(A, 'user', 'x');
    appendDm(B, 'user', 'y');
    expect(clearMyChat(A)).toEqual({ dm: 1 });
    const left = db.select().from(schema.agentMessages).all();
    expect(left.map((r) => r.memberId).sort()).toEqual([a1.id, a2.id, b1.id].sort());
    expect(contents(B)).toEqual(['y']);
  });
});
