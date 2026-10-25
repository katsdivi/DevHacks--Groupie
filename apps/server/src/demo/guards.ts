import path from 'node:path';

/**
 * Argument parsing and the guards every demo subcommand passes before touching the database.
 * Pure: takes argv, an env record, and the config admins, so tests need no DB or env mutation.
 */

export const SUBCOMMANDS = ['reset', 'seed', 'remind', 'warm'] as const;
export type Subcommand = (typeof SUBCOMMANDS)[number];

export type DemoArgs = {
  sub: Subcommand;
  /** The group chat id (reset, seed, warm) or Telegram user id (remind). */
  target: number;
  as: number | null;
  prodOk: boolean;
  leaveJoin: boolean;
  config: string | undefined;
};

export const USAGE = `Usage: cli.ts <reset|seed|warm> <groupChatId> --as <telegramUserId> [--prod-ok] [--leave-join] [--config <path>]
       cli.ts remind <telegramUserId> --as <telegramUserId> [--prod-ok]`;

const isInt = (s: string | undefined) => !!s && /^-?\d+$/.test(s);

/** Parses argv (without node and the script). Throws with a usage hint on bad input. */
export function parseArgs(argv: string[]): DemoArgs {
  const [sub, target, ...rest] = argv;
  if (!SUBCOMMANDS.includes(sub as Subcommand)) throw new Error(`Unknown subcommand ${sub ?? '(none)'}.\n${USAGE}`);
  if (!isInt(target)) throw new Error(`${sub} needs a numeric id.\n${USAGE}`);
  const out: DemoArgs = { sub: sub as Subcommand, target: Number(target), as: null, prodOk: false, leaveJoin: false, config: undefined };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--as') {
      const v = rest[++i];
      if (!isInt(v)) throw new Error('--as needs a Telegram user id.');
      out.as = Number(v);
    } else if (a === '--prod-ok') out.prodOk = true;
    else if (a === '--leave-join') out.leaveJoin = true;
    else if (a === '--config') {
      out.config = rest[++i];
      if (!out.config) throw new Error('--config needs a path.');
    } else throw new Error(`Unknown option ${a}.\n${USAGE}`);
  }
  return out;
}

/** Admin ids from DEMO_ADMIN_IDS (comma list) plus the config's admins. */
export function adminIds(vars: Record<string, string | undefined>, configAdmins: number[] = []): Set<number> {
  const fromEnv = (vars.DEMO_ADMIN_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(isInt)
    .map(Number);
  return new Set([...fromEnv, ...configAdmins]);
}

/** True when this looks like production: NODE_ENV=production or the database lives under /data/. */
export function looksLikeProd(vars: Record<string, string | undefined>): boolean {
  const dbPath = vars.DATABASE_PATH ?? './data/groupie.db';
  return vars.NODE_ENV === 'production' || (dbPath !== ':memory:' && path.resolve(dbPath).startsWith('/data/'));
}

/** Throws unless the operator is an admin and, in production, passed --prod-ok. */
export function checkGuards(args: DemoArgs, vars: Record<string, string | undefined>, configAdmins: number[] = []): void {
  if (args.as === null) throw new Error('Refusing: pass --as <your Telegram user id>.');
  const admins = adminIds(vars, configAdmins);
  if (!admins.has(args.as)) throw new Error(`Refusing: ${args.as} is not in DEMO_ADMIN_IDS or the config's admins.`);
  if (looksLikeProd(vars) && !args.prodOk) {
    throw new Error(`Refusing: this looks like production (NODE_ENV=${vars.NODE_ENV ?? 'unset'}, DATABASE_PATH=${vars.DATABASE_PATH ?? 'default'}). Pass --prod-ok if you mean it.`);
  }
}
