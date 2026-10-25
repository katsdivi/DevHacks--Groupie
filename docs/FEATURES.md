# Groupie: complete feature list

Groupie is "your group project's biggest fan": a Telegram bot (@CubbieGroupieBot) plus a Telegram Mini App that splits a group assignment fairly, finds a meeting time, sends the invite, keeps everyone on track, and pulls the assignment straight from Canvas through Cubbie. Built for the Cubbie Hackathon, Track 3 (Group Chat Assistant).

Live at https://devhacks-groupie-production.up.railway.app. API details: `API.md`. Canvas details: `docs/CANVAS_RECON.md`, `docs/CUBBIE_CAPABILITIES.md`.

---

## 1. Joining a group and personality

- **Welcome on join.** When added to a group (or re-added), Groupie introduces itself: "Hey, I'm Groupie, your group project's biggest fan. Want to give me a nickname for this group?" with **[Name me]** and **[Keep Groupie]**.
- **Per-group nickname.** [Name me] sends a force-reply prompt to whoever tapped; their next message (within 2 minutes) becomes the name. Validated: 1 to 20 characters, letters, numbers, spaces and basic punctuation. Confirms "Call me Max from now on."
- **Rename any time.** `/rename` (prompt) or `/rename Nova` (direct), the **[Rename]** button in `/settings`, or the Settings screen in the Mini App. Announces "New name, who dis. I'm Nova now."
- **Nickname everywhere.** Used in bot messages ("Motu here."), card footers ("Split by Motu", "Tracked by Motu"), the Mini App header, and the Q&A persona.
- **Voice.** Warm, upbeat, a little cheeky superfan. No em dashes anywhere; replies use names or they/them, never guessed pronouns.
- **Supergroup upgrades.** When Telegram moves a group to a new id, all of its data moves with it.
- **Private chat fallback.** Group-only commands sent in a DM get a friendly "that works in your project group chat" reply instead of silence.
- **Command menu.** Telegram's command list is set automatically (help, app, setup, join, split, avail, deadline, checkin, progress, canvas, imessage, unlink, meetlink, settings, rename).
- **`/start` and `/help` explain everything.** In a DM: the full feature guide plus an [Add me to a group] button. In a group: the same guide with the group's nickname and [Open Groupie].

## 2. Setup and assignment intake

- **Team size.** After naming, "How many people are on this project?" with **[2] [3] [4] [5] [6]**, plus the real head count of the chat first (for example "2 (everyone here)"). The message edits in place to "Team of 5. Love that for us. Now drop the assignment PDF..." with **[Change team size]**. `/setup` restarts it.
- **Drop any assignment file.** PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), OpenDocument (.odt, .odp, .ods), RTF, HTML, EPUB, Markdown, CSV and plain text. Google Docs exports work as .docx or .pdf.
- **Helpful refusals.** Old .doc/.ppt/.pages files: "Save it as PDF or .docx". Unknown formats: lists what works. Photos: "Send it as a file instead". Scanned PDFs with no text: asks for selectable text. Files over 20 MB: asks for a smaller one.
- **Only listens when it should.** Files shared after people have joined (drafts, notes) are ignored, so the bot never hijacks the chat.
- **LLM task breakdown.** Groq `openai/gpt-oss-120b` with strict JSON output turns the document into 6 to 14 tasks: title, one-line description, effort in {1, 2, 3, 5, 8}, and skill tags from a fixed list (writing, research, coding, design, data, presenting, editing, math). Always ends with "Integrate and proofread". Finds the assignment title and due date.
- **Robust parsing.** Long documents are trimmed to about 18,000 characters, keeping the start plus rubric, requirements and deliverables sections. Unknown tags are dropped and efforts snapped to the allowed values in code, so one odd token never fails the import. Retries once, then falls back to `qwen/qwen3.8-27b`. Rate limits (429) back off with a "Thinking, one sec..." update.
- **Live progress message.** "Reading <file>. Give me a sec..." with typing indicators, edited into the final task list: "Got it: <title>, Due <date>, N tasks, N points" with each task's points.
- **Re-upload before anyone joins** replaces the task list; one upload at a time per group.

