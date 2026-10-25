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

## SKILL

Logged by the Skill agent (branch `feat/import-fixes-skill`, `cubbie-skill/` only). Skill version 2, user agent `groupie-import-skill/2`.

1. **The error code decides, not the HTTP status.** `send.py` reads `error` from the `{ error, message, requestId }` body. Any code outside the documented list, a missing code, a body that is not JSON, a timeout or a network error gets the "hit a snag" line. One exception: a 413 with no JSON (a proxy or body parser limit, not our handler) counts as `payload_too_large`, so the text retry still happens.
2. **Old names still work.** `unknown_code` is read as `code_unknown` and `bad_payload` as `invalid_payload`, so the Skill and the server can ship in either order. The current production `no_team_size` 422 maps to the "hit a snag" line (exit 11), which is right once the server stops refusing imports without a team size.
3. **stdout is only for the student.** stdout holds the line or lines Cubbie texts word for word; stderr holds `error: <code> (HTTP n)` and `requestId: <id>` (only when the id matches `[A-Za-z0-9_.:-]{1,100}`, so arbitrary server text is never echoed). Exit codes 2 and 4 (Cubbie must fix the file) print nothing on stdout. A bad code format (exit 3) now prints the student line on stdout too.
4. **Exit codes.** 0 sent, 2 args, 3 code format, 4 local payload problem, 5 unreachable or timeout, 6 `invalid_payload`, 7 `bad_signature`, 8 `code_expired` / `code_unknown`, 9 `not_expecting`, 10 `rate_limited`, 11 `server_error` and everything unrecognized, 12 `code_used` (new, split from 8 because the line differs), 13 `payload_too_large` after the retry (new). 5, 6 and 11 share the "hit a snag" line but keep their own codes for diagnosis.
5. **Too-big retry.** On `payload_too_large` with attachments, the script prints "The files are too big to send. I'll send the assignment text instead.", drops the `attachments` key, re-signs and sends once more, then prints that result with the same mapping. If the second try is also too big, the student sees the too-big line once and then the "hit a snag" line (exit 13); the description is already capped at 60,000 characters by local validation, so this should be rare. With no attachments to drop there is no retry and no too-big line, only "hit a snag" (exit 13), since "I'll send the text instead" would be false. Network retries (one, on a connection error) are unchanged and separate.
6. **"Your code still works" is a server promise.** The snag line assumes the server's import-fixes change marks the code used only after a successful import. If that change does not ship, the line would be wrong after an `invalid_payload` or `server_error`.
7. **30 minutes** replaces 15 minutes for import pair codes in `send.py`, `SKILL.md` and `README.md`. The `/imessage` link code line in the README still says 15 minutes because that code is not part of this change.
8. **Link and status scripts** only got the user agent bump; their failure lines are unchanged (out of scope for the rejected import).
9. **Secrets.** `GROUPIE_SIGNING_KEY` in `send.py` is still the `REPLACE_AT_PUBLISH` placeholder (env override kept), pasted in by the lead at publish time as the README says; its value was not touched. Nothing else secret is in `cubbie-skill/` (test tokens are fakes).
10. **Tests.** `python3 -m unittest discover -s cubbie-skill/tests`: 55 tests (was 35), including `tests/test_send_errors.py` against the harness's local plain-HTTP stub (one test per mapping, the too-big retry both ways, HTML body, closed port, timeout). `python3 cubbie-skill/tests/harness.py` covers the same codes and passes.
