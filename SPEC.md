You are building a hackathon project with me (Divyam). Read this entire spec before doing anything. Save it verbatim as `SPEC.md` in the repo root. Then follow the **Working rules** strictly.

## Working rules

1. Build **one step at a time**, in the order in "Build order". Never start the next step until I say "next".
2. Every step ends with a **visual check** I can see with my own eyes (on my phone in Telegram, or in a browser). At the end of each step, tell me exactly what to open or tap and what I should see. A step is not done until I confirm I saw it.
3. Before telling me a step is done, verify it yourself: run the build and tests, curl the endpoints, and for any UI or card, take a Playwright screenshot and look at it.
4. Commit after each confirmed step, for example `step 07: split algorithm`.
5. When a step needs something only I can do (an account, a key, a BotFather setting, a Google consent click, testing on my phone), stop and give me numbered, exact instructions, then wait. Don't fake it or stub around it silently. The section "Things only Divyam can do" lists these and when they come up.
6. Simple and reliable beats clever. This is a demo, and judging is 70% presentation and UI. Polish matters more than feature count.
7. Never commit secrets. Keys live in `.env` (gitignored), with `.env.example` committed.
8. Do not use em dashes anywhere: UI copy, bot messages, docs, or commit messages.
9. Keep me informed in short messages. When something fails, say what failed and what you'll try, plainly.

## Product

**Groupie**: "your group project's biggest fan." A Telegram bot, **@CubbieGroupieBot**, that joins a student group chat and removes the group-project coordination burden, ending "I did more work than you" fights.

**Core differentiator: the fair task split.** The assignment PDF is broken into tasks with effort points by the LLM, then **code (not the LLM)** balances them so every member has nearly equal points. The result is a polished image card. Everything else (nickname, availability, meeting, check-ins, private agent) supports that.

A **Telegram Mini App** (our own React page opened inside Telegram) provides the rich UI: member form, split view and swap picker, availability grid, progress view, and the private "My Groupie" chat. The availability page must also work as a normal browser page via a signed link, so it can be emailed to people outside Telegram (Groupie emails this link to teammates who are not on Telegram).

Context: this is for the Cubbie Hackathon, Track 3 (Group Chat Assistant). We compete in Track 3 only.

## Stack (fixed, ask before changing)

- **Language:** TypeScript everywhere, Node 20+
- **Monorepo:** pnpm workspaces
  - `apps/server`: Express API + grammY bot + Playwright card renderer + SQLite
  - `apps/web`: React + Vite + Tailwind Mini App, built to static files served by the server
  - `packages/shared`: shared types and zod schemas
- **DB:** SQLite via `better-sqlite3` + Drizzle ORM. Path from `DATABASE_PATH` so it can live on a Railway volume.
- **Bot:** grammY. Long polling in local dev, webhook in production (`/tg/webhook` with a secret token).
- **LLM:** Groq API, OpenAI-compatible at `https://api.groq.com/openai/v1`
  - `openai/gpt-oss-120b` for assignment parsing
  - `openai/gpt-oss-20b` for chat (My Groupie and nickname Q&A in the group)
  - fallback `llama-3.3-70b-versatile`
- **PDF text:** `unpdf`
- **Cards:** HTML templates rendered to PNG with Playwright (Chromium)
- **Calendar:** `googleapis`, Google Calendar API with a Meet link
- **Deploy:** one Railway service from a Dockerfile based on the official Playwright image (`mcr.microsoft.com/playwright`, pin the tag to match the installed `playwright` version), with a volume at `/data` for SQLite. One HTTPS URL serves the API, the webhook, the Mini App, and card previews.
- **Local HTTPS for Mini App testing:** `cloudflared` quick tunnel

## Step 0 includes installation (do this first)

Detect my OS. Then check for each tool below and install whatever is missing. Use Homebrew on macOS (install Homebrew first if missing, and tell me when it needs my password), winget on Windows, and the official install scripts on Linux. Print a final table of tool and version.

- Node 20+ (prefer installing via `fnm` or `nvm` if Node is missing or too old)
- pnpm (via `corepack enable` then `corepack prepare pnpm@latest --activate`)
- git
- GitHub CLI `gh`
- Railway CLI
- `cloudflared`
- Docker is NOT required locally (Railway builds the Dockerfile). Skip it unless I ask.
- Playwright Chromium for local card rendering: `pnpm exec playwright install chromium` inside `apps/server`

Logins that need me (stop and tell me to run them myself, since they open a browser or are interactive): `gh auth login`, `railway login`.

