import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from './llm.ts';

vi.mock('./llm.ts', () => ({
  talk: vi.fn(async (messages: ChatMessage[]) => `ANSWER\n${messages.map((m) => m.content).join('\n')}`),
}));

import { talk } from './llm.ts';
import { chatTurn, rememberedLine } from './agent.ts';
import { getMemberByTgUser } from './members.ts';
import { listMemory, parseMemoryIntent } from './memory.ts';
import { buildContext, renderContext } from './contextPolicy.ts';
import { buildQaMessages } from './bot/qa.ts';
import { AVA, DIVYAM, G, now, PRIVATE, seed, text } from './policy.fixture.ts';

const talkMock = vi.mocked(talk);
beforeAll(seed);
afterEach(() => talkMock.mockClear());

describe('parseMemoryIntent', () => {
  it('detects remember intents with a short key and the fact as value', () => {
    expect(parseMemoryIntent('remember I work Tuesday and Thursday nights')).toEqual({
      kind: 'remember',
      key: 'work schedule',
      value: 'I work Tuesday and Thursday nights',
    });
    expect(parseMemoryIntent("note that I can't meet before 10am.")).toEqual({ kind: 'remember', key: 'availability', value: "I can't meet before 10am" });
    expect(parseMemoryIntent("don't forget I prefer writing over slides")).toMatchObject({ kind: 'remember', key: 'preference' });
    expect(parseMemoryIntent('Keep in mind that my lab ends at 4')).toMatchObject({ kind: 'remember', key: 'classes', value: 'my lab ends at 4' });
    expect(parseMemoryIntent('remember: the dog is named Kiwi')).toMatchObject({ kind: 'remember', value: 'the dog is named Kiwi' });
  });
  it('detects forget intents', () => {
    expect(parseMemoryIntent('forget about my work schedule')).toEqual({ kind: 'forget', needle: 'my work schedule' });
    expect(parseMemoryIntent('forget that I cannot meet early.')).toEqual({ kind: 'forget', needle: 'I cannot meet early' });
  });
  it('ignores ordinary messages and questions', () => {
    for (const t of ['what should I do first?', 'do you remember when we meet?', 'remember when the quiz is?', 'note to self: lol', 'remember', 'I forgot my laptop']) {
      expect(parseMemoryIntent(t)).toBeNull();
    }
  });
});

describe('private chat memory', () => {
  const divyam = () => getMemberByTgUser(G, DIVYAM)!;

  it('saves "remember ..." as a private chat fact without calling the model', async () => {
    const { reply } = await chatTurn(divyam(), G, 'remember I work Tuesday and Thursday nights MARK_TUE', now);
    expect(reply.content).toBe(rememberedLine('Motu'));
    expect(reply.content).toBe("Got it, I'll remember that. Only you can see it; you can share it with the group from What Motu remembers.");
    expect(talkMock).not.toHaveBeenCalled();
    const row = listMemory(DIVYAM).find((r) => r.value.includes('MARK_TUE'))!;
    expect(row).toMatchObject({ key: 'work schedule', source: 'chat', visibility: 'private', groupChatId: null });
  });

  it('the fact shows up in the asker next private context only', async () => {
    await chatTurn(divyam(), G, 'what do you know about me?', now);
    const sent = text(talkMock.mock.calls[0]![0]);
    expect(sent).toContain('MARK_TUE');
    for (const s of PRIVATE[DIVYAM]!) expect(sent).toContain(s);
    for (const s of [...PRIVATE[AVA]!]) expect(sent).not.toContain(s);
    // History from the same member is included; the remember turn is in it.
    expect(sent).toContain(rememberedLine('Motu'));
    // Not in Ava's private context, not in any group answer.
    expect(renderContext(buildContext({ askerId: AVA, groupChatId: G, mode: 'private', now }))).not.toContain('MARK_TUE');
    for (const asker of [DIVYAM, AVA]) {
      expect(text(buildQaMessages(buildContext({ askerId: asker, groupChatId: G, mode: 'group', now }), 'what does Divyam do on Tuesday?'))).not.toContain('MARK_TUE');
    }
  });

  it('"forget ..." deletes matching rows of the asker only', async () => {
    const ava = getMemberByTgUser(G, AVA)!;
    await chatTurn(ava, G, 'remember I work Tuesday nights at the AVA_CAFE', now);
    const { reply } = await chatTurn(divyam(), G, 'forget my work schedule', now);
    expect(reply.content).toMatch(/^Done, I forgot/);
    expect(listMemory(DIVYAM).some((r) => r.value.includes('MARK_TUE'))).toBe(false);
    expect(listMemory(AVA).some((r) => r.value.includes('AVA_CAFE'))).toBe(true);
    const none = await chatTurn(divyam(), G, 'forget zebras', now);
    expect(none.reply.content).toContain("couldn't find");
    expect(talkMock).not.toHaveBeenCalled();
  });
});
