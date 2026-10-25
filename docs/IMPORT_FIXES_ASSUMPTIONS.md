# Import fixes: assumptions

Logged by the lead during the "Cubbie import fixes from the live phone test" run.

1. **Branch base.** `feat/import-fixes` is cut from `feat/step18` (28d1e74), not `main`. Step 18 rewrote the same files these fixes touch (`canvas/bot.ts`, `copy.ts`, `intake.ts`, `bot/index.ts`), so branching from `main` would mean redoing those merges. Step 18 is fully tested (385 server, 43 shared, a 2-run scripted dry run of the 5 demo moments) but not yet deployed, so this ship deploys step 18 and the import fixes together, with both sets of smoke tests (including step 18's restart-survives-DM-history check).

## Rejected import 1

Evidence (read-only: Railway HTTP logs, production DB via `railway ssh`; no secrets or assignment content printed).

- **Request:** `POST /api/cubbie/import` at 2026-10-25T04:18:03Z, UA `groupie-import-skill/1`, request id `EgwxIVeoS1u8hJ-ass7a6g`, ~8.1 KB in, **HTTP 422**, 87 bytes out, 26 ms (no LLM call).
- **Pair code DMMRYD:** purpose `import`, created 04:08:23Z by `POST /api/cubbie/pair-code` from the Mini App (iPhone UA), expires 04:23:23Z (so **not expired**), `used_at` 04:18:03Z, group -5305218337.
- **Group -5305218337 at the time:** status `setup`, `team_size` NULL, no assignment.
- **cubbie_imports row 2:** status `failed`, error `Set the team size first: send /setup in the group.`
- **Signature:** passed (a mismatch returns 401 before this point), so the installed Skill's key matches production. No reinstall needed for the key.
- **Payload shape (7,727 bytes stored):** top keys `pairCode, course, assignment, attachments`; `assignment` has `title, dueAt, pointsPossible, descriptionText, url`; description empty; **no rubric**; 1 attachment `{filename, mimeType (docx), text}` with 2,765 characters of extracted **text**, no `base64` bytes. Schema validation passed.

**Cause:** intake refuses an import while the group has no team size (`no_team_size`, mapped to 422). The Mini App's Canvas screen issues codes without that check (only the `/canvas` command checks it), and the importer claims the code before intake runs, so the failure also burned the code. Cubbie only showed the generic "rejected" line because the Skill does not map 422 / `no_team_size`.

**Fix:** imports land without a team size and the bot asks for it after the task list (import-fixes ROUTING); the code is marked used only after a successful import; every rejection returns one of the documented codes; the Skill maps them. Not a size limit, not a schema mismatch, not a signature mismatch.
