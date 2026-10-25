# Groupie API

Base URL: `PUBLIC_URL` (production: `https://devhacks-groupie-production.up.railway.app`).
Request and response shapes are zod schemas in `packages/shared/src/api.ts`, used by both the server and the Mini App.

## Auth

Every `/api` request from the Mini App sends Telegram's init data:

```
Authorization: tma <Telegram.WebApp.initData>
```

The server checks the HMAC signature with the bot token, rejects data older than 24 hours, and then confirms with Telegram (`getChatMember`, cached 5 minutes) that the user is in the group they are asking about.

### Browser links (people outside Telegram)

The availability page also works in a normal browser at `<PUBLIC_URL>/?t=<token>`. The token names one member of one group and is signed with `LINK_SIGNING_SECRET` (HMAC-SHA256, 14 day expiry). Requests from that page send:

```
Authorization: link <token>
```

Link auth only works on the three availability endpoints below, and only for the token's own group and member. Everything else returns `403 link_scope`. Expired or forged tokens return `401 link_expired`. Get each member's link from `GET /dev/links?group=<id>` (Groupie emails these to teammates who are not on Telegram).

Errors always look like this:

```json
{ "error": "not_a_member", "message": "You're not in this group, so I can't show it to you." }
```

| Status | `error` | When |
|---|---|---|
| 400 | `bad_nickname`, `bad_member`, `bad_swap` | Body failed validation |
| 401 | `unauthorized` | Missing, forged, or stale init data |
| 403 | `not_a_member` | Valid user, but not in that group |
| 404 | `group_not_found` | The bot is not in that group yet |
| 401 | `link_expired` | Browser link expired or forged |
| 403 | `link_scope` | Browser link used outside availability, or for another group |
| 409 | `no_assignment`, `team_full`, `no_split`, `not_joined` | Wrong moment in the flow |

Group ids are Telegram chat ids and are negative (for example `-5254546157`).

## Endpoints

### `GET /health`

No auth.

```json
{ "ok": true, "service": "groupie", "time": "2026-10-24T22:05:12.250Z" }
```

### `GET /api/me?group=<id>`

Who I am, my member record if I joined, and a group summary.

```json
{
  "user": { "id": 8484575705, "first_name": "Divyam" },
  "member": {
    "id": 1, "name": "Divyam", "color": "#FF6B5B", "email": "d@asu.edu",
    "skills": ["coding", "design"], "weak_areas": ["writing"], "is_seed": false
  },
  "group": {
    "id": -5254546157, "title": "CSE 340 Squad", "nickname": "Motu", "status": "split_ready",
    "team_size": 5, "assignment_title": "Campus Food Finder", "joined": 5, "task_count": 13, "total_points": 49
  }
}
```

`member` is `null` until the user submits the details form. `group.meeting` is `null` until a time is locked, then:

```json
{
  "start": "2026-10-25T23:00:00.000Z", "end": "2026-10-26T00:00:00.000Z", "label": "Sun, Oct 25 · 4 to 5 PM",
  "mode": "zoom", "join_url": "https://zoom.us/j/999", "location": null,
  "calendar_url": "https://calendar.google.com/calendar/render?action=TEMPLATE&...", "event_url": null
}
```

`calendar_url` is an "Add to Google Calendar" link that works without our Google keys. `event_url` is the real event once Google Calendar is connected. `status` is one of `setup`, `collecting_members`, `split_ready`, `scheduling`, `active`.

### `POST /api/groups/:id/members`

Join the group, or update my details if I already joined (my color never changes).

```json
{ "name": "Divyam", "email": "d@asu.edu", "skills": ["coding", "design"], "weak_areas": ["writing"] }
```

Skills and weak areas come from `writing`, `research`, `coding`, `design`, `data`, `presenting`, `editing`, `math`, and may not overlap. `email` is optional (empty string is fine).

`201` on first join, `200` on update:

```json
{ "member": { "id": 1, "name": "Divyam", "color": "#FF6B5B", "...": "..." }, "joined": 1, "team_size": 5 }
```

Side effects: edits the group's "N/5 joined" message. When the last seat fills, runs the split and posts the split card.

### `PATCH /api/groups/:id/members/me/workload`

