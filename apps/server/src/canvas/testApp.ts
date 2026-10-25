import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { cubbieImportRouter, canvasRouter } from './routes.ts';
import { cubbieLinkRouter } from './link.ts';

/**
 * Test-only: the same mounts as index.ts (raw body parser, public import, authed /api), with a fake
 * auth that takes the Telegram user id from `x-test-user`.
 */
export async function startTestApp() {
  const app = express();
  app.use(
    ['/api/cubbie/import', '/api/cubbie/link'],
    express.json({
      limit: '16mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(express.json());
  app.use('/api/cubbie/import', cubbieImportRouter);
  app.use('/api/cubbie', cubbieLinkRouter);
  app.use('/api', (req, res, next) => {
    const id = Number(req.header('x-test-user'));
    if (!id) return void res.status(401).json({ error: 'unauthorized' });
    res.locals.tgUser = { id, first_name: 'Test' };
    next();
  });
  app.use('/api', canvasRouter);
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}