## 3. Joining the team

- **Join status message.** "Got it: N tasks, N points. Everyone tap below to add your details." with **[Add my details]** (opens the Mini App form). Edits live as people join: colored dots per member, open seats as white dots, "2/5 joined", then "Everyone's in. Love this team."
- **Member colors.** Six accents (coral, amber, lime, cyan, violet, pink) assigned in join order and used on every card and screen.
- **`/join`** reposts the status message if it scrolled away.
- **Team full guard.** New joiners are refused once the team size is reached; existing members can always edit their details.

## 4. The fair split (core feature)

- **Code, not the LLM, balances the work.** A pure, tested algorithm: largest tasks first to the lightest member, ties broken by skill fit (+1 per matching skill, -1 per weak area), then local search (moves and pairwise swaps) to shrink the max difference, then seeded restarts to escape plateaus. Deterministic: same input, same output.
- **Guarantees (tested).** Every task assigned exactly once; max difference never worse than plain greedy; reaches the best possible gap in tested cases (for example 10/10/10/10/9 for 49 points across 5).
- **Automatic.** The moment the last seat fills, the split runs and the split card posts.
- **Split card image.** 1080 px wide, rendered with Playwright: assignment title, due date, task and point totals, "Fair split" badge, one row per member (color chip, name, task pills with points, total, balance bar), footer "Max difference: N pt" and "Split by <nickname>". Inter font bundled; renders in about 0.2 to 0.8 s with a reused browser.
- **[Looks fair (n/N)].** One vote per person, counted on the button; seeded pretend teammates cannot vote. Votes on an old card are refused ("Vote on the newest card!"); "Unanimous. I might cry." when everyone agrees.
- **[Request swap]** opens the swap flow in the Mini App.
- **`/split`** reposts the current card.

## 5. Swaps

- **Pick a task, then who takes it** (a teammate or "Anyone, let Motu decide"), in the Mini App split screen, with a projected "9 now, 11 with this" and the max difference after the swap.
- **Minimal disruption.** The task moves plus at most two compensating moves; everyone else keeps their tasks. A full rebalance is used only if it is more than 2 points fairer.
- **Remembers.** The requester never gets that task back in later rebalances; a named recipient keeps it.
- **Fresh card.** "Swap done. <task> moved from <A> to <B>. Max difference: N pt." The old card loses its buttons and "Looks fair" votes reset.

## 6. Availability and the meeting time

- **"When is everyone free?" message** after the split, with **[Fill your availability]** and **[Lock it now]**; edits live to "3/5 responded" with colored dots.
- **Availability grid (Mini App).** 7 days by 30-minute rows, 9 AM to 10 PM in the group's time zone (handles daylight saving). Drag to paint in your color; the first cell decides add or remove; no page scroll while dragging; fast swipes fill gaps; past cells hatched; "now" line; painted runs merge into labeled blocks. Autosaves with a debounce ("Saving...", "Saved", "Offline, retrying"), never losing edits made during a save. Works with touch and with a mouse.
- **Group heatmap.** Toggle Mine / Group: cells shaded by how many are free, the best hour outlined and labeled "Best", a "Best time" card with free members, "N/M responded" chips, and tap-a-cell to see who is free.
- **Browser links for people not on Telegram.** Signed, per-member links (14 days) open the same grid in any browser. Scoped: a link can only read and write its own member's availability. Expired or forged links show a friendly message.
- **Auto lock.** When everyone has responded (or someone taps [Lock it now] with at least 2 responses), Groupie picks the best one-hour window (most people free for the whole hour, then earliest) and posts "Best time: Sun, Oct 25 · 4 to 5 PM" with who is free and who cannot make it.
- **How to meet poll.** A non-anonymous Telegram poll: Google Meet, Zoom, In person. Then **[Send Calendar Invite]**.
- **`/avail`** reposts the availability message.

