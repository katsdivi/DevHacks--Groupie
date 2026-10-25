import { describe, expect, it } from 'vitest';
import { assertDistinctSecrets } from './env.ts';

const base = {
  CUBBIE_PUBLIC_SIGNING_KEY: 'public-key-value',
  FEED_ENCRYPTION_KEY: 'feed-key-value',
  BOT_TOKEN: 'bot-token-value',
  WEBHOOK_SECRET: 'webhook-value',
  LINK_SIGNING_SECRET: 'link-value',
  GROQ_API_KEY: 'groq-value',
  GOOGLE_CLIENT_SECRET: 'google-secret-value',
  GOOGLE_REFRESH_TOKEN: 'google-refresh-value',
};

describe('assertDistinctSecrets', () => {
  it('passes when every secret is distinct', () => {
    expect(() => assertDistinctSecrets(base)).not.toThrow();
  });

  it('passes when the keys are empty, even if other values are empty too', () => {
    expect(() => assertDistinctSecrets({ ...base, CUBBIE_PUBLIC_SIGNING_KEY: '', FEED_ENCRYPTION_KEY: '', WEBHOOK_SECRET: '' })).not.toThrow();
    expect(() => assertDistinctSecrets({})).not.toThrow();
  });

  for (const other of ['FEED_ENCRYPTION_KEY', 'BOT_TOKEN', 'WEBHOOK_SECRET', 'LINK_SIGNING_SECRET', 'GROQ_API_KEY', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) {
    it(`refuses when the public signing key equals ${other}, naming variables but not the value`, () => {
      const vars = { ...base, [other]: base.CUBBIE_PUBLIC_SIGNING_KEY };
      expect(() => assertDistinctSecrets(vars)).toThrow(`CUBBIE_PUBLIC_SIGNING_KEY equals ${other}`);
      try {
        assertDistinctSecrets(vars);
      } catch (err) {
        expect((err as Error).message).not.toContain(base.CUBBIE_PUBLIC_SIGNING_KEY);
      }
    });
  }

  for (const other of ['BOT_TOKEN', 'WEBHOOK_SECRET', 'LINK_SIGNING_SECRET', 'GROQ_API_KEY', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) {
    it(`refuses when the feed key equals ${other}`, () => {
      const vars = { ...base, [other]: base.FEED_ENCRYPTION_KEY };
      expect(() => assertDistinctSecrets(vars)).toThrow(`FEED_ENCRYPTION_KEY equals ${other}`);
    });
  }
});
