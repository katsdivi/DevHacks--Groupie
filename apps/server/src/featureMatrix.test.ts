import { describe, expect, it } from 'vitest';
import { botModeOf, featureMatrix, formatFeatureMatrix } from './featureMatrix.ts';

const feedKey = Buffer.alloc(32, 7).toString('base64');
const full = {
  BOT_TOKEN: '123:secret-bot-token',
  BOT_MODE: 'polling',
  GROQ_API_KEY: 'gsk_secret-groq',
  PUBLIC_URL: 'https://example.trycloudflare.com',
  WEBHOOK_SECRET: 'secret-webhook',
  LINK_SIGNING_SECRET: 'secret-link',
  CUBBIE_PUBLIC_SIGNING_KEY: 'secret-public-key',
  FEED_ENCRYPTION_KEY: feedKey,
  GOOGLE_CLIENT_ID: 'secret-gid',
  GOOGLE_CLIENT_SECRET: 'secret-gsecret',
  GOOGLE_REFRESH_TOKEN: 'secret-refresh',
  GOOGLE_USER_CLIENT_ID: 'secret-uid',
  GOOGLE_USER_CLIENT_SECRET: 'secret-usecret',
  CUBBIE_HANDLE: 'cubbie@example.com',
  DEMO_MODE: 'true',
};
const on = (vars: Record<string, string>) => Object.fromEntries(featureMatrix(vars).map((r) => [r.feature, r.on]));

describe('featureMatrix', () => {
  it('turns everything on with a full config', () => {
    expect(Object.values(on(full)).every(Boolean)).toBe(true);
  });

  it('turns everything off with an empty config and gives each a fix', () => {
    const rows = featureMatrix({});
    expect(rows.every((r) => !r.on && r.fix)).toBe(true);
  });

  it('treats an empty BOT_MODE like an unset one', () => {
    expect(botModeOf({ BOT_MODE: '' })).toBe('off');
    expect(botModeOf({ BOT_MODE: '', NODE_ENV: 'production' })).toBe('webhook');
    expect(on({ ...full, BOT_MODE: '' })['Telegram bot']).toBe(false);
  });

  it('needs https for the Mini App and webhook mode', () => {
    const vars = { ...full, BOT_MODE: 'webhook', PUBLIC_URL: 'http://localhost:3000' };
    expect(on(vars)['Mini App']).toBe(false);
    expect(on(vars)['Telegram bot']).toBe(false);
    expect(on(vars)['Per-user Google calendar']).toBe(true);
  });

  it('rejects a feed key that is not 32 bytes, which also disables per-user Google', () => {
    const vars = { ...full, FEED_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') };
    expect(on(vars)['Canvas and calendar feeds']).toBe(false);
    expect(on(vars)['Per-user Google calendar']).toBe(false);
  });

  it('needs all three team Google vars', () => {
    expect(on({ ...full, GOOGLE_REFRESH_TOKEN: '' })['Google team calendar']).toBe(false);
  });

  it('never prints a value', () => {
    for (const vars of [full, { ...full, BOT_MODE: 'webhook', PUBLIC_URL: '' }, { BOT_TOKEN: full.BOT_TOKEN }]) {
      const text = formatFeatureMatrix(featureMatrix(vars), true).join('\n');
      for (const [name, value] of Object.entries(vars)) {
        if (!value || name === 'BOT_MODE' || name === 'DEMO_MODE') continue;
        expect(text).not.toContain(value);
      }
    }
  });
});