## 7. Meeting links, calendar, email and DMs

- **Closes the poll and picks the winner** when [Send Calendar Invite] is tapped (ties go to the first option). Repeat taps say "Already sent".
- **Asks for the link or place.** "Reply with the Zoom link", "the Google Meet link", or "where are we meeting?", with **[Skip for now]**. Validates links (and places up to 120 characters).
- **`/meetlink <link or place>`** sets or changes it any time and reposts everything.
- **Google Calendar (when keys are set).** Creates the event on the authorized account with a real Google Meet link (conference data), the team as attendees, invites emailed by Google (`sendUpdates=all`), and a 15-minute reminder.
- **Gmail.** If the calendar call fails, Groupie emails the details itself (HTML plus text, with the .ics attached). Teammates who are only reachable by email get their availability link by email.
- **Meeting card in the group.** "Team meeting is on!" with time, time zone, where, link, and who, plus **[Join Meet/Zoom]**, **[Add to Google Calendar]** (works without our keys), and **[Open calendar event]**.
- **.ics file** posted for Apple Calendar, Outlook, or any calendar app.
- **DMs.** Every member who has started the bot gets the meeting privately; the group sees "Sent the details to N of M", with a nudge for the rest.
- **One-time setup.** `pnpm google:auth` opens Google consent (Calendar events and Gmail send) and saves the refresh token.

## 8. Ask the bot ("Motu, ...") and chat in DMs

- **Addressed by nickname or "Groupie"** at the start ("hi Motu"), at the end ("thanks Groupie"), or anywhere in a short message, plus @mentions and replies to Groupie. A bare "hi" is ignored, so it never spams.
- **Three kinds of questions.** About the project: answered in the group. About yourself ("what do I have due?"): the group-safe part in the group, the private part by DM ("Sent you the rest in DM.", or a Start hint if Groupie cannot DM you). About a teammate: only from what they shared with the group, otherwise "That's Ava's to share."
- **DM conversations.** Any message in a private chat gets a real reply using your own context (your tasks, groups, memory, Canvas items). The Telegram DM history is saved per person (the newest 50 messages, the last 12 go to the model), so it survives restarts; `/forgetchat` or Settings > "Clear my chat with <nickname>" wipes it (tasks, reminders and memory stay).
- **"Send me the assignment".** In the group ("Motu, send me the pdf") or in a DM ("can I get the assignment file?"), Groupie sends the assignment itself, with no model call: the original file when one reached the group (dropped in, or sent as bytes from Canvas), otherwise a clean PDF made from the text it read (Canvas text says so in the caption). A DM uses the newest assignment from your own groups. Groupie never fetches anything from Canvas itself.
- **Questions about the instructions.** The assignment's own text (from the file, a paste, or Canvas) is part of the group facts, so "Motu, how long should the report be?" is answered from the instructions.
- **Wrong app.** "Groupie import CODE" sent to the bot (DM or group) gets "That one goes to Cubbie in iMessage, not here" with the exact message and a Copy button, and a fresh code if the old one is no longer valid. No model call.
- **Accurate, short answers** from group facts only: tasks, owners, points, statuses, who is stuck, due date, days left, meeting time and link, and this project's Canvas items for the week ("Tue 11:59 PM: Homework 5").
- **Model.** Groq `openai/gpt-oss-20b`, falling back to the backup model; replies cleaned of dashes and curly quotes.
- **Privacy.** Never sees private chats; never mentions other courses, other members' item counts, or anything outside this project. Asked about someone's other class, it says it only knows this project.
- **Flood guard.** At most 4 questions per person per 30 seconds; normal use never hits it.

## 9. Check-ins and progress

