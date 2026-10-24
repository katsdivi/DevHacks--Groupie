import { describe, expect, it } from 'vitest';
import { signInitData, validateInitData } from './initData.ts';

const TOKEN = '123456:TEST_TOKEN';
const user = { id: 42, first_name: 'Divyam', username: 'divyam' };
const now = 1_800_000_000;

function make(extra: Record<string, string> = {}, authDate = now) {
  return signInitData({ auth_date: String(authDate), user: JSON.stringify(user), query_id: 'AAA', ...extra }, TOKEN);
}

describe('validateInitData', () => {
  it('accepts correctly signed data', () => {
    expect(validateInitData(make(), TOKEN, now)).toEqual(user);
  });
  it('accepts data signed including a signature field', () => {
    expect(validateInitData(make({ signature: 'abc' }), TOKEN, now)).toEqual(user);
  });
  it('rejects a wrong token', () => {
    expect(validateInitData(make(), '999:OTHER', now)).toBeNull();
  });
  it('rejects tampered data', () => {
    const tampered = make().replace('Divyam', 'Mallory');
    expect(validateInitData(tampered, TOKEN, now)).toBeNull();
  });
  it('rejects data older than 24h', () => {
    expect(validateInitData(make({}, now - 25 * 3600), TOKEN, now)).toBeNull();
    expect(validateInitData(make({}, now - 23 * 3600), TOKEN, now)).toEqual(user);
  });
  it('rejects missing hash and garbage', () => {
    expect(validateInitData('', TOKEN, now)).toBeNull();
    expect(validateInitData('user=%7B%7D&hash=zz', TOKEN, now)).toBeNull();
  });
});
