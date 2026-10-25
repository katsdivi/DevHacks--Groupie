#!/usr/bin/env node
// One-command local setup: checks the toolchain, installs, downloads Chromium, and fills .env.
// Plain Node with no dependencies because it runs before `pnpm install`. Safe to rerun: values already
// in .env are kept. Secrets are never printed, only their names and lengths.
//
// Usage: pnpm bootstrap [--yes] [--skip-install]   (or: node scripts/setup.mjs ...)
//   --yes           no prompts: BOT_TOKEN, GROQ_API_KEY and CUBBIE_HANDLE come from the environment
//                   (also the default when stdin is not a terminal)
//   --skip-install  skip pnpm install and the Chromium download (for tests and CI)
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import {
  ENV_EXAMPLE,
  ENV_FILE,
  ROOT,
  WEBHOOK_WARNING,
  checkBot,
  checkGroq,
  databaseDir,
  parseEnv,
  secretClashes,
  setEnvValues,
  validFeedKey,
} from './lib/local.mjs';

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(5, 9).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
const unknown = args.filter((a) => !['--yes', '-y', '--skip-install'].includes(a));
if (unknown.length) fail(`unknown argument ${unknown[0]} (see --help)`);
const interactive = !args.includes('--yes') && !args.includes('-y') && process.stdin.isTTY;
const skipInstall = args.includes('--skip-install');

function fail(message, fix) {
  console.error(`error: ${message}`);
  if (fix) console.error(`fix: ${fix}`);
  process.exit(1);
}
const step = (text) => console.log(`\n== ${text}`);
const warn = (text) => console.log(`warning: ${text}`);

