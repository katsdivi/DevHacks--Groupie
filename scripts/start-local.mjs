// Builds the Mini App and starts the server with the repo-root .env, the way a local test run should.
// BOT_MODE comes from .env, with two guards: webhook runs as off (it is for the deployed server), and
// polling runs as off when Telegram says the bot has a webhook (that is the production bot).
//
// Usage: pnpm start:local [--tunnel] [--skip-build]
//   --tunnel      start a cloudflared quick tunnel and use its https URL as PUBLIC_URL for this run
//   --skip-build  reuse the existing apps/web/dist
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, WEBHOOK_WARNING, checkBot, readEnvFile, resolveBotMode, secretClashes } from './lib/local.mjs';

const args = process.argv.slice(2);
const unknown = args.filter((a) => !['--tunnel', '--skip-build'].includes(a));
if (unknown.length) {
  console.error(`error: unknown argument ${unknown[0]} (usage: pnpm start:local [--tunnel] [--skip-build])`);
  process.exit(2);
}
const shell = process.platform === 'win32';

const vars = readEnvFile();
if (!vars) {
  console.error('error: .env not found\nfix: pnpm bootstrap');
  process.exit(1);
}
const clashes = secretClashes(vars);
if (clashes.length) {
  console.error(`error: ${clashes.join(', ')}; the server would refuse to start\nfix: clear one of them in .env and run pnpm bootstrap`);
  process.exit(1);
}
const port = Number(vars.PORT || 3000);
const overrides = {};

let mode = resolveBotMode(vars);
let botName = vars.BOT_USERNAME;
if (mode === 'webhook') {
  console.log('BOT_MODE=webhook is for the deployed server; running with the bot off. Use BOT_MODE=polling with a TEST bot.');
  mode = 'off';
}
if (mode === 'polling' && vars.BOT_TOKEN) {
  const bot = await checkBot(vars.BOT_TOKEN);
  if (bot.ok && bot.webhookSet) {
    for (const line of WEBHOOK_WARNING) console.log(line);
    mode = 'off';
  } else if (bot.ok) {
    botName = bot.username;
  } else {
    console.log(`warning: could not check the bot (${bot.error}); starting with polling anyway`);
  }
}
overrides.BOT_MODE = mode;

if (!args.includes('--skip-build')) {
  console.log('$ pnpm build');
  const build = spawnSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit', shell });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const children = [];
const stopAll = (code) => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exit(code);
};
process.on('SIGINT', () => stopAll(130));
process.on('SIGTERM', () => stopAll(143));

if (args.includes('--tunnel')) {
  const url = await startTunnel();
  if (url) {
    overrides.PUBLIC_URL = url;
    console.log(`Tunnel: ${url} (PUBLIC_URL for this run only; the URL changes every run)`);
    console.log('To open the Mini App from the TEST bot, set this URL in @BotFather: /myapps > your app > Edit Web App URL.');
  }
}

// Same command as `pnpm dev` without watch. Variables already in the environment win over --env-file,
// which is how the overrides above reach the server.
const server = spawn('pnpm', ['--filter', '@groupie/server', 'exec', 'tsx', '--env-file-if-exists=../../.env', 'src/index.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell,
  env: { ...process.env, ...overrides },
});
children.push(server);
server.on('exit', (code) => stopAll(code ?? 1));

const health = `http://localhost:${port}/health`;
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const up = await fetch(health, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok, () => false);
  if (!up) continue;
  console.log(`\nGroupie is up: ${health}`);
  if (mode === 'polling' && vars.BOT_TOKEN) console.log(`Bot polling: message your test bot${botName ? ` @${botName}` : ''} now.`);
  else console.log('Bot is off. Run pnpm run doctor to see why and how to turn it on.');
  break;
}

/** Starts `cloudflared tunnel --url` and resolves with its https URL, or null (with a warning) on failure. */
function startTunnel() {
  if (spawnSync('cloudflared', ['--version'], { shell }).status !== 0) {
    console.log('warning: cloudflared not found, starting without a tunnel (brew install cloudflared)');
    return Promise.resolve(null);
  }
  console.log('Starting a cloudflared quick tunnel...');
  const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'], shell });
  children.push(tunnel);
  return new Promise((resolve) => {
    const done = (url) => {
      clearTimeout(timer);
      if (!url) {
        console.log('warning: no tunnel URL from cloudflared within 30s, starting without a tunnel');
        tunnel.kill('SIGTERM');
      }
      resolve(url);
    };
    const timer = setTimeout(() => done(null), 30_000);
    let seen = '';
    const onData = (chunk) => {
      seen += chunk;
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(seen);
      if (match) done(match[0]);
    };
    tunnel.stdout.on('data', onData);
    tunnel.stderr.on('data', onData);
    tunnel.on('exit', () => done(null));
  });
}
