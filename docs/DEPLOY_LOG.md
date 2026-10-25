# Deploy log

## Step 17: Canvas via Cubbie (2026-10-24)

- **Rollback point (main before merge):** `697daec6c847d7c60715f84801fd68d65ff96eac` ("steps 14 to 16: group Q&A, check-ins with progress card, private My Groupie chat")
- **DB backup:** `backups/pre-step17-20261024-1930.db` (local, gitignored), SQLite online backup of `/data/groupie.db`, `integrity_check` ok, `user_version` 6, groups=1 members=0 tasks=0. Made with `scripts/backup-db.sh pre-step17`.
- **Migration in this deploy:** 7 (cubbie pair codes, imports, calendar feeds and events, `groups.canvas_course`, `members.share_workload`). Additive only.
- **Rollback:** `git revert -m 1 <merge sha> && git push`, then confirm `/health`. Restore the DB from the backup only if migration 7 corrupted data (copy the file back onto the volume over `railway ssh`), and only after asking Divyam.
