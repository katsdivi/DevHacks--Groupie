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
  defaultTz: process.env.DEFAULT_TZ ?? 'America/Phoenix',
  // webhook: production. polling: local testing (takes the bot away from prod). off: no bot.
  botMode: (process.env.BOT_MODE ?? (isProd ? 'webhook' : 'off')) as 'webhook' | 'polling' | 'off',
};
