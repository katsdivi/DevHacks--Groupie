# Contract change requests

Subagents: do not edit `packages/shared/src/canvas.ts` or the migration. Append what you need here (who, what, why) and work around it. The lead resolves these at integration.

## Skill agent (feat/canvas-skill)

No contract changes needed. Assumptions the server should match (or tell the Skill otherwise):

1. **Error body shape.** `POST /api/cubbie/import` errors are `{ "error": "<code>", "message": "..." }`, like the rest of the API. The Skill tells the three 409s apart by `error`: `code_used` and `code_expired` (ask for a fresh code) versus `not_expecting`. A 409 with any other `error` is treated as `not_expecting`.
2. **Success shape.** 2xx with `ok: true` is success; the Skill prints `message` (falls back to "Sent to Groupie. Check your group.").
3. **Signature.** `X-Groupie-Signature: sha256=<hex>` over the exact raw body bytes. The Skill sends compact JSON (`separators=(",", ":")`, UTF-8, non-ASCII kept) and signs those bytes; the server must verify against `rawBody`, never a re-serialized object.
4. **Pair code is uppercased and trimmed by the Skill** before signing, so the server sees `K7Q2MX` even if the student typed `k7q2mx`.
5. **Due dates.** The Skill requires seconds and a `Z` or `+HH:MM` offset (a subset of `z.string().datetime({ offset: true })`).
6. **Signing key placeholder.** `cubbie-skill/scripts/send.py` ships `GROUPIE_SIGNING_KEY = os.environ.get("GROUPIE_SIGNING_KEY") or "REPLACE_AT_PUBLISH"`. The lead must paste the server's `CUBBIE_HMAC_SECRET` into the public copy at publish time (README, Publishing). Until then every real import is a 401.
7. **Folder name.** The Skill is `name: groupie-import` but lives in `cubbie-skill/` here (assumption 2 in `CANVAS_ASSUMPTIONS.md`); publish it as a folder named `groupie-import`.

## UI agent (feat/canvas-ui): assumptions, no contract change needed

- **Upcoming day grouping uses the device time zone.** `MeResponse.group` has no `tz`, so Today/Tomorrow/weekday and due times follow the browser's local zone. If the lead adds `tz` to `MeResponse.group`, swap `dayKey`/`timeOf` in `apps/web/src/screens/Upcoming.tsx` to format in that zone.
- **"No feed" detection.** The spec does not say what `GET /api/feed/upcoming` returns when nothing is connected, so the Upcoming screen fetches `/feed/status` and `/feed/upcoming` in parallel and branches on `connected`.
- **`PUT /api/feed` response body is ignored.** After a successful PUT the UI refetches `/feed/status`. The pasted URL is cleared from state right after the PUT and never rendered again (the connected view shows a masked `feeds/••••` placeholder).
- **`sms:&body=` link.** `tg.openLink` is documented for http(s) only, so "Open Messages" is a real `<a href="sms:&body=...">`, tries `openExternal` first, and falls back to `location.href` if Telegram throws.
- **Pair code 404 while polling** is treated as expired. Network errors keep polling. Polling pauses while the page is hidden and stops on imported, failed, expired, or unmount. The countdown also flips the code to expired locally at `expiresAt`.
- **"Already has its assignment" rule** in the Canvas screen: status not in `setup`/`collecting_members`, or `task_count > 0 && joined > 0`. Then the import card shows a calm note and no code button; calendar sync still works.
- **Course colors** are a string hash of the full course name into `MEMBER_COLORS` (`apps/web/src/components/Course.tsx`); chips drop the trailing term, so "CSE 340 (Fall 2026)" reads "CSE 340".

## BRAIN agent (feat/canvas-brain)

1. **Wire the rubric into intake (lead / API agent).** `formatRubricContext(rubric)` is exported from `apps/server/src/parse.ts`. It takes `CubbieImportPayload['rubric']` (or undefined) and returns `''` or a `Rubric (criterion (points): ratings):` header plus one line per criterion, `Name (N pts): rating; rating`. The importer should pass it (joined with any other extra context) as `IngestInput.extraContext`. `parseAssignment` adds rubric rules to the system prompt (every criterion covered, effort follows points) whenever the extra context has that header or `Name (N pts):` lines; without a rubric the prompt is unchanged. `buildParseMessages()` is exported for tests.
2. **Calendar reads live in `apps/server/src/calendarQueries.ts`** (read only, `removed_at` rows excluded, dates compared parsed, not as strings). Course matching uses `courseCode()` / `sameCourse()`: `CSE 340 (Fall 2026)` matches `CSE 340: Software Engineering`. If neither side has a code, names are compared case-insensitively. A null event course never matches a group.
3. **Busy tag is behind `LOAD_AWARE_SPLIT` too.** Assumption: item 2 of the brief is all behind `env.loadAwareSplit`, so the "Busy week · N due" tag on the split card only appears when the flag is on. The tag shows a count only, never titles.
4. **`split()` 4th parameter** `options?: { load?: Record<memberId, number> }`. Key order is now gap, skill fit, load cost, spread. With load, the no-load answer is polished under the load key (plus a whole-set exchange between two members) and a fresh search runs; the gap-first key means max gap and fit are never worse. No load, `{}`, or all zeros give byte-identical results. `planSwap` is unchanged (swaps still move the fewest tasks).
5. **Check-ins** (`runCheckin`, both `/checkin` and the Monday job) append `weekAheadText()`: this group's course items due in the next 7 days, then "Name has N other things due this week" per member. Nothing is added when the group has no `canvasCourse` (assumption #9).
6. **Pre-existing typecheck failure fixed:** `packages/shared/src/canvas.test.ts` imports `node:fs` but `@groupie/shared` had no `@types/node`, so `pnpm typecheck` failed on the base commit. Added `@types/node` (same range as the server) to `packages/shared` devDependencies (lockfile updated, installed offline).
