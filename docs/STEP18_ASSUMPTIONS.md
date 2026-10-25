# Step 18: assumptions

1. **No new rough-edge list.** The pasted list was the template placeholder. Rough edges reported earlier in the session were used instead (see `docs/DEMO_PATHS.md`, all fixed before step 18).
2. **Branch.** `feat/step18` from `main` at `3ccad44` (step 18a deployed).
3. **File ownership to avoid merge conflicts.** POLISH-A: `canvas/bot.ts`, `canvas/importer.ts` (user-facing text only), `intake.ts`, `bot/assignment.ts`, `bot/joinStatus.ts`, `bot/split.ts`, `cards/*`, `bot/schedule.ts`, `bot/meeting.ts`, web `Canvas.tsx`, `Split.tsx`, `Availability.tsx`, `AvailabilityGrid.tsx`, `CalendarConnect.tsx`, `Form.tsx`, `index.css`. POLISH-B: `bot/qa.ts`, `reminders.ts`, `bot/index.ts`, `bot/guide.ts`, `bot/checkin.ts`, `canvas/link.ts`, `canvas/personal.ts`, a new `copy.ts`, web `Home.tsx`, `Progress.tsx`, `Chat.tsx`, `Memory.tsx`, `Upcoming.tsx`, `Settings.tsx` (except one insertion point for PERSIST). PERSIST: `bot/dm.ts`, `agent.ts` history functions, a new `dmHistory.ts`, migration 10, a new web `components/ClearChatCard.tsx` (inserted into Settings by the lead). DEMO: `llm.ts` (cache), new `scripts/demo/*`, `apps/server/src/demo/*`, `demo.config.example.json`.

## PERSIST

4. **DM history window.** The model now sees the newest 12 stored DM messages (the `loadDm` default), down from 24 in the old in-memory map. Storage keeps 50 per user.
5. **Memory-intent turns are stored.** "remember ..." and "forget ..." turns go into `dm_messages` like any other turn, as the in-memory map did.
6. **Clear is Telegram-only.** `DELETE /api/me/chat` returns 401 for browser link auth, matching `/api/me/memory`. Response: `{ ok: true, cleared: { dm } }`. Per the user, history is the Telegram DM only: it never mixes in Mini App chat, clearing touches only the Telegram DM, and the model sees just the last 12 messages.
7. **`api.ts` mount.** One `api.use(chatRouter)` line plus its import line.
8. **`/forgetchat` in the command menu.** Not added: `setMyCommands` lives in `index.ts`, outside PERSIST ownership. The lead can add `{ command: 'forgetchat', description: 'Wipe our chat history' }` there and mention it in `/help`.
9. **`clearAppChat` lives in `dmHistory.ts`**, not `agent.ts`, so both clears share one transaction in `clearMyChat`.
