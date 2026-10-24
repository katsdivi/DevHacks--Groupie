import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HealthResponse } from '@groupie/shared';
import { env } from './env.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  const body: HealthResponse = { ok: true, service: 'groupie', time: new Date().toISOString() };
  res.json(body);
});

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

const dataDir = path.dirname(path.resolve(env.databasePath));
fs.mkdirSync(dataDir, { recursive: true });
fs.accessSync(dataDir, fs.constants.W_OK);
console.log(`Data dir ${dataDir} is writable`);

app.listen(env.port, () => {
  console.log(`Groupie listening on port ${env.port}`);
});
