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