## Environment variables

```
BOT_TOKEN=
BOT_USERNAME=CubbieGroupieBot
MINI_APP_SHORT_NAME=app
PUBLIC_URL=              # https URL of the Railway deployment or local tunnel
WEBHOOK_SECRET=          # generate a random string
GROQ_API_KEY=
DATABASE_PATH=./data/groupie.db
LINK_SIGNING_SECRET=     # generate a random string
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
DEFAULT_TZ=America/Phoenix
DEV_MODE=true            # enables /seed, /reset, and /dev/* routes
```

Generate the random secrets yourself and fill them into `.env`.

## Telegram gotchas (design around these)

1. **`web_app` inline buttons are not allowed in groups.** In groups, use a normal URL button pointing to the direct-link Mini App: `https://t.me/CubbieGroupieBot/app?startapp=<payload>`. Payload allows only `A-Za-z0-9_-`, max 64 chars. Encode it like `g<groupIdWithoutMinus>_<screen>` (for example `g100123456_avail`). The Mini App reads `Telegram.WebApp.initDataUnsafe.start_param` and routes to that screen.
2. **Privacy mode** must be disabled in BotFather so the bot receives PDFs and sees messages that use its nickname. If the bot isn't receiving normal messages, tell the group to make Groupie an admin as a fallback.
3. **Auth:** every Mini App request sends `Authorization: tma <initData>`. Validate it server-side with HMAC-SHA256 per Telegram docs (secret key = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)), reject data older than 24h, and extract the user. Then confirm the user is a member of the group via `getChatMember` (cache results).
4. **Browser mode:** when there's no initData, the availability page accepts `?t=<signed token>` (HMAC with `LINK_SIGNING_SECRET`, encoding groupId, member name, expiry).
5. **DMs:** a bot can only DM users who have started it. On first Mini App open, call `Telegram.WebApp.requestWriteAccess()` so private nudges and DMs work.
6. **Native feel:** call `ready()` and `expand()`, use `BackButton`, `MainButton`, and `HapticFeedback`. Key screens and cards use the brand dark style regardless of Telegram theme.
7. Edit existing group messages for live counters ("3/5 joined") instead of posting new ones.
8. The label above bot messages always shows the real bot name. Per-group nicknames can't change that, so the nickname appears in message text, cards, and the Mini App header.

## Data model

- `groups`: id (Telegram chat id), title, nickname (default "Groupie"), team_size, status (`setup` | `collecting_members` | `split_ready` | `scheduling` | `active`), assignment_title, due_date, tz, status_message_id, created_at
- `members`: id, group_id, tg_user_id (nullable for seed or browser-only members), name, email (optional), color, skills (json string[]), weak_areas (json string[]), is_seed
- `tasks`: id, group_id, title, description, effort (1|2|3|5|8), skill_tags (json), assignee_member_id, status (`todo` | `on_track` | `stuck` | `done`), due_date
- `availability`: id, member_id, slot_start (UTC ISO), slot_end. 30-minute slots.
- `meetings`: id, group_id, start, end, mode (`meet` | `zoom` | `in_person`), calendar_event_id, meet_link
- `swap_requests`: id, group_id, from_member_id, task_id, to_member_id (nullable), status
- `agent_messages`: id, member_id, role, content, created_at (private per member, never returned to anyone else)
- `pending_inputs`: group_id, tg_user_id, kind (`nickname`), expires_at (to capture the reply after [Name me])

Member colors: a fixed palette of 6 distinct accents that read well on #1E1E1E (coral, amber, lime, cyan, violet, pink). Assign in join order.

## API (under `/api`, auth required except health and dev previews)

- `GET  /health`
- `GET  /api/me?group=<id>` → user, member record if joined, group summary including nickname
- `POST /api/groups/:id/members` → `{name, email?, skills, weak_areas}` → member with color
- `PATCH /api/groups/:id/nickname` → `{nickname}` (also used by the Mini App settings)
- `GET  /api/groups/:id/split` → tasks with assignees, per-member points, max gap
- `POST /api/groups/:id/swap` → `{task_id, to_member_id?}` → reruns balancing with constraints, returns new split
- `GET  /api/groups/:id/availability/me` and `PUT` (array of slot starts)
- `GET  /api/groups/:id/heatmap` → per-slot count and member ids, responded count, best slots ranked
- `GET  /api/groups/:id/progress` → per-member tasks, points, percent done
- `PATCH /api/tasks/:id` → status
- `POST /api/agent/chat` → `{group_id, message}` → reply scoped to the caller
- Dev only: `GET /dev/state`, `GET /dev/split?group=`, `GET /cards/split?group=&preview=1`, `GET /cards/progress?group=&preview=1`

