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
  it('picks up greetings with the name at the start or the end', () => {
    expect(ask('hi Max')).toBe('hi');
    expect(ask('hey groupie')).toBe('hey');
    expect(ask('thanks Max')).toBe('thanks');
    expect(ask('thank you Max!')).toBe('thank you');
    expect(ask('ok Groupie')).toBe('ok');
    expect(ask('Groupie, what is due')).toBe('what is due');
    expect(ask('can you list what is left for the slides Max?')).toBe('can you list what is left for the slides');
    expect(ask('great work today everyone, thanks Groupie')).toBe('great work today everyone, thanks');
  });
  it('picks up the name anywhere in a short message (6 words or fewer)', () => {
    expect(ask('is Max still here?')).toBe('is Max still here?');
    expect(ask('I told Max already')).toBe('I told Max already');
    expect(ask('wait so groupie can do that')).toBe('wait so groupie can do that');
  });
  it('ignores other messages', () => {
    expect(ask('hi')).toBeNull();
    expect(ask('hey everyone')).toBeNull();
    expect(ask('Maxwell said hi')).toBeNull();
    expect(ask('Maxxx lol')).toBeNull();
    expect(ask('hi Maxine')).toBeNull();
    expect(ask('thanks Maximilian')).toBeNull();
    expect(ask('I told Max already about the slides for tomorrow')).toBeNull();
    expect(ask('the groupies were wild')).toBeNull();
    expect(ask('lol')).toBeNull();
  });
  it('never matches a nickname inside a longer word', () => {
    const motu = (t: string) => addressedQuestion(t, 'Motu', 'Bot', false);
    expect(motu('Motuuu')).toBeNull();
    expect(motu('hi motuuu')).toBeNull();
    expect(motu('Kamotu is here')).toBeNull();
    expect(motu('thanks Motu')).toBe('thanks');
    expect(motu('Motu')).toBe('hi');
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
