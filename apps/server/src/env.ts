const isProd = process.env.NODE_ENV === 'production';

export const env = {
  port: Number(process.env.PORT ?? 3000),
  isProd,
  devMode: process.env.DEV_MODE === 'true',
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  databasePath: process.env.DATABASE_PATH ?? './data/groupie.db',
  botToken: process.env.BOT_TOKEN ?? '',
  botUsername: process.env.BOT_USERNAME ?? 'CubbieGroupieBot',
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  defaultTz: process.env.DEFAULT_TZ ?? 'America/Phoenix',
  // webhook: production. polling: local testing (takes the bot away from prod). off: no bot.
  botMode: (process.env.BOT_MODE ?? (isProd ? 'webhook' : 'off')) as 'webhook' | 'polling' | 'off',
};