- **`/checkin`** (and automatically Mondays at 10 AM in the group's time zone, at most once every 6 days): a header, then one message per member with their open tasks and **[Done] [On track] [Stuck]** per task. Only the owner's taps count ("That's Ava's task. Nice try!"); seeded teammates' tasks are open to anyone for testing. Messages update in place; finished members get "All done. Absolute legend." Mentions this week's Canvas items for the project's course.
- **Progress card image.** About 6 seconds after the last change (so a burst of taps makes one card): overall percent, a bar split by member, "N of M points done", a days-left chip (lime, amber when close, coral when overdue), a status legend with counts, per-member percent and task pills (done struck through, on track, stuck glowing coral with "NEEDS HELP"), "Tracked by <nickname>". The caption names who is stuck and asks the team to help, and celebrates 100%.
- **`/progress`** posts the card on demand; **[Update my tasks]** opens the Progress screen.

## 10. Canvas, powered by Cubbie

- **Import from Canvas without downloading anything.** `/canvas` in the group (or "Get my code" in the Mini App) makes a 6-character code (no lookalike characters, single use, 30 minutes; works before the team size is picked, and the size question follows the task list). The student texts Cubbie "Groupie import <CODE> <assignment>"; Cubbie reads the assignment from their Canvas (description, due date, points, attached files as text, and the rubric if Canvas includes it), asks the student to confirm, and sends it to Groupie.
- **Same pipeline as file uploads.** The task list and join message post in the group exactly as for a dropped file. The Canvas due date wins over the text; the course is saved on the group; rubric criteria become task hints (tasks map to criteria, heavier criteria get more effort, every criterion is covered).
- **Live status in the Mini App.** Code tiles, a 30-minute countdown, the exact message with Copy, and a stepper: Waiting for Cubbie, Received, Imported (or Failed / Expired with a fresh code button).
- **Safe imports.** Signed requests, single-use codes (even under simultaneous attempts), per-user, per-IP and global rate limits, a 15 MB body limit (an oversized attachment is dropped and the group is told), and one error code per failure (`code_expired`, `code_used`, `code_unknown`, `bad_signature`, `payload_too_large`, `invalid_payload`, `rate_limited`, `server_error`, `not_expecting`) that the Skill turns into a specific line for the student. A code is marked used only after a successful import, so a failure never burns it. A code made outside a group gets a DM explaining what to do.
- **The file after an import.** Attachments that arrive as bytes are posted in the group ("Here's the assignment from Canvas."); text-only imports add "Pulled the assignment text from Canvas. Drop the PDF here if you want everyone to have the file." A PDF dropped afterwards attaches to the imported assignment; if its text clearly differs, Groupie asks "Update the tasks from this file?" [Update] [Keep current].
- **Calendar sync.** Each student pastes their Canvas calendar feed link once (Connect Canvas has a 3-step guide). Only `https://canvas.asu.edu/feeds/...` (or `webcal://`) is accepted; the link is encrypted at rest (AES-256-GCM), never logged, returned, or shown. The server polls every 30 minutes with conditional requests, upserts items, marks removed ones, and backs off on errors.
- **Upcoming screen.** Everything you have due across all courses, grouped Today / Tomorrow / weekday, course chips, due times, "In 7 h" tags for the next 48 hours, Open in Canvas links.
- **Uses of calendar data.** Private chat knows your own items across all courses; group answers and check-ins include only the project's course (matched by course code across sections); the weekly check-in mentions this week's items.
- **Opt-in busy weeks.** Toggle "Let my group's split account for my busy weeks". When on (and `LOAD_AWARE_SPLIT=true`), a busy member gets the lighter share among equally fair splits. The card shows only "Busy week" plus "<name> got fewer points this time: busy week." Never counts or other courses. With nobody opted in, the split is identical to the normal one.
- **The Cubbie Skill** (`groupie-import`) is public at https://github.com/katsdivi/groupie-cubbie-skill. Install by texting Cubbie the folder link.

## 11. Personal agents (one model, your own context)

- **Context policy.** Every model call goes through one gate (`buildContext`): group answers never see anyone's private rows, not even the asker's; private rows reach the model only in your own DM or Mini App chat. Tested with adversarial prompts on the exact model input.
- **Memory.** Say "remember I work Thursday nights" in a DM or the app chat; "forget ..." removes it. The What Motu remembers screen lists your facts, lets you edit or delete them, and share one with the current group (private by default).
- **Reminders by DM.** 48, 24 and 3 hours before your own Canvas items, your groups' due dates, and your open tasks; quiet hours (default 11 PM to 8 AM); one batched message per run; never twice for the same item and offset; tasks due with the assignment fold into one line. Settings has the switch, offsets, and quiet hours; joining prompts you to tap Start so Groupie can DM you.
- **Connect your calendar.** Google (free/busy only) or a calendar link from Apple, Outlook, or Google. Only busy start and end times are stored, never titles; links and tokens are encrypted and never shown. Canvas timed events count too.
- **Prefilled availability.** The grid opens with your free time already selected around your busy blocks; fix anything and tap Looks right. Nobody sees anyone else's calendar; the heatmap shows counts only.
- **Top 3 times.** When everyone answers, at a deadline (`/deadline 24h`), or on Lock it now, Groupie polls the group on the 3 best one-hour slots, then continues to the meeting flow.
- **Your own Canvas assignment.** `/canvas` in a DM gives a personal code; after Cubbie sends it, Groupie DMs you a step-by-step plan and adds the due date to Upcoming and reminders.
- **iMessage link.** `/imessage` in a DM, then text Cubbie "Groupie link CODE" once. After that, "Groupie status" in iMessage shows your deadlines, tasks, and next meeting link. `/unlink` disconnects.

## 12. Private chat in the app ("Chat with Motu")

- **One-on-one, private.** Only you see your history; teammates cannot (tested).
- **Knows your situation.** Your tasks and statuses, skills and weak areas, the group facts, the meeting, and your own Canvas items across all courses.
- **Useful advice.** What to do first (your own tasks, bigger and blocking first), step-by-step breakdowns, short messages to teammates. If your tasks are done, suggests helping whoever is stuck.
- **Chat UI.** Bubbles in your color, grouped by sender with day separators, typing indicator, suggestion chips that fit your project, simple formatting (bold, bullets, numbered lists, links), failed sends with "Tap to retry", "New message" pill when scrolled up, keyboard-safe layout.

## 13. Mini App (Telegram)

- **Opens from any group button** via a direct link with a start parameter that routes to the right screen (home, form, split, avail, progress, chat, settings, canvas, upcoming).
- **Screens.** Home (greeting, next meeting card with Join and Add to Calendar, assignment summary, your color, links to everything), My details (form), The split, Availability, Progress, Chat with Motu, Connect Canvas, Upcoming, Settings (rename).
- **Native feel.** Telegram BackButton and MainButton, haptics on taps and selections, write-access request on first open (so DMs work), dark brand theme regardless of Telegram theme, skeleton loaders, error states with retry, friendly empty states, smooth enter animations, mobile-first and fine on desktop.
- **Secure.** Every request carries Telegram's signed initData, checked server-side (HMAC, 24-hour freshness), plus a group membership check through Telegram (cached).
- **Outside Telegram.** Shows "Groupie lives in Telegram" with an open button, except for signed availability links.

## 14. Privacy and security

- Private chats never reach group answers, other members, or prompts for anyone else.
- Calendar feed links encrypted at rest; never in logs, responses, or chat (tested).
- Group views (cards, answers, check-ins, split API) never show other courses or other members' item counts (tested).
- Signed Mini App sessions and membership checks on every group route; signed, scoped, expiring browser links.
- Webhook protected by Telegram's secret token header.
- The Cubbie signing key is public by design (Cubbie cannot host team secrets); single-use pair codes and rate limits are the real protection. The server refuses to start if any two secrets are the same.
- Secrets live only in `.env` (gitignored) and Railway variables; nothing secret in the repo or the public Skill (gitleaks clean).

## 15. Background jobs

- **Weekly check-in:** checks every 15 minutes; runs Mondays at 10 AM group time.
- **Calendar feed poller:** every 30 minutes per user, conditional GET, exponential backoff up to 12 hours.
- **Debounced progress card:** about 6 seconds after the last task change.
- **Reminders:** every 15 minutes, per user, respecting quiet hours.
- **Calendar sync:** every 30 minutes per connection (Google free/busy, ICS, Canvas events), with backoff.
- **Availability deadlines:** every 5 minutes; posts the top 3 time poll when a deadline passes.

## 16. Developer and operations tools

- **Demo tools** (`docs/DEMO_TOOLS.md`, `docs/DEMO_RUNBOOK.md`): `pnpm demo:reset|seed|fill|remind|warm` and `scripts/demo/remote.sh` for production, admin allowlist plus a production guard; a `DEMO_MODE` LLM cache that answers through Groq rate limits and keeps the rehearsed import stable.
- **Dev commands** (when `DEV_MODE=true`): `/seed` adds up to 4 pretend teammates with skills and overlapping free times; `/reset` wipes the group and restarts the welcome.
- **Dev routes:** `/dev/state` (all data as JSON), `/dev/split?group=` (a live split drawn as the card), `/dev/links?group=` (each member's browser availability link), `/cards/split` and `/cards/progress` (`?preview=1` for HTML, otherwise the PNG).
- **Scripts:** `pnpm google:auth` (Google consent), `scripts/railway-env.sh` (sets Railway variables from `.env`, never printing values, `--dry-run`), `scripts/backup-db.sh` (consistent SQLite backup off the Railway volume with an integrity check), `pnpm canvas:inspect` and `pnpm feed:inspect` (read-only production stats, no private text).
- **Bot modes:** webhook in production, polling for local testing, or off.
- **Tests:** about 470 automated tests across the fair split, swaps, time zones, availability, initData and link signing, intake, Canvas import and feeds, privacy, and prompts; plus Skill unit tests and an offline harness.
- **Deploy:** one Railway service from the Dockerfile (Playwright image), SQLite on a volume, migrations run automatically at boot, health check at `/health`.

## 17. Configuration

| Variable | Purpose |
|---|---|
| `BOT_TOKEN`, `BOT_USERNAME`, `MINI_APP_SHORT_NAME` | Telegram bot and Mini App |
| `PUBLIC_URL`, `WEBHOOK_SECRET`, `BOT_MODE` | Hosting and webhook |
| `GROQ_API_KEY`, `GROQ_PARSE_MODEL`, `GROQ_CHAT_MODEL`, `GROQ_FALLBACK_MODEL` | LLM |
| `DATABASE_PATH` | SQLite file (on the Railway volume) |
| `LINK_SIGNING_SECRET` | Browser availability links |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Calendar, Meet, Gmail |
| `CUBBIE_PUBLIC_SIGNING_KEY` | Signs Cubbie imports (public by design) |
| `FEED_ENCRYPTION_KEY` | Encrypts calendar feed links |
| `LOAD_AWARE_SPLIT` | Opt-in busy-week adjustment |
| `GOOGLE_USER_CLIENT_ID`, `GOOGLE_USER_CLIENT_SECRET` | Per-user Google free/busy (Web OAuth client; optional) |
| `PREFILL_START_HOUR`, `PREFILL_END_HOUR` | Reasonable hours for the prefilled grid (default 8 and 22) |
| `DEFAULT_TZ`, `DEV_MODE`, `PORT` | Time zone, dev tools, port |

## 18. Known limits

- One assignment per Telegram group; one team per group.
- Group times use one time zone (default America/Phoenix); Upcoming uses each phone's time zone.
- Photos of assignments are not read (no OCR); scanned PDFs need selectable text.
- Cubbie import sends attachment text, not original files; rubrics and Canvas group membership depend on what Cubbie returns (see `docs/CUBBIE_CAPABILITIES.md`).
- Calendar feeds accepted from canvas.asu.edu only; cross-listed courses with different codes do not match for group answers.
- The Google token expires 7 days after consent while the Google app is in testing mode (rerun `pnpm google:auth`).
- The Railway service sleeps when idle; the first request after a quiet period takes a moment.
