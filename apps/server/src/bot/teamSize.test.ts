import { describe, expect, it } from 'vitest';
import { sizeKeyboard, TEAM_SIZES } from './index.ts';

const labels = (here: number | null) => sizeKeyboard(here).inline_keyboard.flat().map((b) => b.text);

describe('team size buttons', () => {
  it('always offers 2 (a two-person team) up to 6', () => {
    expect(labels(null)).toEqual(['2', '3', '4', '5', '6']);
    expect(TEAM_SIZES).toContain(2);
  });
  it('puts the real head count first and does not repeat it', () => {
    expect(labels(2)).toEqual(['2 (everyone here)', '3', '4', '5', '6']);
    expect(labels(4)).toEqual(['4 (everyone here)', '2', '3', '5', '6']);
  });
  it('adds a bigger real head count and ignores odd ones', () => {
    expect(labels(7)).toEqual(['7 (everyone here)', '2', '3', '4', '5', '6']);
    expect(labels(1)).toEqual(['2', '3', '4', '5', '6']);
    expect(labels(40)).toEqual(['2', '3', '4', '5', '6']);
  });
});
