# Contract change requests (step 18a)

Agents: do not edit `apps/server/src/contextPolicy.ts` signatures, `packages/shared/src/agents.ts`, migration 8, or `db/schema.ts`. Append what you need here (who, what, why) and work around it. The lead resolves at integration.

- **REMIND (optional): export `OFFSET_CHOICES` from `packages/shared/src/agents.ts`.** The Mini App chips (72, 48, 24, 12, 6, 3, 1) and `apps/server/src/prefs.ts` each define the list. Worked around by duplicating it.
- **REMIND (optional): note in `PrefsUpdateRequest` that the server dedupes and sorts offsets.** No schema change needed; documentation only.
## CAL: busy block read API for SCHED (stable, no change needed to shared contracts)

`apps/server/src/busy.ts` exports, for SCHED and anyone else to read (do not write `busy_blocks` directly):

```ts
export type BusySource = 'google' | 'ics' | 'canvas';
export type BusyBlockView = { startAt: string; endAt: string; source: BusySource }; // UTC ISO, end exclusive
export function busyBlocksFor(telegramUserId: number, from: Date | string, to: Date | string): BusyBlockView[];
export function busyBlocksForUsers(telegramUserIds: number[], from: Date | string, to: Date | string): Map<number, BusyBlockView[]>;
export function busyBlockCount(telegramUserId: number, from?: Date, to?: Date): number; // default: next 14 days
export function hasCalendarConnection(telegramUserId: number): boolean; // Google or ICS connected (not Canvas alone)
```

`busyBlocksFor` returns blocks overlapping `[from, to)` (start < to and end > from), soonest first, never titles. Blocks cover the next 14 days from the last sync. Writes go through `replaceBusyBlocks(userId, source, intervals)` (atomic per user and source).

## CAL: requested (optional) contract additions

- `CalendarConnectionStatus.busy_block_count` per connection (and a `canvas_block_count`), so each card can show its own count. Today the Mini App shows the total for every card.
- A `failures` / `next_sync_at` column on `calendar_connections` so backoff survives restarts (today it is in memory).
- `.env.example`: add `GOOGLE_USER_CLIENT_ID=` and `GOOGLE_USER_CLIENT_SECRET=` (left for the lead to avoid a shared-file conflict).
## SCHED

1. **Busy reader (lead, at integration).** SCHED reads `busy_blocks` through its own read-only `apps/server/src/busyRead.ts` (`busySlotsFor(tgUserId, slotStarts)`, `prefillFor(member, tz)`), because CAL's helper is not in this worktree. Swap `busySlotsFor` for CAL's `busyBlocksFor` if you prefer one query path; the overlap rule is half-open (`start < slotEnd && end > slotStart`).
2. **Start the deadline job (lead, `apps/server/src/index.ts`).** Please add `import { startAvailDeadlines } from './bot/schedule.ts';` and call `startAvailDeadlines();` next to `startCalendarSync()` in the `app.listen` callback. It checks `groups.avail_deadline_at` every 5 minutes. Not edited by SCHED.
3. **Bot command list (lead, optional).** Add `{ command: 'deadline', description: 'Pick times by a deadline (24h, 48h, off)' }` to `setMyCommands` in `index.ts`.
4. **No schema change needed.** Candidates ride in the Confirm button; the open-poll guard reuses `groups.status = 'active'`. A future `meetings.status` or `groups.time_poll` column would make this explicit, but it is not required.
- **POLICY: `bot/index.ts` one-line registration.** `bot.filter((ctx) => ctx.chat?.type === 'private').use(dmComposer)` after `qaComposer`, so DM plain text gets a reply. Other agents adding DM handlers (BRIDGE `/canvas` in DMs, REMIND `/start`) should register before it; it ignores commands and pending inputs.
- **POLICY: `MemoryUpdateRequest` has no `key`.** The Memory screen edits values only. If renaming labels matters, add `key: z.string().trim().min(1).max(60).optional()`.
- **POLICY: `contextPolicy.ts` unchanged.** Bucket narrowing (`onlyMember`, `withoutTeammates`) and the DM context (`buildDmContext`) live in `context.ts` and only call `buildContext`. The lead may move them into contextPolicy.ts at integration.
## BRIDGE (personal Canvas import and iMessage link)

1. **`db/schema.ts` (additive, requested by the lead's task):** new table `cubbieLinks` and a `purpose` column (`'import' | 'link'`, default `'import'`) on `cubbiePairCodes`, matching migration 9 (appended; migration 8 untouched). `createPairCode` gained an optional fifth parameter `purpose`.
2. **`packages/shared/src/cubbieLink.ts` (new file, exported from `index.ts`):** `CubbieLinkRequest`, `CubbieLinkResponse`, `CubbieMeResponse`, `CUBBIE_LINK_RATE_LIMITS`, `CUBBIE_ME_DAYS`, `cubbieLinkMessage`. No change to `canvas.ts` or `agents.ts`.
3. **REMIND / POLICY, please note:** personal imports write `calendar_events` rows with uid prefix `cubbie-import-`. They are the student's own items like feed rows, so the reminder scheduler and private context pick them up with no change. If either agent filters by uid shape, keep this prefix.
4. **`index.ts`:** the raw body parser now also covers `/api/cubbie/link`, and `cubbieLinkRouter` is mounted at `/api/cubbie` before `/api`. Commands `imessage` and `unlink` were added to `setMyCommands`. If REMIND rewrites the command list, keep these two.