Request and response zod schemas live in `packages/shared` and are used on both sides. Also write `API.md` documenting every endpoint with example requests and responses, so a teammate could build against it.

## LLM: assignment parsing

- Extract PDF text with `unpdf`. If empty (scanned PDF), reply that the PDF needs selectable text.
- Groq's free tier allows about 8K tokens per minute on gpt-oss models. Truncate to about 5,000 tokens (roughly 18,000 chars), keeping the beginning, the rubric and requirements sections, and deliverables.
- Use structured output (strict JSON schema) for: `assignment_title`, `due_date` (ISO or null), and `tasks[]` with `title`, `description` (one line), `effort` from exactly {1,2,3,5,8}, `skill_tags` from a fixed vocabulary (`writing`, `research`, `coding`, `design`, `data`, `presenting`, `editing`, `math`). Target 6 to 14 tasks. Always include a final "integrate and proofread" task.
- Validate with zod. On failure retry once, then fall back to the llama model. Log raw responses in dev.
- Handle Groq 429 rate limits with a short backoff and a friendly "thinking, one sec" message.

## Fair split algorithm (pure function, fully unit tested)

`split(tasks, members, constraints) → { assignments, totals, maxGap }`

1. Sort tasks by effort, largest first (stable by id).
2. Assign each to the member with the lowest current total. Break ties by skill match (+1 per matching tag) and penalize tags in the member's weak areas.
3. Local search: try single-task moves and pairwise swaps between members, and accept any that reduce `maxGap` (max total minus min total). Then accept swaps that improve skill fit without increasing the gap. Stop when nothing improves.
4. Respect constraints: locked assignments, and "member X must not get task Y" from swap requests.
5. Deterministic: same input, same output.

Tests: equal-effort tasks, one huge task, more members than tasks, locked constraints, weak-area avoidance, and that maxGap is never worse than greedy.

## Nickname feature

- Right after Groupie joins a group: "Hey, I'm Groupie, your group project's biggest fan. Want to give me a nickname for this group?" with [Name me] [Keep Groupie].
- [Name me]: send a ForceReply message "Reply with my new name" addressed to whoever tapped. Accept the tapper's next reply (via `pending_inputs`, 2 minute expiry). Validate: 1 to 20 chars, letters, numbers, spaces, and basic punctuation, trimmed. Confirm with "Call me Max from now on." Then continue to the setup prompt.
- [Keep Groupie]: continue to setup.
- The nickname is used in all bot messages ("Max here."), the card footer, and the Mini App header.
- **Addressing by name:** if a group message starts with the nickname (case-insensitive, followed by a comma, colon, space, or question mark, for example "Max, what's due?"), or @mentions the bot, Groupie answers in the group using gpt-oss-20b, with context limited to group-level info: tasks, assignees, points, statuses, due dates, and the meeting time. Never include anyone's private My Groupie chat. Keep replies short and in character.
- **Rename:** `/rename` command, a [Rename] button in a `/settings` message, and a field in the Mini App settings. Announce "New name, who dis. I'm Nova now."

## Cards (the most visible thing; make them screenshot-worthy)

Style: background #1E1E1E, rounded corners (24px), dashed light-gray borders (#3A3A3A to #555), font Inter (bundle the font files locally, never fetch fonts at render time), one accent color per member, generous spacing, 1080px wide, deviceScaleFactor 2.

**Fair split card:** header with assignment title, due date, and a "Fair split" badge. One row per member: color chip and name, their tasks as small pills, points total, and a horizontal balance bar. Footer: "Max difference: N pt" and "Split by <nickname>".

**Progress card:** per member, percent of their points done as a bar or ring, with task statuses as colored dots (done, on track, stuck). Footer: overall percent and days until due.

Templates are plain HTML and CSS filled from data. Keep one long-lived Playwright browser and reuse pages for speed. Previews at `/cards/...?preview=1` so I can iterate on the design in a browser. When I give you Figma screenshots or exports from Yug, match them exactly.

## Mini App screens

Design language: the same dark brand style as the cards, mobile-first, smooth transitions, haptics on selection, skeleton loaders, no default-looking HTML. Header shows the group's nickname for the bot.

