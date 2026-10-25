const isProd = process.env.NODE_ENV === 'production';

export const env = {
  port: Number(process.env.PORT ?? 3000),
  isProd,
  devMode: process.env.DEV_MODE === 'true',
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  databasePath: process.env.DATABASE_PATH ?? './data/groupie.db',
  botToken: process.env.BOT_TOKEN ?? '',
  botUsername: process.env.BOT_USERNAME ?? 'CubbieGroupieBot',
  miniAppShortName: process.env.MINI_APP_SHORT_NAME ?? 'app',
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  groqApiKey: process.env.GROQ_API_KEY ?? '',
  parseModel: process.env.GROQ_PARSE_MODEL ?? 'openai/gpt-oss-120b',
  chatModel: process.env.GROQ_CHAT_MODEL ?? 'openai/gpt-oss-20b',
  fallbackModel: process.env.GROQ_FALLBACK_MODEL ?? 'qwen/qwen3.8-27b',
  linkSigningSecret: process.env.LINK_SIGNING_SECRET ?? '',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN ?? '',
  /**
   * Signs POST /api/cubbie/import. Public by design: Cubbie cannot host team keys, so this value ships
   * inside the public Skill (its GROUPIE_SIGNING_KEY). It is integrity and spam friction only; single-use
   * pair codes plus rate limits are the real protection. Never reuse another secret here.
   */
  cubbiePublicSigningKey: process.env.CUBBIE_PUBLIC_SIGNING_KEY ?? '',
  /** 32 bytes, base64. Encrypts calendar feed URLs at rest. */
  feedEncryptionKey: process.env.FEED_ENCRYPTION_KEY ?? '',
  /** Set to 'true' to turn on calendar-load-aware splitting. */
  loadAwareSplit: process.env.LOAD_AWARE_SPLIT === 'true',
  /** Per-user Google OAuth (Web client, redirect PUBLIC_URL/api/google/callback, free/busy scope). Optional. */
  googleUserClientId: process.env.GOOGLE_USER_CLIENT_ID ?? '',
  googleUserClientSecret: process.env.GOOGLE_USER_CLIENT_SECRET ?? '',
  defaultTz: process.env.DEFAULT_TZ ?? 'America/Phoenix',
  /** Set to 'true' for demos: caches LLM answers and serves them when Groq fails (see demo/llmCache.ts). */
  demoMode: process.env.DEMO_MODE === 'true',
  // webhook: production. polling: local testing (takes the bot away from prod). off: no bot.
  botMode: (process.env.BOT_MODE ?? (isProd ? 'webhook' : 'off')) as 'webhook' | 'polling' | 'off',
};

/** The real secrets the public signing key and the feed key must never equal. */
const OTHER_SECRETS = ['BOT_TOKEN', 'WEBHOOK_SECRET', 'LINK_SIGNING_SECRET', 'GROQ_API_KEY', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;

/**
 * Throws if CUBBIE_PUBLIC_SIGNING_KEY (which is public) or FEED_ENCRYPTION_KEY reuses another secret's value.
 * The message names variables only, never values. Called at startup before listening.
 */
export function assertDistinctSecrets(vars: Record<string, string | undefined> = process.env): void {
  const clashes: string[] = [];
  const check = (name: string, others: readonly string[]) => {
    const value = vars[name];
    if (!value) return;
    for (const other of others) if (vars[other] === value) clashes.push(`${name} equals ${other}`);
  };
  check('CUBBIE_PUBLIC_SIGNING_KEY', ['FEED_ENCRYPTION_KEY', ...OTHER_SECRETS]);
  check('FEED_ENCRYPTION_KEY', OTHER_SECRETS);
  if (clashes.length) {
    throw new Error(
      `Refusing to start: ${clashes.join(', ')}. CUBBIE_PUBLIC_SIGNING_KEY ships inside the public Skill and FEED_ENCRYPTION_KEY must stay private, so give each its own value (openssl rand -hex 32).`,
    );
  }
}
