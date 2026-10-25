# Canvas build: assumptions and deviations

Logged during the step 17 build so nobody has to ask mid-run. Newest last.

1. **SQLite, not Postgres.** The plan's `payload jsonb` is a TEXT column with Drizzle's JSON mode. Migrations are appended to `MIGRATIONS` in `apps/server/src/db/index.ts` (migration 7), not a separate migration tool.
2. **Folder names.** The plan's `server/canvas/` is `apps/server/src/canvas/`, `miniapp/` is `apps/web/src/`, shared types live in `packages/shared/src/canvas.ts`, and the Skill is `cubbie-skill/` at the repo root.
3. **HMAC secret is public.** Cubbie cannot host team keys (kit `cubbie-auth.md` L43-45), so `CUBBIE_HMAC_SECRET` ships inside the public Skill. It is kept for integrity and spam friction; the security comes from single-use, 15 minute pair codes plus rate limits.
4. **No Cubbie feed handoff.** A Canvas calendar feed URL is a per-user credential and the kit forbids sending credentials to a team's server (`cubbie-auth.md` L46-47). `POST /api/cubbie/feed` and the "Groupie calendar" trigger are not built. Students paste the feed URL in the Mini App.
5. **Attachments as text.** Cubbie reads PDFs and course files, but nothing documents handing raw bytes to a Skill script. The Skill sends `attachments[].text`. The server still accepts `base64` (through the normal file intake) and `url` (display only; Canvas file links need a login).
6. **Rubric is optional and not requested separately.** The kit does not list rubrics. The Skill sends whatever the assignment returns; if a rubric arrives it becomes task hints.
7. **Pair codes are per Telegram user, optionally tied to a group.** An import whose code has no group is stored and the student is told (by DM) to make the code from inside a group. Imports only post when the group is still expecting its assignment (same rule as file uploads).
8. **Canvas due date wins.** When an import has `dueAt`, it overrides whatever date the LLM found in the text.
9. **Group course scoping.** A Cubbie import saves the Canvas course name on the group (`groups.canvas_course`). Group answers only include calendar items whose course matches it. Before any import, group answers include no calendar items at all.
10. **Extra commands and endpoints.** Added `/canvas` (group command that makes a pair code), `GET /api/cubbie/pair-code/:code` (live status for the Mini App), and `GET /api/feed/upcoming` (the Upcoming screen). The plan implied these without naming them.
11. **Skill publishing.** Cubbie only installs Skills from a public git repo; our main repo is private. The Skill lives in `cubbie-skill/` here and must be copied to a public repo (for example `katsdivi/groupie-cubbie-skill`) before anyone can install it. Not done in this run (no pushes).
12. **Feed host.** Only `https://canvas.asu.edu/feeds/...` is accepted; `webcal://` is rewritten to `https://`.
