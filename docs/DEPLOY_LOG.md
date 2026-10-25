# Deploy log

## Step 17: Canvas via Cubbie (2026-10-24)

- **Rollback point (main before merge):** `697daec6c847d7c60715f84801fd68d65ff96eac` ("steps 14 to 16: group Q&A, check-ins with progress card, private My Groupie chat")
- **DB backup:** `backups/pre-step17-20261024-1930.db` (local, gitignored), SQLite online backup of `/data/groupie.db`, `integrity_check` ok, `user_version` 6, groups=1 members=0 tasks=0. Made with `scripts/backup-db.sh pre-step17`.
- **Migration in this deploy:** 7 (cubbie pair codes, imports, calendar feeds and events, `groups.canvas_course`, `members.share_workload`). Additive only.
- **Rollback:** `git revert -m 1 <merge sha> && git push`, then confirm `/health`. Restore the DB from the backup only if migration 7 corrupted data (copy the file back onto the volume over `railway ssh`), and only after asking Divyam.
- **Deployed:** merge `b84b57777cefd0a1624f8724bcfd946e0907474c` on main, Railway deploy SUCCESS. Boot log clean, `user_version` 7, `integrity_check` ok, 4 new tables and `members.share_workload` present, existing group kept. Webhook set, 0 pending, no errors.
- **Env set with `scripts/railway-env.sh`:** `CUBBIE_PUBLIC_SIGNING_KEY` (64), `FEED_ENCRYPTION_KEY` (44), `LOAD_AWARE_SPLIT` (4). `CUBBIE_HMAC_SECRET` was never set on Railway, so nothing to delete.
- **Smoke tests (gate 3), all pass:** `/health`; `POST /api/cubbie/pair-code` with a signed Mini App session; status endpoint; first import through the real `cubbie-skill/scripts/send.py` accepted (no-group path, so nothing was posted in a group; one DM to the test account); reused code rejected (exit 8); bad signature 401; pair code without Telegram auth 401; non-ASU and plain-http feed URLs 400.
- **Note:** the first smoke run failed only because this Mac's python.org Python 3.12 has no CA bundle (`CERTIFICATE_VERIFY_FAILED` even on `/health`). Rerun with `SSL_CERT_FILE=/etc/ssl/cert.pem` passed. No production change was involved; local fix if wanted: run "Install Certificates.command" from the Python 3.12 folder.

## Hotfix: Canvas import usability (2026-10-24)

- **Rollback point:** `7e76c3601d58c8cff4253bdc2f79ba4cf8d0e0b9`. **Backup:** `backups/pre-hotfix-20261024-2021.db`, integrity ok, user_version 7, groups=2.
- **Why:** prod showed two pair codes created and never used: the student was never told to install the Skill in Cubbie, and "Open Messages" (an `sms:` link) cannot open from Telegram's in-app browser.
- **Change:** web Canvas screen (install step with a copyable "Install this skill" message, Copy as the main action, live check indicator, nudge after 90 s) and the `/canvas` reply text. No schema change.

## Step 18a: personal agents (2026-10-24)

- **Rollback point:** `4eef61616de9befaef074b855a514295ac80efc3` ("Merge hotfix/canvas-connect").
- **Backup:** `backups/pre-step18a-20261024-2038.db`, integrity ok, user_version 7, groups=2.
- **Migrations in this deploy:** 8 (user_memory, user_prefs, reminders_sent, calendar_connections, busy_blocks, groups.avail_deadline_at) and 9 (cubbie_links, cubbie_pair_codes.purpose). Additive only.
- **Deployed:** merge `647a1b9` on main, Railway SUCCESS, boot clean. `user_version` 9, integrity ok, all 6 new tables present, existing groups kept. Webhook set, 0 pending, no errors.
- **Smoke tests (all pass):** `/health`; `GET /api/me/prefs` (defaults 48/24/3); `GET /api/calendar/status` (`google_available=false` until per-user Google keys are set); `GET /api/me/memory`; memory without auth 401; `/api/cubbie/me` bad token 401; unsafe ICS link 400.
- **Skill republished:** `katsdivi/groupie-cubbie-skill` commit `8c1eec2` adds `link.py`, `status.py`, `groupie_link.py`. Secret scan clean (pattern grep, .env value comparison, gitleaks), kit validator OK, fresh clone runs `send.py --sample` and `status.py`.
