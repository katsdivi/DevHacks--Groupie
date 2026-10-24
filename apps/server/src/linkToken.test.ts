import { describe, expect, it } from 'vitest';
import { peekLinkToken } from '@groupie/shared';
import { signLinkToken, verifyLinkToken } from './linkToken.ts';

const SECRET = 'test-secret';

describe('link tokens', () => {
  it('round trips and can be peeked by the client', () => {
    const t = signLinkToken({ g: -5254546157, m: 3, n: 'Ava' }, SECRET, 60, 1000);
    expect(verifyLinkToken(t, SECRET, 1010)).toEqual({ g: -5254546157, m: 3, n: 'Ava', exp: 1060 });
    expect(peekLinkToken(t)).toMatchObject({ g: -5254546157, m: 3 });
  });
  it('rejects expired, tampered, and wrongly signed tokens', () => {
    const t = signLinkToken({ g: -1, m: 3, n: 'Ava' }, SECRET, 60, 1000);
    expect(verifyLinkToken(t, SECRET, 2000)).toBeNull();
    expect(verifyLinkToken(t, 'other', 1010)).toBeNull();
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ g: -1, m: 4, n: 'Eve', exp: 9999 })).toString('base64url');
    expect(verifyLinkToken(`${forged}.${sig}`, SECRET, 1010)).toBeNull();
    expect(verifyLinkToken(`${body}`, SECRET, 1010)).toBeNull();
    expect(verifyLinkToken('', SECRET, 1010)).toBeNull();
  });
});
