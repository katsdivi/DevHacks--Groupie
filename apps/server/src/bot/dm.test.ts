import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../llm.ts';

vi.mock('../llm.ts', () => ({
  talk: vi.fn(async (messages: ChatMessage[]) => `ANSWER ${messages.length}`),
}));

import { talk } from '../llm.ts';
import { answerDm } from './dm.ts';
import { db, schema } from '../db/index.ts';
import { loadDm } from '../dmHistory.ts';
import { listMemory } from '../memory.ts';
import { ALL_PRIVATE, AVA, BEN, DIVYAM, now, PRIVATE, seed, text } from '../policy.fixture.ts';

const talkMock = vi.mocked(talk);
const lastSent = () => text(talkMock.mock.calls.at(-1)![0]);
beforeAll(seed);
afterEach(() => {
  talkMock.mockClear();
  db.delete(schema.dmMessages).run();
});

describe('DM conversations', () => {
  it('a stranger with no groups still gets a warm reply that explains what Groupie does', async () => {
    const reply = await answerDm(4242, 'hi', now);
    expect(reply).toBe('ANSWER 2');
    const sent = lastSent();
    expect(sent).toContain('not in any project group');
    expect(sent).toContain('/canvas');
    for (const s of ALL_PRIVATE) expect(sent).not.toContain(s);
  });

  it('a user in several groups gets their private rows once plus each group, nobody else private rows', async () => {
    await answerDm(AVA, 'hi', now);
    const sent = lastSent();
    expect(sent).toMatch(/GROUP \d: CSE squad/);
    expect(sent).toMatch(/GROUP \d: Other squad/);
    for (const s of PRIVATE[AVA]!) expect(sent.split(s).length - 1).toBe(1);
    for (const s of [...PRIVATE[DIVYAM]!, ...PRIVATE[BEN]!]) expect(sent).not.toContain(s);
    // Shared rows show only in the section of the group they were shared with.
    const sections = sent.split(/\nGROUP \d: /).slice(1);
    const other = sections.find((x) => x.startsWith('Other squad'))!;
    const cse = sections.find((x) => x.startsWith('CSE squad'))!;
    expect(other).toContain('BEN_SHARED_ELSEWHERE');
    expect(other).not.toContain('DIVYAM_SHARED_HERE');
    expect(cse).toContain('DIVYAM_SHARED_HERE');
    expect(cse).not.toContain('BEN_SHARED_ELSEWHERE');
  });

  it('keeps a short per-user history', async () => {
    await answerDm(DIVYAM, 'first', now);
    await answerDm(DIVYAM, 'second', now);
    expect(talkMock.mock.calls.at(-1)![0].map((m) => m.content).slice(1)).toEqual(['first', 'ANSWER 2', 'second']);
    expect(loadDm(BEN)).toEqual([]);
    for (let i = 0; i < 20; i++) await answerDm(DIVYAM, `m${i}`, now);
    expect(loadDm(DIVYAM)).toHaveLength(12);
    // The model sees the system prompt, the last 12 stored messages, and the new one.
    await answerDm(DIVYAM, 'latest', now);
    const sent = talkMock.mock.calls.at(-1)![0];
    expect(sent).toHaveLength(14);
    expect(sent.at(-2)!.content).toBe('ANSWER 14');
    expect(sent.at(-3)!.content).toBe('m19');
  });

  it('saves "remember ..." from a DM to the sender only, without the model', async () => {
    const reply = await answerDm(BEN, 'remember I take the 8am bus DM_BUS', now);
    expect(reply).toContain("Got it, I'll remember that.");
    expect(talkMock).not.toHaveBeenCalled();
    expect(listMemory(BEN).find((r) => r.value.includes('DM_BUS'))).toMatchObject({ visibility: 'private', source: 'chat' });
    expect(listMemory(AVA).some((r) => r.value.includes('DM_BUS'))).toBe(false);
  });

  it("another user's DM history never reaches this user's turn", async () => {
    await answerDm(BEN, 'BEN_DM_MARKER_ONE', now);
    await answerDm(BEN, 'BEN_DM_MARKER_TWO', now);
    await answerDm(AVA, 'AVA_DM_MARKER', now);
    talkMock.mockClear();
    await answerDm(AVA, 'what did I say?', now);
    const sent = lastSent();
    expect(sent).toContain('AVA_DM_MARKER');
    expect(sent).not.toContain('BEN_DM_MARKER');
    expect(loadDm(AVA).map((m) => m.content).join('\n')).not.toContain('BEN_DM_MARKER');
  });

  it('stores memory-intent turns too', async () => {
    await answerDm(BEN, 'remember I like DM_TEA', now);
    expect(loadDm(BEN).map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});
