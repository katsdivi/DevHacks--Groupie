# Contract change requests (step 18a)

Agents: do not edit `apps/server/src/contextPolicy.ts` signatures, `packages/shared/src/agents.ts`, migration 8, or `db/schema.ts`. Append what you need here (who, what, why) and work around it. The lead resolves at integration.

## BRIDGE (personal Canvas import and iMessage link)

1. **`db/schema.ts` (additive, requested by the lead's task):** new table `cubbieLinks` and a `purpose` column (`'import' | 'link'`, default `'import'`) on `cubbiePairCodes`, matching migration 9 (appended; migration 8 untouched). `createPairCode` gained an optional fifth parameter `purpose`.
2. **`packages/shared/src/cubbieLink.ts` (new file, exported from `index.ts`):** `CubbieLinkRequest`, `CubbieLinkResponse`, `CubbieMeResponse`, `CUBBIE_LINK_RATE_LIMITS`, `CUBBIE_ME_DAYS`, `cubbieLinkMessage`. No change to `canvas.ts` or `agents.ts`.
3. **REMIND / POLICY, please note:** personal imports write `calendar_events` rows with uid prefix `cubbie-import-`. They are the student's own items like feed rows, so the reminder scheduler and private context pick them up with no change. If either agent filters by uid shape, keep this prefix.
4. **`index.ts`:** the raw body parser now also covers `/api/cubbie/link`, and `cubbieLinkRouter` is mounted at `/api/cubbie` before `/api`. Commands `imessage` and `unlink` were added to `setMyCommands`. If REMIND rewrites the command list, keep these two.
