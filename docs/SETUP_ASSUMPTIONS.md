# Easy setup: assumptions

Four parallel tracks, merged on `integrate/easy-setup` (2026-10-25).

## Developer setup (`pnpm bootstrap`, `pnpm start:local`, `pnpm run doctor`, `docker compose up`)

- `pnpm setup` and `pnpm doctor` are pnpm built-ins that win over scripts, so setup is `pnpm bootstrap` and doctor runs as `pnpm run doctor`.
- The wizard asks only for `BOT_TOKEN`, `GROQ_API_KEY` and an optional `CUBBIE_HANDLE`, and generates `WEBHOOK_SECRET`, `LINK_SIGNING_SECRET`, `FEED_ENCRYPTION_KEY` and `CUBBIE_PUBLIC_SIGNING_KEY` as four distinct values. Existing values are kept; it prints names and lengths only.
- `BOT_USERNAME` is the one value it overwrites, from `getMe`, because `.env.example` ships the production username.
- A bot with a webhook is treated as production: `BOT_MODE` goes to `off`, even if `.env` said `polling`. Safety beats idempotency.
- Fixed in passing: an empty `BOT_MODE=` (as copied from `.env.example`) used to fall through to polling locally and delete the production webhook. Empty now means the default (`off` locally, `webhook` in production). Production is unaffected.
- `--yes` and non-TTY runs read the three values from the shell environment.
- The Mini App row in doctor checks config only (https `PUBLIC_URL`); it cannot see what BotFather has registered.
- Local Mini App needs an https tunnel plus a BotFather URL change for the test bot, because `appUrl` uses `t.me/<bot>/<short name>`.
- `docker compose` was validated with `docker compose config` only (no Docker daemon on the build machine).

## Student setup (DM `/start` and `/setup`, group `/setup`, Mini App Finish setup card)

- Six steps: project group, details, calendar, Canvas feed, iMessage linked, reminders.
- "In a project group" means a member row, an import code or an import for that group; Telegram membership alone is not visible to the bot.
- In a DM the checklist is about the first joined group, else the newest group with an import; in the Mini App it is about the open group.
- Reminders count as done when the bot can DM the student; turning reminders off on purpose is not nagged.
- Calendar counts Google or ICS with a saved secret; Canvas-derived busy blocks do not. The Canvas step is the calendar feed only.
- The iMessage step reuses the `/imessage` link flow (a code is made only on tap, plus a `/start imessage` deep link). It works without `CUBBIE_HANDLE`.
- `stageCopy.test.ts` freezes the stage strings. They were updated once, on purpose, for the shorter copy below.

## Shorter bot copy

- `/help` is 12 lines (was 20), DM `/start` leads with the checklist plus "Send /help to see everything I do."
- The `/canvas` code replies dropped "add the assignment name if you have several" and "Cubbie reads the assignment from Canvas"; Cubbie still asks which assignment when there are several.
- Moment 4 lines, the reminder header, button labels and callback data are unchanged, so `DEMO_RUNBOOK.md` needs no edits. The dry run after the merge passed 18 of 19, the same parse-dependent busy line as runs 2 to 4 (covered by the rehearsal gate).
- Data-sized replies (task list, meeting card, plans) and the email bodies were left as they are.

## README

- Hero chat lines in the SVG ("Fair split posted. Max difference: 1 pt", "Best time: Sun 4 to 5 PM. Invite sent.") are illustration, not exact bot strings.
- Video scenes for features not in this codebase (team emails, reply checking) were left out.
- The demo GIF (1.7 MB) is committed; the source .mp4 stays out of git.

## Follow-ups ("it", "that", "she")

- Before the quick checks and the classifier, a short model call rewrites a follow-up into a standalone message. It runs only when the message has a referring word ("it", "they", "she", "that" standing alone; not "this week") and there is something to refer to.
- Group: the thread is the last 6 addressed questions and Groupie's group answers, kept in memory for 20 minutes (lost on restart, which is fine for follow-ups). The notes add the project title and due date, and the text of a bot message being replied to. All of it was already posted in the group, so no private data reaches the rewrite.
- DM: the rewrite uses the sender's own last 6 DM messages, and runs only for asks a quick check could catch (send, give, file, pdf...). The DM model already sees the history, so other DMs need no rewrite.
- Injection attempts are checked on the raw text first and never rewritten. A rewrite that names a teammate goes down the member path, so "what are her grades?" gets the same share line as "what are Ava's grades?".
- The rewrite says "the assignment" for the project, and a known assignment title also counts as "assignment" in the file check, so "send it to me" sends the file.
- On failure, an empty answer, multiple lines or a much longer answer, the original message is used.
- Demo: none of the moment 4 questions has a referring word, so the demo makes no extra calls (dry run 18 of 19, unchanged).
