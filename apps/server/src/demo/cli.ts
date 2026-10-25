/**
 * Demo operator CLI. Never reachable from Telegram or HTTP: it only runs from a shell.
 *   tsx src/demo/cli.ts reset  <groupChatId>    --as <adminId> [--prod-ok] [--reparse]
 *   tsx src/demo/cli.ts seed   <groupChatId>    --as <adminId> [--prod-ok] [--leave-join | --before-import] [--config <path>]
 *   tsx src/demo/cli.ts fill   <groupChatId>    --as <adminId> [--prod-ok] [--config <path>]
 *   tsx src/demo/cli.ts remind <telegramUserId> --as <adminId> [--prod-ok]
 *   tsx src/demo/cli.ts warm   <groupChatId>    --as <adminId> [--prod-ok]
 * Guards run before the database module loads: --as must be an admin, and production needs --prod-ok.
 */
import { checkGuards, parseArgs } from './guards.ts';
import { loadConfig, presenterOf } from './config.ts';

async function main(argv: string[]) {
  const args = parseArgs(argv);
  const config = loadConfig(args.config);
  checkGuards(args, process.env, config?.admins ?? []);
  // Warm exists to fill the cache, so it always runs in demo mode. Set before env.ts loads.
  if (args.sub === 'warm') process.env.DEMO_MODE = 'true';
  const dbPath = process.env.DATABASE_PATH ?? './data/groupie.db';
  console.log(`demo ${args.sub} ${args.target} as ${args.as} (database ${dbPath})`);

  if (args.sub === 'reset') {
    const { resetGroup } = await import('./reset.ts');
    const out = resetGroup(args.target);
    if (!out.found) throw new Error(`No group ${args.target} in this database.`);
    if (args.reparse) {
      const { dropParses } = await import('./llmCache.ts');
      console.log(`Dropped ${dropParses()} cached assignment parse(s): the next import parses fresh.`);
    }
    console.log('Reset done. Group row kept, status back to setup. Rows removed:');
    for (const [k, v] of Object.entries(out)) if (k !== 'found' && v) console.log(`  ${k}: ${v}`);
    return;
  }

  if (args.sub === 'seed') {
    if (!config) throw new Error('No demo config. Copy demo.config.example.json to demo.config.json, or pass --config.');
    const { seedGroup } = await import('./seed.ts');
    const s = seedGroup(args.target, config, { leaveJoin: args.leaveJoin, beforeImport: args.beforeImport });
    console.log(args.beforeImport ? 'Seeded the group for a live import (no assignment, nobody joined).' : `Seeded "${config.group.assignmentTitle}" (${config.group.course}).`);
    console.log(`  status: ${s.status}, team size ${s.teamSize}, ${s.tasks} tasks`);
    console.log(`  joined: ${s.members.join(', ') || 'nobody yet'}`);
    if (s.waitingToJoin.length) console.log(`  not joined yet: ${s.waitingToJoin.join(', ')}`);
    console.log(`  Canvas items: ${s.canvasItems}, busy blocks: ${s.busyBlocks}`);
    console.log(`  reminder item due ${s.soonItemDue} (run remind now for the reminder moment)`);
    return;
  }

  if (args.sub === 'fill') {
    if (!config) throw new Error('No demo config. Copy demo.config.example.json to demo.config.json, or pass --config.');
    const { fillTeam } = await import('./seed.ts');
    const f = fillTeam(args.target, config);
    console.log(`Joined ${f.added.join(', ') || 'nobody new'}. ${f.joined}/${f.teamSize} on the team.`);
    const { refreshJoinStatus } = await import('../bot/joinStatus.ts');
    await refreshJoinStatus(args.target);
    if (f.full) {
      const { maybeRunSplit } = await import('../bot/split.ts');
      await maybeRunSplit(args.target);
      console.log('Team full: the split card is posted in the group.');
    } else console.log('Not full yet: the split posts when the last person joins.');
    return;
  }

  if (args.sub === 'remind') {
    const { remindUser } = await import('./remind.ts');
    const { bot } = await import('../bot/core.ts');
    const res = await remindUser(args.target, new Date(), { send: (userId, text, extra) => bot.api.sendMessage(userId, text, extra) });
    if (!res.sent) throw new Error(`Nothing sent to ${args.target}: ${res.reason}${res.detail ? ` (${res.detail})` : ''}.`);
    console.log(`Sent ${args.target} one DM with ${res.items} item(s):\n\n${res.text}`);
    return;
  }

  const presenter = config ? presenterOf(config).telegramUserId! : args.as!;
  const { warmGroup } = await import('./warm.ts');
  const res = await warmGroup(args.target, presenter);
  for (const s of res.steps) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.prompt}\n     ${s.reply.replace(/\n/g, '\n     ').slice(0, 400)}`);
  console.log(`Cache entries: ${res.cacheBefore} before, ${res.cacheAfter} after. Telegram calls stubbed: ${res.stubbedTelegramCalls}.`);
  if (res.steps.some((s) => !s.ok)) process.exitCode = 1;
}

main(process.argv.slice(2)).then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