// 1. Toolchain
step('Toolchain');
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) fail(`Node ${process.versions.node} is too old; Groupie needs Node 20 or newer`, 'install Node 20+ from https://nodejs.org (or `nvm install 20`)');
const pnpm = spawnSync('pnpm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (pnpm.status !== 0) fail('pnpm not found', 'run `corepack enable` (ships with Node) or `npm install -g pnpm`, then rerun');
console.log(`node ${process.versions.node}, pnpm ${pnpm.stdout.trim()}`);

// 2. Dependencies and Chromium
const run = (cmd, cmdArgs, what) => {
  console.log(`$ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail(`${what} failed`, `run \`${cmd} ${cmdArgs.join(' ')}\` yourself to see the full error`);
};
if (skipInstall) {
  step('Install (skipped: --skip-install)');
} else {
  step('Install');
  run('pnpm', ['install'], 'pnpm install');
  run('pnpm', ['--filter', '@groupie/server', 'exec', 'playwright', 'install', 'chromium'], 'Chromium download');
}

// 3. .env
step('.env');
if (!fs.existsSync(ENV_FILE)) {
  fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
  console.log('created .env from .env.example');
}
const original = fs.readFileSync(ENV_FILE, 'utf8');
const current = parseEnv(original);
const updates = {};
const value = (name) => updates[name] ?? current[name] ?? '';

// Prompts only for empty values. Secret answers are not echoed.
async function ask(question, { secret = false } = {}) {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  const answer = new Promise((resolve) => rl.question(question, resolve));
  muted = secret;
  const text = (await answer).trim();
  rl.close();
  if (secret) process.stdout.write(text ? `(${text.length} chars)\n` : '\n');
  return text;
}

const asks = [
  {
    name: 'BOT_TOKEN',
    secret: true,
    intro: [
      'BOT_TOKEN: create a separate TEST bot in Telegram with @BotFather (/newbot) and paste its token.',
      'Do not use the production bot: running locally would take it away from the deployed server.',
    ],
  },
  { name: 'GROQ_API_KEY', secret: true, intro: ['GROQ_API_KEY: create a free key at https://console.groq.com/keys'] },
  { name: 'CUBBIE_HANDLE', secret: false, intro: ["CUBBIE_HANDLE (optional): Cubbie's iMessage phone number or email. Press Enter to skip."] },
];
for (const { name, secret, intro } of asks) {
  if (current[name]) {
    console.log(`kept ${name} (${current[name].length} chars)`);
    continue;
  }
  let answer = process.env[name]?.trim() ?? '';
  if (!answer && interactive) {
    console.log(`\n${intro.join('\n')}`);
    answer = await ask(`${name}: `, { secret });
  }
  if (answer) updates[name] = answer;
  else console.log(`${name} left empty${name === 'CUBBIE_HANDLE' ? ' (optional)' : '; set it in .env and rerun'}`);
}
if (value('BOT_TOKEN') && !/^\d+:[\w-]{20,}$/.test(value('BOT_TOKEN'))) warn('BOT_TOKEN does not look like a BotFather token (digits:letters)');

// Generated secrets, each distinct from every other value in the file.
const generators = {
  WEBHOOK_SECRET: () => randomBytes(32).toString('hex'),
  LINK_SIGNING_SECRET: () => randomBytes(32).toString('hex'),
  FEED_ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
  CUBBIE_PUBLIC_SIGNING_KEY: () => randomBytes(32).toString('hex'),
};
for (const [name, make] of Object.entries(generators)) {
  if (current[name]) {
    if (name === 'FEED_ENCRYPTION_KEY' && !validFeedKey(current[name])) {
      warn('FEED_ENCRYPTION_KEY is set but is not 32 bytes of base64; kept as is, so feeds stay off (clear it and rerun to generate one)');
    }
    continue;
  }
  const taken = new Set(Object.values({ ...current, ...updates }).filter(Boolean));
  let next = make();
  while (taken.has(next)) next = make();
  updates[name] = next;
}

// 4. Validate the bot token and pick BOT_MODE. Fail safe: polling only when Telegram confirms no webhook.
step('Telegram');
const botMode = value('BOT_MODE');
if (!value('BOT_TOKEN')) {
  console.log('skipped: no BOT_TOKEN (the server runs without the bot)');
} else {
  const bot = await checkBot(value('BOT_TOKEN'));
  if (bot.username && bot.username !== value('BOT_USERNAME')) {
    updates.BOT_USERNAME = bot.username;
    console.log(`BOT_USERNAME set to ${bot.username} from getMe${current.BOT_USERNAME ? ` (was ${current.BOT_USERNAME})` : ''}`);
  }
  if (!bot.ok) {
    warn(`${bot.error}; BOT_MODE left as ${botMode || 'empty (means off)'}`);
    console.log(bot.network ? 'fix: rerun pnpm bootstrap when online to enable polling' : 'fix: copy the token again from @BotFather into BOT_TOKEN in .env and rerun');
  } else if (bot.webhookSet) {
    console.log(`bot @${bot.username}: webhook is set`);
    for (const line of WEBHOOK_WARNING) console.log(line);
    if (botMode !== 'off') {
      updates.BOT_MODE = 'off';
      console.log(`BOT_MODE set to off${botMode ? ` (was ${botMode})` : ''}`);
    }
  } else {
    console.log(`bot @${bot.username}: token works, no webhook set`);
    if (!botMode) {
      updates.BOT_MODE = 'polling';
      console.log('BOT_MODE set to polling');
    } else if (botMode !== 'polling') {
      console.log(`BOT_MODE kept as ${botMode} (set it to polling in .env to run the bot from this machine)`);
    } else {
      console.log('BOT_MODE kept as polling');
    }
  }
}

step('Groq');
if (!value('GROQ_API_KEY')) {
  console.log('skipped: no GROQ_API_KEY (the bot answers without the LLM)');
} else {
  const groq = await checkGroq(value('GROQ_API_KEY'));
  if (groq.ok) console.log('GROQ_API_KEY works');
  else warn(`${groq.error}${groq.network ? '; rerun pnpm run doctor when online' : '; create a new key at https://console.groq.com/keys'}`);
}

// 5. Write
step('Result');
const clashes = secretClashes({ ...current, ...updates });
if (clashes.length) {
  fail(`${clashes.join(', ')}; the server refuses to start like this`, 'clear one of them in .env and rerun to generate a fresh value');
}
const next = setEnvValues(original, updates);
if (next !== original) {
  fs.writeFileSync(ENV_FILE, next);
  for (const name of Object.keys(updates)) {
    const plain = name === 'BOT_MODE' || name === 'BOT_USERNAME';
    console.log(`set ${name}${plain ? `=${updates[name]}` : ` (${updates[name].length} chars)`}`);
  }
} else {
  console.log('.env unchanged');
}
try {
  fs.chmodSync(ENV_FILE, 0o600);
} catch {
  // Not supported everywhere (Windows); the file is gitignored either way.
}

for (const dir of new Set([path.join(ROOT, 'data'), databaseDir({ ...current, ...updates })])) fs.mkdirSync(dir, { recursive: true });

// 6. Feature matrix (needs the installed tsx).
const tsx = path.join(ROOT, 'apps/server/node_modules/.bin/tsx');
if (fs.existsSync(tsx)) {
  step('Features');
  spawnSync(tsx, ['scripts/doctor.mjs', '--no-network', '--matrix-only'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
}
console.log('\nNext: pnpm start:local   (pnpm run doctor rechecks everything)');
