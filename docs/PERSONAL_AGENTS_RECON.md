# Personal agents recon (read this first)

Every agent on step 18a reads this, `docs/PERSONAL_AGENTS_ASSUMPTIONS.md`, and `docs/CANVAS_RECON.md` (stack, conventions, commands) before touching code. Branch: `feat/agents` (based on `feat/cubbie-probes`, which is ahead of `main` by docs and inspect tools only).

## Where the LLM gets context today

| Call site | What it sends | Built by |
|---|---|---|
| Group Q&A, `apps/server/src/bot/qa.ts` `buildQaMessages()` then `talk()` | `voice()` + Q&A rules + `groupContext(groupId)` + the asker's first name and question | `context.ts` `groupContext` |
| Private chat, `apps/server/src/agent.ts` `chatTurn()` then `talk()` | `voice()` + chat rules + `memberContext(member, groupId)` + `groupContext(groupId)` + the member's last 12 `agent_messages` + the new message | `context.ts` `groupContext`, `memberContext`; `agent.ts` `history()` |
| Assignment parsing, `apps/server/src/parse.ts` `buildParseMessages()` then `chat()` | Document text + optional rubric context. No user data | `parse.ts` |

`context.ts` today reads directly: `groups`, `tasks`, `members` (names, skills, weak areas, tg ids), `meetings`, `calendar_events` (via `calendarQueries.ts`: group-course items of all members for groupContext; all of the member's own items for memberContext). After 18a every one of these reads moves behind `contextPolicy.buildContext()`; prompt builders only render its buckets.

## Every query that touches user data

| Module | Tables | Notes |
|---|---|---|
| `members.ts` | members | list, by tg user, upsert, seeds |
| `groups.ts` | groups, tasks, members, pending_inputs | group CRUD, tasks, dev state |
| `availability.ts` | availability, meetings, members, groups | slots, heatmap, meetings |
| `progress.ts` | tasks, groups, members | progress view, task status |
| `splitService.ts` | tasks, members, swap_requests, split_votes, calendar_events (load, opted in only) | split, swaps, votes |
| `calendarQueries.ts` | calendar_events | upcoming, by course, load scores |
| `context.ts` | groups, tasks, members, meetings, calendar_events | LLM context (to be replaced) |
| `agent.ts` | agent_messages | private chat history (owner only) |
| `canvas/*.ts` | cubbie_pair_codes, cubbie_imports, calendar_feeds, calendar_events | Canvas import and feed |
| `bot/*.ts` | via the modules above | messages, cards, check-ins |
| `api.ts` | via the modules above | Mini App routes; identity from `res.locals.tgUser` (verified initData) or `res.locals.link` (signed browser link) |

## Identity

- Mini App: `requireAuth` in `apps/server/src/auth.ts` verifies Telegram initData; `tgUser(res).id` is the only trusted user id.
- Browser links: `linkAuth(res)` (signed token: group id, member id, expiry), availability routes only.
- Bot: `ctx.from.id` from Telegram updates.
- Never trust a user id, member id, or name sent in a request body.

## Scheduling, reminders, OAuth, jobs

- Availability grid: `apps/web/src/components/AvailabilityGrid.tsx`, `apps/web/src/screens/Availability.tsx`; API `GET/PUT /api/groups/:id/availability/me`, `GET /api/groups/:id/heatmap`; best windows in `availability.ts` `bestWindows()`.
- Meeting flow: `bot/schedule.ts` (`postAvailStatus`, `onAvailabilityChanged`, `lockMeeting` posts best time + poll + invite button) and `bot/meeting.ts` (link capture, card, .ics, Google event, DMs).
- Google today: ONE team account (Desktop OAuth client, `pnpm google:auth`, scopes calendar.events + gmail.send) in `calendar.ts` and `gmail.ts`. Per-user OAuth is new in 18a.
- Background jobs: `bot/checkin.ts` `startWeeklyCheckins()` (15 min), `canvas/poller.ts` `startFeedPoller()` (30 min), both started in `index.ts`.
- Encryption at rest: `canvas/crypto.ts` (AES-256-GCM with `FEED_ENCRYPTION_KEY`).
