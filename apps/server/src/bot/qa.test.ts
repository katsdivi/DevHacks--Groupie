import { describe, expect, it } from 'vitest';
import { addressedQuestion } from './qa.ts';

describe('addressedQuestion', () => {
  const ask = (t: string, reply = false) => addressedQuestion(t, 'Max', 'CubbieGroupieBot', reply);
  it('picks up the nickname at the start', () => {
    expect(ask("Max, what's due?")).toBe("what's due?");
    expect(ask('max: who is stuck')).toBe('who is stuck');
    expect(ask('MAX when do we meet')).toBe('when do we meet');
    expect(ask('Max?')).toBe('?');
    expect(ask('hey Max, help')).toBe('help');
    expect(ask('Max')).toBe('hi');
  });
  it('picks up @mentions and replies to the bot', () => {
    expect(ask('@CubbieGroupieBot what is left')).toBe('what is left');
    expect(ask('so what now', true)).toBe('so what now');
  });
  it('ignores other messages', () => {
    expect(ask('Maxwell said hi')).toBeNull();
    expect(ask('I told Max already')).toBeNull();
    expect(ask('lol')).toBeNull();
  });
  it('handles nicknames with regex characters', () => {
    expect(addressedQuestion('Dr. Who? are we done', 'Dr. Who?', 'Bot', false)).toBe('are we done');
  });
});

import { cleanReply } from '../llm.ts';

describe('cleanReply', () => {
  it('removes dashes used as punctuation and curly quotes', () => {
    expect(cleanReply('Due Nov 20 – 27 days left. It’s “fine”—really')).toBe('Due Nov 20, 27 days left. It\'s "fine", really');
    expect(cleanReply('<think>hmm</think> Hi')).toBe('Hi');
    expect(cleanReply('Meet 4–5 PM')).toBe('Meet 4 to 5 PM');
  });
});
