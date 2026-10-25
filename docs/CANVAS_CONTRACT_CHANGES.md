# Contract change requests

Subagents: do not edit `packages/shared/src/canvas.ts` or the migration. Append what you need here (who, what, why) and work around it. The lead resolves these at integration.

## API agent (feat/canvas-api)

No contract edits needed. Assumptions and choices made while building `apps/server/src/canvas/`:

1. **No ICS dependency.** Canvas feeds are simple, so `canvas/ics.ts` is a small hand-written reader (line unfolding, escapes, UTC/TZID/floating/all-day dates via luxon). Nothing was added to `package.json`.
2. **Extra status codes.** `503 imports_off` when `CUBBIE_HMAC_SECRET` is empty. `503 feeds_off` on `PUT /api/feed` when `FEED_ENCRYPTION_KEY` is missing or not 32 bytes. `400 bad_feed_url` for a feed outside `https://canvas.asu.edu/feeds/`. `403 telegram_only` on canvas routes called with a browser link instead of Telegram auth. `422 <reason>` (`too_short`, `no_team_size`, `busy`, `failed`) when the intake itself fails for a reason other than `not_expecting`; body is `{ error, message }`.
3. **No-group import.** Answers `200` with `CubbieImportResponse` and the message "Groupie got it, but this code was not made in a group. Check your Telegram messages from Groupie." The import row is `failed` and the student gets a DM.
4. **not_expecting is checked before the code is used.** If the code's group is not expecting an assignment, the import is refused with `409 not_expecting` and the code stays unused. A `not_expecting` from the intake itself (race) also maps to 409.
5. **Order of checks on import:** secret configured, signature, JSON and zod, per-IP limit, code lookup, per-owner limit, used, expired, not_expecting, atomic claim (`UPDATE ... WHERE used_at IS NULL AND expires_at > now`).
6. **Client IP for rate limits** is the last `X-Forwarded-For` hop (Railway's proxy appends the real client), falling back to the socket address. Rate limit windows are in memory, so they reset on restart.
7. **Ingest wait.** The import waits up to 25 s for `ingestAssignment`, then answers ok and lets it finish in the background; the import row is updated when it does.
8. **Stored payload** drops `attachments[].base64` and keeps `base64Length` instead.
9. **Backoff** after the Nth failed poll in a row: `min(12 h, 30 min * 2^(N-1))`. A body that is not a calendar is a failure, never "all events removed".
10. **`PUT /api/feed`** waits up to 10 s for the first poll so the response usually already has events. Saving a feed resets etag, failures, and errors.
11. **`/canvas` in a DM** replies with "send this in your project group". In a group with no team size it asks for `/setup` first, since the intake would refuse the import anyway.
12. **`POST /api/cubbie/pair-code`** does not check whether the group is expecting an assignment; the import does.