1. **Home / router:** reads start_param and routes. Shows the group name and your color.
2. **My details form:** name (prefilled from Telegram), optional email (for calendar invites), skills as tappable chips, weak areas as chips, submit via MainButton.
3. **Split view:** the card's info, interactive, with a "Request swap" flow (pick one of your tasks, optionally pick who to swap with).
4. **Availability grid (most important):** 7 days by 30-minute rows (default 9am to 10pm in the group tz, scrollable). Drag to select and deselect with pointer events, working with touch, with no page scroll while dragging inside the grid (use `touch-action`). The first cell touched decides add or remove. Autosave with debounce. Toggle **Mine** and **Group**: Group is a heatmap shaded by count with the best slot outlined and labeled. Must also work in a desktop browser with a mouse.
5. **Progress:** my tasks with status toggles, plus the team overview.
6. **My Groupie chat:** chat UI with bubbles and a typing indicator. Only my own history. The agent knows my tasks, deadlines, and the group schedule, never other members' private chats.
7. **Settings:** rename the bot for this group.

## Bot flows

- **Added to group:** welcome plus the nickname prompt (above), then setup.
- **Setup:** "How many people?" with [3] [4] [5] [6], then "Drop the assignment PDF." On PDF: parse, then the status message "Got it: 9 tasks, 31 points. Everyone tap below to add your details." with a URL button to the form. The status message live-updates "2/5 joined" with colored dots.
- **All members joined:** run the split and post the split card with [Looks fair] [Request swap]. Show the "Looks fair" count on the message.
- **Availability:** post [Fill your availability], live-update "3/5 responded". When all respond (or someone taps [Lock it now]), post "Best time: Sun 4 to 5 PM", then a non-anonymous poll [Google Meet] [Zoom] [In person], then [Send Calendar Invite].
- **Calendar:** create the event on the authorized Google account with `conferenceData.createRequest` (conferenceDataVersion=1) for Meet, invite member emails if provided, `sendUpdates=all`. Post the event and Meet links.
- **Check-ins:** `/checkin` (plus a weekly scheduled job) posts [Done] [On track] [Stuck] per member. Results update tasks and post a fresh progress card.
- **Dev:** `/seed` adds 4 fake members with names, skills, and overlapping random availability so I can test the whole flow alone. `/reset` wipes the group.

## Things only Divyam can do (prompt me at these points)

