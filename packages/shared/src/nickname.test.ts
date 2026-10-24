import { describe, expect, it } from 'vitest';
import { parseNickname } from './nickname.ts';

describe('parseNickname', () => {
  it('accepts simple names and trims', () => {
    expect(parseNickname('  Max ')).toBe('Max');
    expect(parseNickname('Nova 2.0')).toBe('Nova 2.0');
    expect(parseNickname("Professor O'Brien")).toBe("Professor O'Brien");
    expect(parseNickname('Zoë')).toBe('Zoë');
  });
  it('collapses inner whitespace', () => {
    expect(parseNickname('Big   Max')).toBe('Big Max');
  });
  it('rejects empty, too long, and odd characters', () => {
    expect(parseNickname('   ')).toBeNull();
    expect(parseNickname('a'.repeat(21))).toBeNull();
    expect(parseNickname('a'.repeat(20))).toBe('a'.repeat(20));
    expect(parseNickname('<b>Max</b>')).toBeNull();
    expect(parseNickname('Max\nNova')).toBe('Max Nova');
    expect(parseNickname('@admin')).toBeNull();
    expect(parseNickname('...')).toBeNull();
  });
});