Opt in or out of the load-aware split (Telegram auth only; off by default).

```json
{ "shareWorkload": true }
```

Response: `{ "member": { "id": 1, "share_workload": true, "...": "..." } }`. `409 not_joined` if I have not joined, `400 bad_workload` for a bad body. When on (and `LOAD_AWARE_SPLIT=true`), my Canvas calendar can give me fewer points in a busy week. The group only ever sees a "Busy week" tag and "<name> got fewer points this time: busy week." on the split card, never my other courses or how many items I have due. `share_workload` is also on every `member` object (for example in `GET /api/me`).

### `PATCH /api/groups/:id/nickname`

```json
{ "nickname": "Nova" }
```

Response: `{ "nickname": "Nova" }`. Posts "New name, who dis. I'm Nova now." in the group. 1 to 20 letters, numbers, spaces, or basic punctuation.

### `GET /api/groups/:id/split`

The saved split. Before it runs, every task is in `unassigned` and members have no tasks.

```json
{
  "group_id": -5254546157,
  "assignment_title": "Campus Food Finder",
  "due_date": "2026-11-20",
  "total_points": 49,
  "max_gap": 1,
  "members": [
    {
      "id": 1, "name": "Divyam", "color": "#FF6B5B", "points": 10, "is_me": true,
      "tasks": [
        { "id": 8, "title": "Implement frontend prototype", "description": "Build the React app...", "effort": 8, "skill_tags": ["coding"], "status": "todo" }
      ]
    }
  ],
  "unassigned": []
}
```

### `POST /api/groups/:id/swap`

Give away one of my tasks, optionally to a specific teammate.

```json
{ "task_id": 12, "to_member_id": 5 }
```

Leave out `to_member_id` (or send `null`) to let Groupie pick. Groupie moves as few tasks as possible: the task moves, plus at most two compensating moves. It only reshuffles everyone if that is more than 2 points fairer. I never get that task back in later rebalances, and a named teammate keeps it.

Response is the new split plus what moved:

```json
{ "...split fields...": "...", "moved": { "task_id": 12, "from_member_id": 1, "to_member_id": 5 } }
```

Side effects: posts a fresh split card in the group and resets the "Looks fair" votes.

### `GET /api/groups/:id/availability/me`

Telegram or link auth. My saved free times as UTC slot starts (30 minutes each).

```json
{
  "group": { "id": -5254546157, "title": "CSE 340 Squad", "nickname": "Motu", "tz": "America/Phoenix" },
  "member": { "id": 1, "name": "Divyam", "color": "#FF6B5B" },
  "slots": ["2026-10-25T23:00:00.000Z", "2026-10-25T23:30:00.000Z"]
}
```

`409 not_joined` if this Telegram user has not added their details yet.

### `PUT /api/groups/:id/availability/me`

Telegram or link auth. Replaces my free times with exactly this set (the grid autosaves the full set).

```json
{ "slots": ["2026-10-25T23:00:00.000Z", "2026-10-25T23:30:00.000Z"] }
```

Slots not on a 30-minute boundary, or outside today to 8 days out, are dropped. Response:

```json
{ "saved": 2, "responded": 4, "team_size": 5 }
```

Side effects: edits the group's "N/5 responded" message. When everyone has responded, locks the best hour and posts it, then the meeting poll and the invite button.

### `GET /api/groups/:id/heatmap`

Telegram or link auth.

```json
{
  "tz": "America/Phoenix",
  "team_size": 5,
  "responded": 5,
  "members": [{ "id": 1, "name": "Divyam", "color": "#FF6B5B", "responded": true }],
  "slots": { "2026-10-25T23:00:00.000Z": [1, 2, 3, 4, 5] },
  "best": [
    { "start": "2026-10-25T23:00:00.000Z", "end": "2026-10-26T00:00:00.000Z", "member_ids": [1, 2, 3, 4, 5], "label": "Sun, Oct 25 · 4 to 5 PM" }
  ]
}
```

`slots` only lists times with at least one person free. `best` holds up to 5 one-hour windows ranked by how many people are free for the whole hour, then earliest.

### `GET /api/groups/:id/progress`

