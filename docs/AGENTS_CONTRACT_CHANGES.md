# Contract change requests (step 18a)

Agents: do not edit `apps/server/src/contextPolicy.ts` signatures, `packages/shared/src/agents.ts`, migration 8, or `db/schema.ts`. Append what you need here (who, what, why) and work around it. The lead resolves at integration.

## SCHED

1. **Busy reader (lead, at integration).** SCHED reads `busy_blocks` through its own read-only `apps/server/src/busyRead.ts` (`busySlotsFor(tgUserId, slotStarts)`, `prefillFor(member, tz)`), because CAL's helper is not in this worktree. Swap `busySlotsFor` for CAL's `busyBlocksFor` if you prefer one query path; the overlap rule is half-open (`start < slotEnd && end > slotStart`).
2. **Start the deadline job (lead, `apps/server/src/index.ts`).** Please add `import { startAvailDeadlines } from './bot/schedule.ts';` and call `startAvailDeadlines();` next to `startCalendarSync()` in the `app.listen` callback. It checks `groups.avail_deadline_at` every 5 minutes. Not edited by SCHED.
3. **Bot command list (lead, optional).** Add `{ command: 'deadline', description: 'Pick times by a deadline (24h, 48h, off)' }` to `setMyCommands` in `index.ts`.
4. **No schema change needed.** Candidates ride in the Confirm button; the open-poll guard reuses `groups.status = 'active'`. A future `meetings.status` or `groups.time_poll` column would make this explicit, but it is not required.
