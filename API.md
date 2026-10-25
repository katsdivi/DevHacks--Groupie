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

Link auth only works on the three availability endpoints below, and only for the token's own group and member. Everything else returns `403 link_scope`. Expired or forged tokens return `401 link_expired`. Get each member's link from `GET /dev/links?group=<id>` (this is what the Track 1 Cubbie skill emails).

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

Students never open Canvas for Groupie. Our Track 1 Cubbie Skill asks Cubbie (which already has the student's Canvas) to read an assignment and send it here with a one-time pair code. A pasted Canvas calendar feed keeps due dates in sync. Schemas: `packages/shared/src/canvas.ts`. What Cubbie can and cannot do: `docs/CANVAS_RECON.md`.

### `POST /api/cubbie/pair-code`

Telegram auth. Makes a single-use code (6 characters, no lookalikes, 15 minutes).

```json
{ "groupChatId": -5254546157 }
```

`groupChatId` is optional; when set, the caller must be in that group, and the import posts there. Response:

```json
{ "code": "K7Q2MX", "expiresAt": "2026-10-25T02:15:00.000Z", "cubbieMessage": "Groupie import K7Q2MX" }
```

`cubbieMessage` is the exact text the student sends Cubbie.

### `GET /api/cubbie/pair-code/:code`

Telegram auth, only the code's owner. Live status for the Mini App: `waiting`, `received`, `imported`, `failed`, or `expired`.

```json
{ "code": "K7Q2MX", "status": "imported", "expiresAt": "...", "assignmentTitle": "Project 2: Campus Food Finder", "error": null }
```

### `POST /api/cubbie/import`

Called by the Cubbie Skill script. No Telegram auth: the single-use pair code in the body is the gate, plus a signature header and rate limits.

```
X-Groupie-Signature: sha256=<hex HMAC-SHA256(CUBBIE_HMAC_SECRET, raw body)>
```

The HMAC secret ships inside the public Skill, so it is integrity and spam friction, not a real secret (Cubbie cannot host team keys). Body (`CubbieImportPayload`):

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

Errors: `400 bad_payload`, `401 bad_signature`, `404 unknown_code`, `409 code_used` or `code_expired`, `409 not_expecting` (the group already has its assignment), `429 rate_limited`.

### `PUT /api/feed`, `DELETE /api/feed`, `GET /api/feed/status`, `GET /api/feed/upcoming`

Telegram auth, per Telegram user (not per group).

- `PUT /api/feed` `{ "feedUrl": "https://canvas.asu.edu/feeds/calendars/user_....ics" }` saves the Canvas calendar feed (encrypted at rest, AES-256-GCM) and polls it right away. Only `https://canvas.asu.edu/feeds/...` is accepted (`webcal://` is rewritten). The URL is never logged, returned, or shown in chat.
- `DELETE /api/feed` disconnects and deletes the stored events.
- `GET /api/feed/status`: `{ "connected": true, "lastPolledAt": "...", "lastError": null, "eventCount": 9, "courses": ["CSE 340 (Fall 2026)", "HST 101 (Fall 2026)"] }`
- `GET /api/feed/upcoming`: `{ "events": [FeedEvent, ...] }`, the caller's own items, soonest first.

The server polls each feed every 30 minutes with conditional GETs (ETag / If-Modified-Since) and backs off on errors. `POST /api/cubbie/feed` (Cubbie handing over the feed URL) is not built: the feed URL is a credential, and Cubbie Skills may not send credentials to a team's server.

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
| `/checkin` | group | Post [Done] [On track] [Stuck] for each member's open tasks (also runs Mondays at 10 AM) |
| `/progress` | group | Post the progress card |
| `<nickname>, ...` or `@CubbieGroupieBot ...` | group | Ask about tasks, owners, due dates, the meeting. Replies to Groupie's messages work too |
| `/avail` | group | Post the "When is everyone free?" message with the live counter |
| `/meetlink <link or place>` | group | Set or change the meeting's Zoom/Meet link (or in-person place) and repost the meeting card |
| `/app` | group | Button that opens the Mini App |
| `/settings`, `/rename [name]` | group | Rename the bot for this group |
| `/seed` | group, dev | Fill empty seats with pretend teammates and paint their free times |
| `/reset` | group, dev | Wipe the group and start over |
