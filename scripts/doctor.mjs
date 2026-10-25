// Read-only health check of a local setup: toolchain, .env, Telegram, Groq, and the feature matrix.
// Never writes anything and never prints secret values, only names and lengths.
// Runs through the server's tsx so it can share apps/server/src/featureMatrix.ts with the server's boot log.
//
// Usage: pnpm run doctor [--no-network]   (`pnpm doctor` without `run` is pnpm's own built-in command)
//   --no-network   skip the Telegram and Groq checks
//   --matrix-only  print just the feature matrix (used at the end of pnpm bootstrap)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { featureMatrix, formatFeatureMatrix } from '../apps/server/src/featureMatrix.ts';
import {
  ENV_FILE,
  ROOT,
  SERVER_DIR,
  WEBHOOK_WARNING,
  checkBot,
  checkGroq,
  databaseDir,
  readEnvFile,
  resolveBotMode,
  secretClashes,
} from './lib/local.mjs';

const args = process.argv.slice(2);
const network = !args.includes('--no-network');
const matrixOnly = args.includes('--matrix-only');

let errors = 0;
const ok = (text) => console.log(`  ok    ${text}`);
const warn = (text, fix) => console.log(`  warn  ${text}${fix ? `\n        fix: ${fix}` : ''}`);
const bad = (text, fix) => {
  errors++;
  console.log(`  FAIL  ${text}${fix ? `\n        fix: ${fix}` : ''}`);
};

const vars = readEnvFile() ?? {};

if (!matrixOnly) {
  console.log('Toolchain');
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) ok(`node ${process.versions.node}`);
  else bad(`node ${process.versions.node} is older than 20`, 'install Node 20+ from https://nodejs.org');
  const pnpm = spawnSync('pnpm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (pnpm.status === 0) ok(`pnpm ${pnpm.stdout.trim()}`);
  else bad('pnpm not found', 'corepack enable');
  try {
    const { chromium } = createRequire(path.join(SERVER_DIR, 'package.json'))('playwright');
    if (fs.existsSync(chromium.executablePath())) ok('Chromium for Playwright installed');
    else bad('Chromium for Playwright is missing (cards cannot render)', 'pnpm --filter @groupie/server exec playwright install chromium');
  } catch {
    bad('playwright is not installed', 'pnpm install');
  }
  if (fs.existsSync(path.join(ROOT, 'apps/web/dist/index.html'))) ok('web app built (apps/web/dist)');
  else warn('web app not built yet', 'pnpm start:local builds it (or pnpm build)');

  console.log('\n.env');
  if (!fs.existsSync(ENV_FILE)) {
    bad('.env not found', 'pnpm bootstrap');
  } else {
    ok(`.env found (${Object.keys(vars).length} variables)`);
    for (const name of ['WEBHOOK_SECRET', 'LINK_SIGNING_SECRET', 'FEED_ENCRYPTION_KEY', 'CUBBIE_PUBLIC_SIGNING_KEY']) {
      if (vars[name]) ok(`${name} set (${vars[name].length} chars)`);
      else warn(`${name} empty`, 'pnpm bootstrap generates it');
    }
    const clashes = secretClashes(vars);
    if (clashes.length) bad(`${clashes.join(', ')}: the server refuses to start`, 'clear one of them in .env and run pnpm bootstrap');
    else ok('secrets are distinct');
    ok(`database directory ${databaseDir(vars)}`);
    const mode = resolveBotMode(vars);
    if (mode === 'webhook') warn('BOT_MODE=webhook is for the deployed server', 'use BOT_MODE=polling with a TEST bot locally (pnpm start:local runs webhook as off)');
  }

  console.log('\nNetwork');
  if (!network) {
    console.log('  skipped (--no-network)');
  } else {
    if (!vars.BOT_TOKEN) {
      warn('no BOT_TOKEN', 'create a TEST bot in @BotFather and run pnpm bootstrap');
    } else {
      const bot = await checkBot(vars.BOT_TOKEN);
      if (!bot.ok) {
        if (bot.network) warn(`Telegram: ${bot.error}`);
        else bad(`Telegram: ${bot.error}`, 'copy the token again from @BotFather into BOT_TOKEN');
      } else {
        ok(`Telegram: token works for @${bot.username}`);
        if (bot.username !== (vars.BOT_USERNAME || 'CubbieGroupieBot')) {
          bad(`BOT_USERNAME does not match the token's bot (@${bot.username}), so Mini App buttons open the wrong bot`, 'pnpm bootstrap fixes it');
        }
        if (bot.webhookSet && resolveBotMode(vars) === 'polling') {
          bad(`${WEBHOOK_WARNING[0]} Starting with BOT_MODE=polling would delete it.`, WEBHOOK_WARNING[2].replace(/^Fix: /, ''));
        } else if (bot.webhookSet) {
          warn(`${WEBHOOK_WARNING[0]} BOT_MODE is not polling, so it is left alone.`);
        } else {
          ok('Telegram: no webhook set, polling is safe');
        }
      }
    }
    if (!vars.GROQ_API_KEY) {
      warn('no GROQ_API_KEY', 'https://console.groq.com/keys');
    } else {
      const groq = await checkGroq(vars.GROQ_API_KEY);
      if (groq.ok) ok('Groq: key works');
      else if (groq.network) warn(`Groq: ${groq.error}`);
      else bad(`Groq: ${groq.error}`, 'create a new key at https://console.groq.com/keys');
    }
  }
  console.log('\nFeatures');
}

console.log(formatFeatureMatrix(featureMatrix(vars), true).join('\n'));
if (!matrixOnly) console.log(errors ? `\n${errors} problem(s) found` : '\nAll good');
process.exit(errors ? 1 : 0);
