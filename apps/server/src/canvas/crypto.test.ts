import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { PAIR_CODE_ALPHABET, PairCodeString, normalizeFeedUrl } from '@groupie/shared';
import { env } from '../env.ts';
import { decryptSecret, encryptSecret, feedKey, signBody, verifySignature } from './crypto.ts';
import { REDACTED, redactFeedUrl, safeErrorMessage } from './feeds.ts';
import { randomCode } from './pairCodes.ts';

const FEED = 'https://canvas.asu.edu/feeds/calendars/user_abcDEF123secret.ics';

afterEach(() => {
  env.feedEncryptionKey = '';
});

describe('feed encryption', () => {
  it('round trips with AES-256-GCM and hides the plaintext', () => {
    env.feedEncryptionKey = randomBytes(32).toString('base64');
    const stored = encryptSecret(FEED);
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain('user_abc');
    expect(decryptSecret(stored)).toBe(FEED);
    expect(encryptSecret(FEED)).not.toBe(stored); // fresh IV each time
  });
  it('fails with a different key or tampered data', () => {
    env.feedEncryptionKey = randomBytes(32).toString('base64');
    const stored = encryptSecret(FEED);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
    const buf = Buffer.from(stored.slice(3), 'base64');
    buf[buf.length - 1] ^= 1;
    expect(() => decryptSecret(`v1:${buf.toString('base64')}`)).toThrow();
  });
  it('refuses a missing or wrong length key', () => {
    expect(feedKey()).toBeNull();
    expect(() => encryptSecret(FEED)).toThrow(/FEED_ENCRYPTION_KEY/);
    env.feedEncryptionKey = randomBytes(16).toString('base64');
    expect(feedKey()).toBeNull();
  });
});

describe('signatures', () => {
  it('accepts the right HMAC and rejects anything else', () => {
    const body = Buffer.from('{"a":1}');
    expect(verifySignature('s3cret', body, signBody('s3cret', body))).toBe(true);
    expect(verifySignature('s3cret', body, signBody('other', body))).toBe(false);
    expect(verifySignature('s3cret', body, undefined)).toBe(false);
    expect(verifySignature('s3cret', body, 'sha256=abc')).toBe(false);
    expect(verifySignature('s3cret', Buffer.from('{"a":2}'), signBody('s3cret', body))).toBe(false);
  });
});

describe('feed URL rules', () => {
  it('accepts ASU Canvas feeds and rewrites webcal', () => {
    expect(normalizeFeedUrl(` ${FEED} `)).toBe(FEED);
    expect(normalizeFeedUrl(FEED.replace('https://', 'webcal://'))).toBe(FEED);
  });
  it('rejects other hosts, paths, and schemes', () => {
    expect(normalizeFeedUrl('https://evil.example/feeds/x.ics')).toBeNull();
    expect(normalizeFeedUrl('https://canvas.asu.edu.evil.example/feeds/x.ics')).toBeNull();
    expect(normalizeFeedUrl('https://canvas.asu.edu/courses/1')).toBeNull();
    expect(normalizeFeedUrl('http://canvas.asu.edu/feeds/x.ics')).toBeNull();
    expect(normalizeFeedUrl('not a url')).toBeNull();
  });
});

describe('redactFeedUrl', () => {
  it('strips the URL, its path, host, and anything feed shaped', () => {
    const msg = `fetch ${FEED} failed; getaddrinfo ENOTFOUND canvas.asu.edu; path /feeds/calendars/user_abcDEF123secret.ics`;
    const out = redactFeedUrl(msg, FEED);
    expect(out).not.toContain('user_abc');
    expect(out).not.toContain('canvas.asu.edu');
    expect(out).toContain(REDACTED);
    expect(redactFeedUrl(`see webcal://canvas.asu.edu/feeds/x.ics now`)).toBe(`see ${REDACTED} now`);
    expect(redactFeedUrl('plain error')).toBe('plain error');
  });
  it('makes error messages safe, including timeouts', () => {
    const err = Object.assign(new Error(`bad ${FEED}`), { cause: { code: 'ECONNRESET' } });
    expect(safeErrorMessage(err, FEED)).toBe(`bad ${REDACTED} (ECONNRESET)`);
    expect(safeErrorMessage(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('Timed out reaching Canvas');
  });
});

describe('pair codes', () => {
  it('uses only the no-lookalike alphabet and passes the contract regex', () => {
    for (let i = 0; i < 200; i++) {
      const c = randomCode();
      expect([...c].every((ch) => PAIR_CODE_ALPHABET.includes(ch))).toBe(true);
      expect(PairCodeString.parse(c)).toBe(c);
    }
  });
});
