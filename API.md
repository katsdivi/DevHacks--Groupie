# Groupie API

Base URL: `PUBLIC_URL` (production: `https://devhacks-groupie-production.up.railway.app`).
Request and response shapes are zod schemas in `packages/shared/src/api.ts`, used by both the server and the Mini App.

## Auth

Every `/api` request from the Mini App sends Telegram's init data:

```
Authorization: tma <Telegram.WebApp.initData>
```

The server checks the HMAC signature with the bot token, rejects data older than 24 hours, and then confirms with Telegram (`getChatMember`, cached 5 minutes) that the user is in the group they are asking about.

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
| 409 | `no_assignment`, `team_full`, `no_split` | Wrong moment in the flow |

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

`member` is `null` until the user submits the details form. `status` is one of `setup`, `collecting_members`, `split_ready`, `scheduling`, `active`.

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

## Dev only (`DEV_MODE=true`, no auth)

| Route | What it shows |
|---|---|
| `GET /dev/state` | Every group with its members and tasks, as JSON |
| `GET /dev/split?group=<id>` | A split computed right now (not saved), drawn as the card |
| `GET /cards/split?group=<id>&preview=1` | The saved split card as HTML, for design work |
| `GET /cards/split?group=<id>` | The same card as the PNG the bot posts |

## Bot commands

| Command | Where | What |
|---|---|---|
| `/setup` | group | Ask the team size |
| `/join` | group | Repost the "N/5 joined" message with the details button |
| `/split` | group | Repost the current split card |
| `/app` | group | Button that opens the Mini App |
| `/settings`, `/rename [name]` | group | Rename the bot for this group |
| `/seed` | group, dev | Fill empty seats with pretend teammates |
| `/reset` | group, dev | Wipe the group and start over |
