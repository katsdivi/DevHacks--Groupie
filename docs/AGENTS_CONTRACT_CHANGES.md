# Contract change requests (step 18a)

Agents: do not edit `apps/server/src/contextPolicy.ts` signatures, `packages/shared/src/agents.ts`, migration 8, or `db/schema.ts`. Append what you need here (who, what, why) and work around it. The lead resolves at integration.

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