```json
{
  "group_id": -5254546157, "assignment_title": "Campus Food Finder", "due_date": "2026-11-20", "days_left": 27,
  "total_points": 37, "done_points": 8, "percent": 22,
  "members": [
    { "id": 1, "name": "Divyam", "color": "#FF6B5B", "is_me": true, "points": 8, "done_points": 8, "percent": 100,
      "tasks": [{ "id": 5, "title": "Implement frontend prototype", "effort": 8, "status": "done" }] }
  ]
}
```

`days_left` is whole days in the group's time zone (negative when overdue, `null` without a due date).

### `PATCH /api/tasks/:id`

```json
{ "status": "done" }
```

Status is `todo`, `on_track`, `stuck`, or `done`. Only the task's owner may change it (`403 not_your_task`). Returns `{ "task": {...}, "progress": {...} }`. A fresh progress card posts in the group about 6 seconds after the last change.

### `GET /api/agent/history?group=<id>`

My private chat with Groupie, oldest first, plus starter prompts. Only ever the caller's own messages.

```json
{
  "messages": [{ "id": 1, "role": "user", "content": "What should I work on first?", "created_at": "2026-10-25T01:00:00.000Z" }],
  "suggestions": ["What should I work on first?", "Break \"Implement frontend prototype\" into steps", "When is our next meeting?"]
}
```

### `POST /api/agent/chat`

```json
{ "group_id": -5254546157, "message": "What should I work on first?" }
```

Returns `{ "user": ChatMessage, "reply": ChatMessage }`. The model sees my profile, my tasks, my last 12 messages, and group-level facts (tasks, owners, statuses, due date, meeting). It never sees anyone else's private chat. `503 llm_unavailable` if Groq is down.

## Canvas via Cubbie

Students never open Canvas for Groupie. Groupie's Canvas import, powered by Cubbie, asks Cubbie (which already has the student's Canvas) to read an assignment and send it here with a one-time pair code. A pasted Canvas calendar feed keeps due dates in sync. Schemas: `packages/shared/src/canvas.ts`. What Cubbie can and cannot do: `docs/CANVAS_RECON.md`.

### `POST /api/cubbie/pair-code`

Telegram auth. Makes a single-use code (6 characters, no lookalikes, 30 minutes).

```json
{ "groupChatId": -5254546157 }
```

`groupChatId` is optional; when set, the caller must be in that group, and the import posts there. Response:

```json
{ "code": "K7Q2MX", "expiresAt": "2026-10-25T02:15:00.000Z", "cubbieMessage": "Groupie import K7Q2MX" }
```

`cubbieMessage` is the exact text the student sends Cubbie.

Rate limited (in memory, `PAIR_CODE_RATE_LIMITS` in `apps/server/src/canvas/routes.ts`): 20 codes per IP per 10 minutes and 600 per hour across the server. Over either: `429 rate_limited` with `{ error, message }`.

### `GET /api/cubbie/pair-code/:code`

Telegram auth, only the code's owner. Live status for the Mini App: `waiting`, `received`, `imported`, `failed`, or `expired`.

```json
{ "code": "K7Q2MX", "status": "imported", "expiresAt": "...", "assignmentTitle": "Project 2: Campus Food Finder", "error": null }
```

Rate limited to 240 polls per IP per minute (the Mini App polls every 2.5 s, 24 a minute, so a few students behind one campus NAT fit). Over it: `429 rate_limited`.

### `POST /api/cubbie/import`

Called by the Cubbie Skill script. No Telegram auth: the single-use pair code in the body is the gate, plus a signature header and rate limits.

```
X-Groupie-Signature: sha256=<hex HMAC-SHA256(CUBBIE_PUBLIC_SIGNING_KEY, raw body)>
```

The signing key (`CUBBIE_PUBLIC_SIGNING_KEY`) ships inside the public Skill, so it is integrity and spam friction, not a real secret (Cubbie cannot host team keys). Body (`CubbieImportPayload`):

