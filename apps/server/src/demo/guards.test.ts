import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { checkGuards, looksLikeProd, parseArgs } from './guards.ts';
import { DemoConfig, repoRoot } from './config.ts';

const dev = { NODE_ENV: 'development', DATABASE_PATH: './data/groupie.db' };

describe('demo CLI guards', () => {
  it('parses subcommands and flags', () => {
    expect(parseArgs(['seed', '-100123', '--as', '42', '--leave-join'])).toMatchObject({ sub: 'seed', target: -100123, as: 42, leaveJoin: true, prodOk: false });
    expect(() => parseArgs(['drop', '1'])).toThrow(/Unknown subcommand/);
    expect(() => parseArgs(['reset', 'abc'])).toThrow(/numeric id/);
    expect(() => parseArgs(['reset', '1', '--as'])).toThrow(/--as needs/);
    expect(() => parseArgs(['reset', '1', '--force'])).toThrow(/Unknown option/);
  });

  it('refuses every subcommand without --as', () => {
    for (const sub of ['reset', 'seed', 'remind', 'warm']) {
      expect(() => checkGuards(parseArgs([sub, '1']), dev, [42])).toThrow(/pass --as/);
    }
  });

  it('refuses an --as that is not an admin, accepts env or config admins', () => {
    const args = parseArgs(['reset', '1', '--as', '42']);
    expect(() => checkGuards(args, dev, [7])).toThrow(/not in DEMO_ADMIN_IDS/);
    expect(() => checkGuards(args, { ...dev, DEMO_ADMIN_IDS: '7, 42' })).not.toThrow();
    expect(() => checkGuards(args, dev, [42])).not.toThrow();
  });

  it('refuses production without --prod-ok', () => {
    const vars = { NODE_ENV: 'production', DATABASE_PATH: '/data/groupie.db', DEMO_ADMIN_IDS: '42' };
    for (const sub of ['reset', 'seed', 'remind', 'warm']) {
      expect(() => checkGuards(parseArgs([sub, '1', '--as', '42']), vars)).toThrow(/looks like production/);
      expect(() => checkGuards(parseArgs([sub, '1', '--as', '42', '--prod-ok']), vars)).not.toThrow();
    }
    // A /data path alone counts, and so does NODE_ENV alone.
    expect(looksLikeProd({ DATABASE_PATH: '/data/groupie.db' })).toBe(true);
    expect(looksLikeProd({ NODE_ENV: 'production', DATABASE_PATH: './x.db' })).toBe(true);
    expect(looksLikeProd({ DATABASE_PATH: ':memory:' })).toBe(false);
    expect(looksLikeProd(dev)).toBe(false);
  });

  it('the example config is valid', () => {
    const raw = fs.readFileSync(path.join(repoRoot(), 'demo.config.example.json'), 'utf8');
    expect(DemoConfig.safeParse(JSON.parse(raw)).success).toBe(true);
  });
});
