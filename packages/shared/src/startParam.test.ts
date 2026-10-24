import { describe, expect, it } from 'vitest';
import { decodeStartParam, encodeStartParam } from './startParam.ts';

describe('start param', () => {
  it('round trips supergroup ids', () => {
    const p = encodeStartParam(-1001234567890, 'avail');
    expect(p).toBe('g1001234567890_avail');
    expect(p.length).toBeLessThanOrEqual(64);
    expect(decodeStartParam(p)).toEqual({ groupId: -1001234567890, screen: 'avail' });
  });
  it('falls back to home for unknown screens and rejects junk', () => {
    expect(decodeStartParam('g42_nope')).toEqual({ groupId: -42, screen: 'home' });
    expect(decodeStartParam('hello')).toBeNull();
    expect(decodeStartParam(undefined)).toBeNull();
  });
});