```json
{
  "pairCode": "K7Q2MX",
  "course": { "name": "CSE 340: Software Engineering", "code": "CSE 340" },
  "assignment": {
    "title": "Project 2: Campus Food Finder",
    "dueAt": "2026-11-20T23:59:00-07:00",
    "pointsPossible": 100,
    "descriptionText": "In teams of 4 to 6, design and build...",
    "url": "https://canvas.asu.edu/courses/123456/assignments/7654321"
  },
  "rubric": { "criteria": [{ "name": "Implementation", "points": 30, "ratings": ["Works end to end", "Partly", "Not working"] }] },
  "attachments": [{ "filename": "spec.pdf", "mimeType": "application/pdf", "text": "extracted text..." }]
}
```

`rubric` and `attachments` are optional. Attachments may carry `text` (what the Skill sends), `base64` (goes through the normal file intake), or `url` (shown to people, never downloaded). The server runs the same intake as a Telegram file upload, uses the Canvas due date as the real due date, and posts the task list in the linked group. Response:

```json
{ "ok": true, "importId": 12, "message": "Sent to Groupie. Check your group." }
```

Errors: `400 bad_payload`, `401 bad_signature`, `404 unknown_code`, `409 code_used` or `code_expired`, `409 not_expecting` (the group already has its assignment; the code stays usable), `422 <reason>` (intake failed, for example `too_short`), `429 rate_limited`, `503 imports_off` (server has no `CUBBIE_PUBLIC_SIGNING_KEY`). A code made without a group (from `/canvas` in a private chat, or the Mini App without `groupChatId`) is a personal import: the server plans the assignment for one person (`parseAssignment` with team size 1, rubric as extra context), DMs the student the title, course, due date in Canvas time (America/Phoenix), points, and the numbered steps with effort, and adds the assignment to the student's own `calendar_events` (uid `cubbie-import-<importId>`, kind `assignment`, due date in UTC) so it shows in Upcoming, private chat and reminders. With no Canvas due date nothing is added, and the DM says so. If the same title and due time are already in the student's calendar (from the feed or an earlier import), no second item is added. Feed polls and `DELETE /api/feed` never remove `cubbie-import-*` items. Response: `200` with `"message": "Sent to Groupie. Check your Telegram messages."` (also when the plan could not be made; the DM then says so). Link codes (purpose `link`) are rejected here as `404 unknown_code`.

### `PUT /api/feed`, `DELETE /api/feed`, `GET /api/feed/status`, `GET /api/feed/upcoming`

Telegram auth, per Telegram user (not per group).

- `PUT /api/feed` `{ "feedUrl": "https://canvas.asu.edu/feeds/calendars/user_....ics" }` (`400 bad_feed_url` otherwise, `503 feeds_off` without `FEED_ENCRYPTION_KEY`, `403 telegram_only` with browser-link auth) saves the Canvas calendar feed (encrypted at rest, AES-256-GCM) and polls it right away. Only `https://canvas.asu.edu/feeds/...` is accepted (`webcal://` is rewritten). The URL is never logged, returned, or shown in chat.
- `DELETE /api/feed` disconnects and deletes the stored events.
- `GET /api/feed/status`: `{ "connected": true, "lastPolledAt": "...", "lastError": null, "eventCount": 9, "courses": ["CSE 340 (Fall 2026)", "HST 101 (Fall 2026)"] }`
- `GET /api/feed/upcoming`: `{ "events": [FeedEvent, ...] }`, the caller's own items, soonest first.

The server polls each feed every 30 minutes with conditional GETs (ETag / If-Modified-Since) and backs off on errors. `POST /api/cubbie/feed` (Cubbie handing over the feed URL) is not built: the feed URL is a credential, and Cubbie Skills may not send credentials to a team's server.

## iMessage link (Cubbie)

Lets the student ask Cubbie "Groupie status" in iMessage. Schemas: `packages/shared/src/cubbieLink.ts`. Link codes live in `cubbie_pair_codes` with `purpose = 'link'` (migration 9); tokens live in `cubbie_links`, which keeps only `token_hash` (sha256 hex), never the token.

### `POST /api/cubbie/link`

Public, called by the Skill's `scripts/link.py`. Signed exactly like the import (`X-Groupie-Signature: sha256=<hex HMAC-SHA256(CUBBIE_PUBLIC_SIGNING_KEY, raw body)>`). Body: `{ "pairCode": "K7Q2MX" }`, a link code from `/imessage` (single use, 30 minutes). Response, once:

```json
{ "ok": true, "token": "grp_...", "name": "Ana", "message": "Linked to Groupie. Text me 'Groupie status' any time." }
```

`name` is the student's name from any Groupie group they joined, else `null`. A new link revokes the student's older tokens. The student gets a Telegram DM: "Your iMessage is linked to Groupie. Text Cubbie 'Groupie status' any time. Send /unlink to disconnect."

Errors: `400 bad_payload`, `401 bad_signature`, `404 unknown_code` (also for import codes), `409 code_used` or `code_expired`, `429 rate_limited` (20 per IP per 10 minutes), `503 links_off` (no `CUBBIE_PUBLIC_SIGNING_KEY`).

### `GET /api/cubbie/me`

Public, `Authorization: Bearer <token>`. Only the token owner's data: their groups (title, assignment, due date, days left, their own tasks with status and points, group task counts, the next meeting with time label, mode, join link and place), and their own `calendar_events` for the next 7 days (title, course, due, a due label in Canvas time). Never another member's calendar, memory, chat history or profile. Updates `last_used_at`.

```json
{
  "name": "Ana",
  "now": "2026-10-24T17:00:00.000Z",
  "groups": [{ "title": "CSE 340 Team", "assignmentTitle": "Project 2", "dueDate": "2026-11-20", "dueLabel": "Fri, Nov 20", "daysLeft": 27,
    "myTasks": [{ "title": "Write the requirements", "status": "on_track", "points": 5 }], "myTasksLeft": 1, "groupTasksDone": 4, "groupTasksTotal": 12,
    "nextMeeting": { "start": "...", "label": "Tue, Oct 28, 4:00 PM", "mode": "zoom", "joinUrl": "https://zoom.us/j/123", "location": null } }],
  "upcoming": [{ "title": "Lab 4", "course": "CSE 340 (Fall 2026)", "dueAt": "2026-10-27T06:59:00.000Z", "dueLabel": "Sun Oct 26, 11:59 PM", "kind": "assignment" }],
  "counts": { "myTasksLeft": 1, "upcoming": 1, "groups": 1 },
  "summary": "1 task left, 1 thing due in the next 7 days"
}
```

Errors: `401 not_linked` (missing, unknown or revoked token), `429 rate_limited` (30 per token and 120 per IP per 10 minutes).

### `DELETE /api/cubbie/link`

Public, `Authorization: Bearer <token>`. Revokes that token: `{ "ok": true, "message": "Unlinked from Groupie." }`. `401 not_linked` if it was already revoked or unknown. Same rate limits as `/me`.

## Personal agents (step 18a)

Identity is always the verified Telegram user (initData). Request bodies never choose whose data is read or written. Every LLM prompt is built by `buildContext()` in `apps/server/src/contextPolicy.ts`: in a group, the model sees the project facts, the asker's group-safe rows, and only what teammates shared with that group; private rows reach the model only in the asker's own DM or Mini App chat.

### Memory: `GET/POST /api/me/memory`, `PATCH/DELETE /api/me/memory/:id`

```json
{ "items": [{ "id": 3, "key": "work", "value": "Tue and Thu nights", "source": "chat", "visibility": "private", "group_chat_id": null, "updated_at": "..." }] }
```

`POST { "key", "value", "visibility": "private" | "group", "group_chat_id"? }`. Sharing needs `group_chat_id` and membership in that group. Someone else's id returns 404. In chat, "remember ..." saves a private fact and "forget ..." deletes the asker's matching facts.

### Reminders: `GET /api/me/prefs`, `PUT /api/me/prefs`

```json
{ "reminders_enabled": true, "reminder_offsets": [48, 24, 3], "quiet_start": "23:00", "quiet_end": "08:00", "tz": "America/Phoenix", "can_dm": true, "start_link": "https://t.me/CubbieGroupieBot?start=reminders" }
```

`PUT` accepts any subset. Offsets are 1 to 5 whole hours from 1 to 336 (deduped, sorted). A scheduler runs every 15 minutes and sends one batched DM per user with their own calendar items, their groups' due dates, and their open tasks, once per offset, outside quiet hours. `can_dm` turns on with `/start` in a DM and off when Telegram refuses a DM.

