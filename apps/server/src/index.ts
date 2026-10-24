import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { webhookCallback } from 'grammy';
import type { HealthResponse } from '@groupie/shared';
import { env } from './env.ts';
import './db/index.ts';
import { ALLOWED_UPDATES, bot } from './bot/index.ts';
import { api } from './api.ts';
import { devState } from './groups.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  const body: HealthResponse = { ok: true, service: 'groupie', time: new Date().toISOString() };
  res.json(body);
});

app.use('/api', api);

if (env.devMode) {
  app.get('/dev/state', (_req, res) => {
    res.type('json').send(JSON.stringify({ groups: devState() }, null, 2));
  });
}

if (env.botMode === 'webhook') {
  app.post('/tg/webhook', webhookCallback(bot, 'express', { secretToken: env.webhookSecret }));
}

if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|tg|dev|cards|health).*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text').send('Groupie server is running. Build the web app with `pnpm build` to see the Mini App.');
  });
}

console.log(`Database at ${path.resolve(env.databasePath)}`);

app.listen(env.port, () => {
  console.log(`Groupie listening on port ${env.port}`);
  startBot().catch((err) => console.error('Bot failed to start', err));
});

async function startBot() {
  if (env.botMode === 'off' || !env.botToken) {
    console.log('Bot is off (set BOT_MODE=polling to run it locally)');
    return;
  }
  await bot.api.setMyCommands([
    { command: 'app', description: 'Open Groupie' },
    { command: 'setup', description: 'Set team size and get started' },
    { command: 'settings', description: 'Group settings' },
    { command: 'rename', description: 'Give me a new name' },
  ]);
  if (env.botMode === 'webhook') {
    await bot.api.setWebhook(`${env.publicUrl}/tg/webhook`, {
      secret_token: env.webhookSecret,
      allowed_updates: [...ALLOWED_UPDATES],
    });
    console.log(`Bot webhook set to ${env.publicUrl}/tg/webhook`);
  } else {
    await bot.api.deleteWebhook();
    void bot.start({ allowed_updates: [...ALLOWED_UPDATES] });
    console.log('Bot polling (production webhook removed; redeploy to restore)');
  }
}
