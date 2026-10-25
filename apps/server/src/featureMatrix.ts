// Which optional features this configuration turns on. Pure (takes the vars, imports nothing) so the
// server can log it at boot and scripts/doctor.mjs can print it from .env. Output names variables, never values.

export type FeatureRow = { feature: string; on: boolean; detail: string; fix: string };

type Vars = Record<string, string | undefined>;

/** Mirrors env.ts: an empty BOT_MODE falls back like an unset one. */
export const botModeOf = (vars: Vars) => vars.BOT_MODE || (vars.NODE_ENV === 'production' ? 'webhook' : 'off');

/** Mirrors canvas/crypto.ts feedKey(): 32 bytes once base64 decoded. */
export const isValidFeedKey = (value: string | undefined) => Boolean(value) && Buffer.from(value!, 'base64').length === 32;

const missing = (vars: Vars, names: string[]) => names.filter((n) => !vars[n]);

export function featureMatrix(vars: Vars): FeatureRow[] {
  const mode = botModeOf(vars);
  const https = (vars.PUBLIC_URL ?? '').startsWith('https://');
  const feedKey = isValidFeedKey(vars.FEED_ENCRYPTION_KEY);
  const rows: FeatureRow[] = [];

  if (!vars.BOT_TOKEN) {
    rows.push({ feature: 'Telegram bot', on: false, detail: 'no BOT_TOKEN', fix: 'Set BOT_TOKEN to a TEST bot from @BotFather (pnpm bootstrap).' });
  } else if (mode === 'off') {
    rows.push({ feature: 'Telegram bot', on: false, detail: 'BOT_MODE=off', fix: 'Set BOT_MODE=polling for a TEST bot that has no webhook (pnpm bootstrap checks this).' });
  } else if (mode === 'webhook' && (!https || !vars.WEBHOOK_SECRET)) {
    rows.push({ feature: 'Telegram bot', on: false, detail: 'webhook needs PUBLIC_URL (https) and WEBHOOK_SECRET', fix: 'Locally use BOT_MODE=polling with a TEST bot; webhook is for the deployed server.' });
  } else {
    rows.push({ feature: 'Telegram bot', on: true, detail: mode, fix: '' });
  }

  rows.push(
    vars.GROQ_API_KEY
      ? { feature: 'LLM (Groq)', on: true, detail: 'GROQ_API_KEY set', fix: '' }
      : { feature: 'LLM (Groq)', on: false, detail: 'no GROQ_API_KEY', fix: 'Create a key at https://console.groq.com/keys and set GROQ_API_KEY.' },
  );

  rows.push(
    https
      ? { feature: 'Mini App', on: true, detail: 'PUBLIC_URL is https', fix: '' }
      : {
          feature: 'Mini App',
          on: false,
          detail: 'PUBLIC_URL is not https',
          fix: 'Run pnpm start:local --tunnel and register the tunnel URL for the TEST bot Mini App in @BotFather.',
        },
  );

  rows.push(
    vars.CUBBIE_PUBLIC_SIGNING_KEY
      ? { feature: 'Canvas imports (Cubbie)', on: true, detail: 'CUBBIE_PUBLIC_SIGNING_KEY set', fix: '' }
      : { feature: 'Canvas imports (Cubbie)', on: false, detail: 'no CUBBIE_PUBLIC_SIGNING_KEY', fix: 'Set CUBBIE_PUBLIC_SIGNING_KEY (openssl rand -hex 32) or run pnpm bootstrap.' },
  );

  rows.push(
    feedKey
      ? { feature: 'Canvas and calendar feeds', on: true, detail: 'FEED_ENCRYPTION_KEY is 32 bytes', fix: '' }
      : {
          feature: 'Canvas and calendar feeds',
          on: false,
          detail: vars.FEED_ENCRYPTION_KEY ? 'FEED_ENCRYPTION_KEY is not 32 bytes of base64' : 'no FEED_ENCRYPTION_KEY',
          fix: 'Set FEED_ENCRYPTION_KEY (openssl rand -base64 32) or run pnpm bootstrap.',
        },
  );

  const team = missing(vars, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']);
  rows.push(
    team.length
      ? { feature: 'Google team calendar', on: false, detail: `missing ${team.join(', ')}`, fix: 'Optional. See README "Google Calendar"; pnpm google:auth fills GOOGLE_REFRESH_TOKEN.' }
      : { feature: 'Google team calendar', on: true, detail: 'all 3 vars set', fix: '' },
  );

  // Same conditions as googleUserAvailable() in googleUser.ts.
  const user = missing(vars, ['GOOGLE_USER_CLIENT_ID', 'GOOGLE_USER_CLIENT_SECRET', 'PUBLIC_URL', 'LINK_SIGNING_SECRET']);
  if (!feedKey) user.push('a valid FEED_ENCRYPTION_KEY');
  rows.push(
    user.length
      ? { feature: 'Per-user Google calendar', on: false, detail: `missing ${user.join(', ')}`, fix: 'Optional. See README "Personal calendars"; needs a Web OAuth client.' }
      : { feature: 'Per-user Google calendar', on: true, detail: 'configured', fix: '' },
  );

  rows.push(
    vars.CUBBIE_HANDLE
      ? { feature: 'Cubbie iMessage handle', on: true, detail: 'CUBBIE_HANDLE set', fix: '' }
      : { feature: 'Cubbie iMessage handle', on: false, detail: 'no CUBBIE_HANDLE', fix: 'Optional. Without it /go/cubbie offers Copy instead of Open in iMessage.' },
  );

  rows.push(
    vars.DEMO_MODE === 'true'
      ? { feature: 'Demo mode', on: true, detail: 'DEMO_MODE=true', fix: '' }
      : { feature: 'Demo mode', on: false, detail: 'DEMO_MODE not true', fix: 'Optional. DEMO_MODE=true caches LLM answers as a safety net for demos.' },
  );

  return rows;
}

/** One line per feature, for logs and the terminal. */
export function formatFeatureMatrix(rows: FeatureRow[], withFixes = false): string[] {
  const width = Math.max(...rows.map((r) => r.feature.length));
  return rows.flatMap((r) => {
    const line = `  ${r.on ? 'on ' : 'off'}  ${r.feature.padEnd(width)}  ${r.detail}`;
    return withFixes && r.fix ? [line, `       ${' '.repeat(width)}  fix: ${r.fix}`] : [line];
  });
}
