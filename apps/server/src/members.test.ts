import { describe, expect, it } from 'vitest';
import { MEMBER_COLORS } from '@groupie/shared';
import { nextColor } from './members.ts';

describe('nextColor', () => {
  it('assigns in palette order and fills gaps', () => {
    expect(nextColor([])).toBe(MEMBER_COLORS[0].hex);
    expect(nextColor([MEMBER_COLORS[0].hex])).toBe(MEMBER_COLORS[1].hex);
    expect(nextColor([MEMBER_COLORS[1].hex])).toBe(MEMBER_COLORS[0].hex);
  });
  it('wraps when the palette is used up', () => {
    expect(nextColor(MEMBER_COLORS.map((c) => c.hex))).toBe(MEMBER_COLORS[0].hex);
  });
});
