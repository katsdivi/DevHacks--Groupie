// Shared helpers for the local tooling (setup, doctor, start-local). Node builtins only: setup runs before install.
// Output never includes secret values, only names and lengths (same convention as scripts/railway-env.sh).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SERVER_DIR = path.join(ROOT, 'apps/server');
export const ENV_FILE = path.join(ROOT, '.env');
export const ENV_EXAMPLE = path.join(ROOT, '.env.example');

const LINE = /^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** The value part of a KEY=value line: quotes stripped, an unquoted inline ` # comment` dropped (as node --env-file does). */
function parseValue(raw) {
  const val = raw.trimStart();
  const quoted = /^(["'])(.*?)\1/.exec(val);
  if (quoted) return quoted[2];
  if (val.startsWith('#')) return '';
  return val.replace(/\s+#.*$/, '').trim();
}

/** Parses .env text into { KEY: value }. Last assignment wins. Never evaluates anything. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const m = LINE.exec(line);
    if (m) out[m[2]] = parseValue(m[3]);
  }
  return out;
}

export function readEnvFile(file = ENV_FILE) {
  return fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : null;
}

/** Formats a value for a .env line, quoting only when it would otherwise be misread. */
function formatValue(value) {
  if (!/[\s#"']/.test(value)) return value;
  return value.includes('"') ? `'${value}'` : `"${value}"`;
}

/**
 * Returns text with each KEY set to its new value. Rewrites the last assignment in place (keeping any
 * inline comment after it) and appends keys that are not in the file yet.
 */
export function setEnvValues(text, updates) {
  const lines = text.split('\n');
  for (const [key, value] of Object.entries(updates)) {
    let last = -1;
    lines.forEach((line, i) => {
      if (!/^\s*#/.test(line) && LINE.exec(line)?.[2] === key) last = i;
    });
    if (last === -1) {
      if (lines.length && lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, `${key}=${formatValue(value)}`);
      else lines.push(`${key}=${formatValue(value)}`);
      continue;
    }
    const raw = LINE.exec(lines[last])[3];
    const comment = /^\s*(["']).*?\1(\s+#.*)$/.exec(raw)?.[2] ?? /^[^"']*?(\s+#.*)$/.exec(raw)?.[1] ?? '';
    const prefix = lines[last].slice(0, lines[last].indexOf('=') + 1);
    lines[last] = `${prefix}${formatValue(value)}${comment}`;
  }
  return lines.join('\n');
}

/** Same rule as assertDistinctSecrets in apps/server/src/env.ts. Returns "A equals B" strings, names only. */
const OTHER_SECRETS = ['BOT_TOKEN', 'WEBHOOK_SECRET', 'LINK_SIGNING_SECRET', 'GROQ_API_KEY', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
export function secretClashes(vars) {
  const clashes = [];
  const check = (name, others) => {
    if (!vars[name]) return;
    for (const other of others) if (vars[other] === vars[name]) clashes.push(`${name} equals ${other}`);
  };
  check('CUBBIE_PUBLIC_SIGNING_KEY', ['FEED_ENCRYPTION_KEY', ...OTHER_SECRETS]);
  check('FEED_ENCRYPTION_KEY', OTHER_SECRETS);
  return clashes;
}

export const validFeedKey = (value) => Boolean(value) && Buffer.from(value, 'base64').length === 32;

/** The mode the server will run the bot in, mirroring env.ts. */
export const resolveBotMode = (vars) => vars.BOT_MODE || (vars.NODE_ENV === 'production' ? 'webhook' : 'off');

/** The directory the server will put the SQLite file in. The server runs with apps/server as its cwd. */
export const databaseDir = (vars) => path.dirname(path.resolve(SERVER_DIR, vars.DATABASE_PATH || './data/groupie.db'));

const TELEGRAM_API = () => (process.env.GROUPIE_TELEGRAM_API || 'https://api.telegram.org').replace(/\/$/, '');
const GROQ_API = () => (process.env.GROUPIE_GROQ_API || 'https://api.groq.com').replace(/\/$/, '');

/** Calls a Telegram Bot API method. Returns { ok, result } or { ok: false, error } and never throws. */
async function telegram(token, method) {
  try {
    const res = await fetch(`${TELEGRAM_API()}/bot${token}/${method}`, { signal: AbortSignal.timeout(8000) });
    const body = await res.json().catch(() => ({}));
    if (body.ok) return { ok: true, result: body.result };
    return { ok: false, error: res.status === 401 || res.status === 404 ? 'token rejected by Telegram' : `HTTP ${res.status}`, rejected: res.status === 401 || res.status === 404 };
  } catch (err) {
    return { ok: false, error: `network error (${err.name === 'TimeoutError' ? 'timed out' : err.cause?.code ?? err.message})`, network: true };
  }
}

/**
 * Checks a bot token. Read-only: getMe and getWebhookInfo change nothing.
 * Result: { ok, username?, webhookSet?, error? }. webhookSet is true when the bot already has a webhook URL,
 * which almost always means it is a deployed (production) bot.
 */
export async function checkBot(token) {
  const me = await telegram(token, 'getMe');
  if (!me.ok) return { ok: false, error: me.error, network: me.network };
  const hook = await telegram(token, 'getWebhookInfo');
  if (!hook.ok) return { ok: false, username: me.result.username, error: `getWebhookInfo failed: ${hook.error}`, network: hook.network };
  return { ok: true, username: me.result.username, webhookSet: Boolean(hook.result.url) };
}

/** Lists Groq models with the key: cheap and read-only. Result: { ok, error? }. */
export async function checkGroq(key) {
  try {
    const res = await fetch(`${GROQ_API()}/openai/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: res.status === 401 || res.status === 403 ? 'key rejected by Groq' : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: `network error (${err.name === 'TimeoutError' ? 'timed out' : err.cause?.code ?? err.message})`, network: true };
  }
}

export const WEBHOOK_WARNING = [
  'This bot has a webhook set, so it is probably the deployed production bot.',
  'Polling would delete that webhook and break the live bot, so BOT_MODE stays off.',
  'Fix: create a separate TEST bot in @BotFather, put its token in BOT_TOKEN, and run pnpm bootstrap again.',
];