- **Before step 1:** confirm deadlines on the Discord. Run `gh auth login` and `railway login`. Create the GitHub repo (or let you do it with `gh repo create` once I'm logged in).
- **Before step 2:** in BotFather for @CubbieGroupieBot: send the token, `/setprivacy` → Disable, `/setjoingroups` → Enable, set the description and about text (draft these for me), `/setuserpic` when Yug has the logo. Create a Groq API key at console.groq.com and give it to you. Create a Telegram test group.
- **Step 1:** create the Railway project if the CLI can't, add a volume at `/data`, and generate a public domain. You set env vars with the Railway CLI.
- **Step 3:** BotFather `/newapp` → pick @CubbieGroupieBot → title "Groupie", short description, a 640x360 image (generate one for me), URL = PUBLIC_URL, short name `app`. Use `/myapps` later if the URL changes.
- **Step 5:** give you a real assignment PDF with selectable text.
- **Step 13:** Google Cloud Console: new project, enable Google Calendar API, OAuth consent screen (External, add my Gmail as a test user), create an OAuth Client ID (Desktop app), paste the ID and secret, run `pnpm google:auth` and click Allow.
- **Every step:** do the visual check on my phone. You can screenshot web pages, but you can't tap inside Telegram.
- **Step 18:** a real run-through with Yug and other real Telegram accounts, then hand off to Yug for the demo video.

## Build order (each step: build → self-verify → tell me the visual check → wait for "next")

0. **Install and repo setup:** tools (see above), pnpm monorepo, TypeScript, lint, `.env.example`, Dockerfile, README with run commands. *Visual:* the tool version table, and `http://localhost:3000/health` shows OK.
1. **First deploy:** Railway via Dockerfile with a volume. *Visual:* `<PUBLIC_URL>/health` OK on my phone, and the root shows a placeholder Groupie page.
2. **Bot alive + nickname prompt:** welcome with [Name me] [Keep Groupie], rename works, the nickname shows in messages. *Visual:* add the bot to my test group, tap [Name me], reply "Max", see "Call me Max from now on."
3. **Mini App opens from group:** direct link with start_param, initData validated. *Visual:* tapping the button opens "Hi Divyam, Max is on <group title>" inside Telegram, with a working BackButton.
4. **Setup flow + DB:** team size buttons and message edits. *Visual:* tap [5] → the message asks for the PDF, and `/dev/state` shows the group row with nickname.
5. **PDF to tasks:** unpdf + Groq + zod. *Visual:* upload the PDF and the bot replies with the task list and points.
6. **Member form:** *Visual:* submit, and the status message shows "1/5 joined" with my color dot. `/seed` fills the rest.
7. **Split algorithm:** pure function + tests. *Visual:* tests pass, and `/dev/split?group=` shows member bars and maxGap.
8. **Split card:** template + Playwright PNG + post. *Visual:* the preview page in a browser, then the PNG in the group with [Looks fair] [Request swap].
9. **Swap flow:** *Visual:* request a swap in the Mini App and a new card posts with the updated gap.
10. **Availability grid:** *Visual:* dragging on my phone paints cells in my color, the selection persists after reopening, and the signed browser link works on desktop with a mouse.
11. **Heatmap + live count:** *Visual:* the group message shows "N/5 responded", and the Group toggle shows the heatmap with the best slot outlined.
12. **Meeting lock + poll:** *Visual:* best-time message, poll, and invite button in the group.
13. **Google Calendar invite:** `pnpm google:auth` script. *Visual:* the event in Google Calendar with a Meet link.
14. **Nickname Q&A in group:** *Visual:* "Max, what's due?" in the group gets a short correct answer about our tasks.
15. **Progress + check-ins + progress card:** *Visual:* tap [Done], and an updated progress card posts.
16. **My Groupie chat:** *Visual:* two accounts each see only their own chat, and answers reference my real tasks.
17. **Canvas via Cubbie (replaces the old step 17, built on branch `feat/canvas`):** Groupie's Canvas import, powered by Cubbie (`cubbie-skill/`, a Cubbie Skill named `groupie-import`), reads an assignment from Canvas through Cubbie and sends it to `POST /api/cubbie/import` with a single-use pair code from `/canvas` or the Mini App's Connect Canvas screen; the same intake as file uploads runs, rubric criteria become task hints, and the Canvas due date wins. Students paste their Canvas calendar feed once (encrypted at rest, `canvas.asu.edu` only) and a poller keeps due dates in sync every 30 minutes; the Upcoming screen lists them, group answers include only this course's items, private chat includes the student's own items, the Monday check-in mentions the week's items, and an optional load-aware split (`LOAD_AWARE_SPLIT=true`) tags busy members. Recon, assumptions, and the Cubbie capability table are in `docs/`.
18a. **Personal agents (built on branch `feat/agents`):** one model with per-user context. `buildContext()` is the only path data takes to the LLM; group answers never see private rows (self questions send the private part by DM; questions about a teammate use only what they shared, otherwise "That's Ava's to share."). Personal memory ("remember ..."), DM conversations, per-user reminders (48/24/3 h, quiet hours, batched, deduped), calendar connections (Google free/busy or an ICS link; busy times only, never titles), an availability grid prefilled from busy times, a top 3 time poll, personal Canvas imports by DM, and an iMessage link through Cubbie ("Groupie status"). Docs: `docs/PERSONAL_AGENTS_RECON.md`, `docs/PERSONAL_AGENTS_ASSUMPTIONS.md`.
17b. **Agent-to-agent swap negotiation:** out of scope (we compete in Track 3 only). Not built.
18. **Polish pass:** consistency, empty states, error states, loading states, copy review in Groupie's voice (warm, a little cheeky, a superfan). *Visual:* a full scripted run from adding the bot to the calendar invite with no rough edges. Built (branch `feat/step18`): DM history persisted per Telegram user (`/forgetchat`, Settings > Clear my chat), polish of the 5 demo moments, a copy module (`apps/server/src/copy.ts`), demo tooling with a `DEMO_MODE` LLM cache, and `docs/DEMO_RUNBOOK.md`.
18b. **Import fixes from the live phone test (branch `feat/import-fixes`):** imports work before the team size is picked, explained rejections with one error code each and codes burned only on success, 30 minute codes, a wrong-app reply for "Groupie import CODE" sent to the bot, `/reset` replays the welcome, the file (or a text-only note) after an import, "send me the assignment" re-sends the file or a PDF of the text, and the assignment text answers questions. Diagnosis in `docs/IMPORT_FIXES_ASSUMPTIONS.md`.

Start with step 0. Ask me anything you need before you begin.
