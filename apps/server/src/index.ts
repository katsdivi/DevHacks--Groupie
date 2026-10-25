import { googleCallbackRouter } from './routes/googleCallback.ts';
import { startReminderScheduler } from './reminders.ts';
import { startCalendarSync } from './calendarSync.ts';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { webhookCallback } from 'grammy';
import type { HealthResponse } from '@groupie/shared';
import { assertDistinctSecrets, env } from './env.ts';
import './db/index.ts';
import { ALLOWED_UPDATES, bot } from './bot/index.ts';
import { api } from './api.ts';
import { devState, getGroup } from './groups.ts';
import { computeSplit, splitCardData, splitView } from './splitService.ts';
import { splitCardHtml } from './cards/splitCard.ts';
import { renderPng } from './cards/render.ts';
import { listMembers } from './members.ts';
import { signLinkToken } from './linkToken.ts';
import { progressPreviewHtml, renderProgressPng, startWeeklyCheckins } from './bot/checkin.ts';
import { cubbieImportRouter } from './canvas/routes.ts';
import { startFeedPoller } from './canvas/poller.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');

const app = express();
// The Cubbie import is signed over its raw body and may carry attachments, so it gets its own parser.
app.use(
  '/api/cubbie/import',
  express.json({
    limit: '16mb',
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.json());

app.get('/health', (_req, res) => {
  const body: HealthResponse = { ok: true, service: 'groupie', time: new Date().toISOString() };
  res.json(body);
});

// Public: the Cubbie Skill has no Telegram login. The pair code and signature gate it.
app.use('/api/cubbie/import', cubbieImportRouter);
app.use('/api', googleCallbackRouter);
app.use('/api', api);

if (env.devMode) {
  app.get('/dev/state', (_req, res) => {
    res.type('json').send(JSON.stringify({ groups: devState() }, null, 2));
  });

  // Live split (computed now, not saved) drawn as the card.
  app.get('/dev/split', (req, res) => {
    const group = getGroup(Number(req.query.group));
    if (!group) return void res.status(404).type('text').send('Unknown group. See /dev/state for ids.');
    const view = splitView(group.id, null, computeSplit(group.id));
    res.type('html').send(splitCardHtml(splitCardData(view)));
  });

  // Signed browser links to each member's availability page (for teammates not on Telegram).
  app.get('/dev/links', (req, res) => {
    const group = getGroup(Number(req.query.group));
    if (!group) return void res.status(404).type('text').send('Unknown group. See /dev/state for ids.');
    res.json(
      listMembers(group.id).map((m) => ({
        member_id: m.id,
        name: m.name,
        url: `${env.publicUrl}/?t=${signLinkToken({ g: group.id, m: m.id, n: m.name }, env.linkSigningSecret)}`,
      })),
    );
  });

  // Progress card: HTML with ?preview=1, otherwise the PNG we post.
  app.get('/cards/progress', async (req, res) => {
    const group = getGroup(Number(req.query.group));
    if (!group) return void res.status(404).type('text').send('Unknown group. See /dev/state for ids.');
    if (req.query.preview) return void res.type('html').send(progressPreviewHtml(group.id));
    res.type('png').send(await renderProgressPng(group.id));
  });

  // Saved split as the card: HTML with ?preview=1, otherwise the PNG we post.
  app.get('/cards/split', async (req, res) => {
    const group = getGroup(Number(req.query.group));
    if (!group) return void res.status(404).type('text').send('Unknown group. See /dev/state for ids.');
    const html = splitCardHtml(splitCardData(splitView(group.id, null)));
    if (req.query.preview) return void res.type('html').send(html);
    res.type('png').send(await renderPng(html));
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

assertDistinctSecrets();

console.log(`Database at ${path.resolve(env.databasePath)}`);

app.listen(env.port, (err) => {
  // Express 5 passes listen errors (like a taken port) to this callback.
  if (err) throw err;
  console.log(`Groupie listening on port ${env.port}`);
  startFeedPoller();
  startReminderScheduler();
  startCalendarSync();
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
    { command: 'join', description: 'Show who has joined' },
    { command: 'split', description: 'Show the fair split' },
    { command: 'canvas', description: 'Import the assignment from Canvas via Cubbie' },
    { command: 'avail', description: 'When is everyone free?' },
    { command: 'meetlink', description: 'Set the meeting link or place' },
    { command: 'checkin', description: 'How is everyone doing?' },
    { command: 'progress', description: 'Show the progress card' },
    { command: 'settings', description: 'Group settings' },
    { command: 'rename', description: 'Give me a new name' },
  ]);
  startWeeklyCheckins();
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