### Calendar: `GET /api/calendar/status`, `GET /api/calendar/google/start`, `PUT /api/calendar/ics`, `POST /api/calendar/sync`, `DELETE /api/calendar/:kind`

- Google (free/busy scope only) needs `GOOGLE_USER_CLIENT_ID`/`GOOGLE_USER_CLIENT_SECRET` (a Web OAuth client, redirect `PUBLIC_URL/api/google/callback`); otherwise `google_available` is false and `start` returns 503. `GET /api/google/callback` is public and checks a signed, 10 minute `state`.
- `PUT /api/calendar/ics { "url" }` accepts an https (or webcal) calendar link from Apple, Outlook, or Google; private and local addresses are refused. The link is encrypted at rest and never returned.
- Only busy start and end times are stored (`busy_blocks`), never titles. Canvas timed events count too. Disconnect deletes the token or link and its blocks.

### Availability prefill

`GET /api/groups/:id/availability/me` adds `prefill: { prefilled, busy_slots, hours: { start, end } }` for a member with calendar data. The grid opens with every free slot in reasonable hours (8 to 22 by default, `PREFILL_START_HOUR`/`PREFILL_END_HOUR`) selected; nothing is saved until "Looks right" or the first edit. Nobody else's busy time is ever exposed; the heatmap shows counts only.

### Meeting time

When everyone has answered, the deadline passes (`/deadline 24h|48h|off` or the Lock in 24h / 48h buttons), or someone taps Lock it now, Groupie posts a non-anonymous poll "Which time works?" with the top 3 one-hour slots (most people free, then longest free stretch, then earliest) and a Confirm time button. Confirm picks the most-voted option and continues the meeting flow.

## Dev only (`DEV_MODE=true`, no auth)

| Route | What it shows |
|---|---|
| `GET /dev/state` | Every group with its members and tasks, as JSON |
| `GET /dev/split?group=<id>` | A split computed right now (not saved), drawn as the card |
| `GET /dev/links?group=<id>` | Each member's signed browser link to the availability page |
| `GET /cards/progress?group=<id>&preview=1` | The progress card as HTML (PNG without `preview`) |
| `GET /cards/split?group=<id>&preview=1` | The saved split card as HTML, for design work |
| `GET /cards/split?group=<id>` | The same card as the PNG the bot posts |

## Bot commands

| Command | Where | What |
|---|---|---|
| `/setup` | group | Ask the team size |
| `/join` | group | Repost the "N/5 joined" message with the details button |
| `/split` | group | Repost the current split card |
| `/canvas` | group | Make a Cubbie pair code for this group and show the exact message to text Cubbie |
| `/canvas` | private chat | Make a personal pair code: "Text this to Cubbie: `Groupie import CODE <assignment name>`. I'll send you a plan here." |
| `/imessage` | private chat | Make a link code: "Text Cubbie: `Groupie link CODE`". In a group it only points the student to the DM |
| `/unlink` | private chat | Revoke every iMessage (Cubbie) token of the student |
| `/help` (and `/start` in a DM) | any | Explains every feature |
| `/deadline 24h\|48h\|off` | group | Pick meeting times automatically after a deadline |
| any text | DM | Chat with Groupie privately about your own tasks, deadlines, and groups |
| `/checkin` | group | Post [Done] [On track] [Stuck] for each member's open tasks (also runs Mondays at 10 AM) |
| `/progress` | group | Post the progress card |
| `<nickname>, ...` or `@CubbieGroupieBot ...` | group | Ask about tasks, owners, due dates, the meeting. Replies to Groupie's messages work too |
| `/avail` | group | Post the "When is everyone free?" message with the live counter |
| `/meetlink <link or place>` | group | Set or change the meeting's Zoom/Meet link (or in-person place) and repost the meeting card |
| `/app` | group | Button that opens the Mini App |
| `/settings`, `/rename [name]` | group | Rename the bot for this group |
| `/seed` | group, dev | Fill empty seats with pretend teammates and paint their free times |
| `/reset` | group, dev | Wipe the group and start over |
