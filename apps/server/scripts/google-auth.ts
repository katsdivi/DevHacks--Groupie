/**
 * One-time Google consent: `pnpm google:auth`.
 * Opens the consent page, catches the redirect on localhost, and saves GOOGLE_REFRESH_TOKEN to .env.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { CALENDAR_SCOPES, oauthClient } from '../src/calendar.ts';
import { env } from '../src/env.ts';

const envPath = path.resolve(import.meta.dirname, '../../../.env');

if (!env.googleClientId || !env.googleClientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const server = http.createServer();
server.listen(0, '127.0.0.1', () => {
  const port = (server.address() as AddressInfo).port;
  const redirect = `http://127.0.0.1:${port}/callback`;
  const client = oauthClient(redirect);
  const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: CALENDAR_SCOPES });

  server.on('request', async (req, res) => {
    const u = new URL(req.url ?? '/', redirect);
    if (u.pathname !== '/callback') return void res.writeHead(404).end();
    const code = u.searchParams.get('code');
    if (!code) {
      res.writeHead(400).end(`No code: ${u.searchParams.get('error') ?? 'unknown error'}`);
      return;
    }
    try {
      const { tokens } = await client.getToken(code);
      if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove Groupie at myaccount.google.com/permissions and try again.');
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      const i = lines.findIndex((l) => l.startsWith('GOOGLE_REFRESH_TOKEN='));
      const line = `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`;
      if (i >= 0) lines[i] = line;
      else lines.push(line);
      fs.writeFileSync(envPath, lines.join('\n'));
      res.writeHead(200, { 'content-type': 'text/html' }).end('<h2>Groupie is connected to Google Calendar. You can close this tab.</h2>');
      console.log('\nSaved GOOGLE_REFRESH_TOKEN to .env. Tell Claude it worked so it can set it on Railway.');
    } catch (err) {
      res.writeHead(500).end(String(err));
      console.error(err);
    } finally {
      server.close();
    }
  });

  console.log(`Opening Google consent. If nothing opens, visit:\n\n${url}\n`);
  exec(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} "${url}"`);
});
