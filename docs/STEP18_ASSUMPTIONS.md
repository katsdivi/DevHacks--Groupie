# Step 18: assumptions

1. **No new rough-edge list.** The pasted list was the template placeholder. Rough edges reported earlier in the session were used instead (see `docs/DEMO_PATHS.md`, all fixed before step 18).
2. **Branch.** `feat/step18` from `main` at `3ccad44` (step 18a deployed).
3. **File ownership to avoid merge conflicts.** POLISH-A: `canvas/bot.ts`, `canvas/importer.ts` (user-facing text only), `intake.ts`, `bot/assignment.ts`, `bot/joinStatus.ts`, `bot/split.ts`, `cards/*`, `bot/schedule.ts`, `bot/meeting.ts`, web `Canvas.tsx`, `Split.tsx`, `Availability.tsx`, `AvailabilityGrid.tsx`, `CalendarConnect.tsx`, `Form.tsx`, `index.css`. POLISH-B: `bot/qa.ts`, `reminders.ts`, `bot/index.ts`, `bot/guide.ts`, `bot/checkin.ts`, `canvas/link.ts`, `canvas/personal.ts`, a new `copy.ts`, web `Home.tsx`, `Progress.tsx`, `Chat.tsx`, `Memory.tsx`, `Upcoming.tsx`, `Settings.tsx` (except one insertion point for PERSIST). PERSIST: `bot/dm.ts`, `agent.ts` history functions, a new `dmHistory.ts`, migration 10, a new web `components/ClearChatCard.tsx` (inserted into Settings by the lead). DEMO: `llm.ts` (cache), new `scripts/demo/*`, `apps/server/src/demo/*`, `demo.config.example.json`.

## POLISH-B (moments 4 and 5, copy pass)

4. **Refusal tiers in `bot/qa.ts`, all deterministic (no model call).** Checked in this order: (a) injection asks ("ignore your rules", "system prompt", "repeat/print/dump your context", "verbatim", "debug mode", a leading "SYSTEM:") get `REFUSE_INJECTION` ("Nice try. I only talk about this project in here."); (b) "everyone/everybody/all of us/each of you/the whole team" plus a private word (grades, courses, classes, schedules, calendars, notes, private, chats) gets `REFUSE_EVERYONE`; (c) a question about a named teammate with a hard-private word (grades, GPA, marks, scores, transcripts, courses, classes) gets "That's <first name>'s to share." even when that teammate shared other rows here, so the model can never hint at what exists. Softer teammate questions (tonight, busy, free) still answer from shared rows, as before. `classifyQuestion` is unchanged.
5. **Share line uses the first name** ("Ava Li" becomes "That's Ava's to share."), in both the deterministic reply and the member prompt.
6. **Self-question DM opener is fixed text** (`DM_OPENER`, "Here's the rest of your answer, just between us:"), prepended to the model's DM, and the DM prompt tells the model to skip greetings. The group trailer stays "Sent you the rest in DM."
7. **Reminder DM** is plain text (no HTML, so titles need no escaping), with day labels "Today", "Tomorrow", or the weekday in the user's own time zone. It does not name the bot (a DM can cover several groups with different nicknames). The button opens Upcoming in the user's newest membership (highest member row id, seed members excluded); with no group it says "Open Groupie" and links to the bot chat.
8. **`apps/server/src/copy.ts`** holds the strings touched in this pass and has no imports (it carries its own HTML escape), so it can never cause an import cycle. `qa.ts`, `bot/index.ts` and `canvas/link.ts` re-export the names tests already import from them. `bot/guide.ts` stays as is: it is already one self-contained copy function.
9. **Chat "Add your details first" state** has no button because `Chat` gets no `go` prop from `App.tsx` (not my file); the text now names the Home button ("Tap Back, then Add my details").
10. **Settings insertion point** for the lead: `{/* ClearChatCard goes here */}` right after `<Reminders />` at the bottom of `Settings`.

### Copy issues for other owners

| File | Line | Current text | Proposed text | Owner |
|---|---|---|---|---|
| `apps/server/src/canvas/importer.ts` | 127 | `'Body is not JSON.'` | `"Groupie couldn't read that request. Try again?"` | POLISH-A |
| `apps/server/src/canvas/importer.ts` | 132 | `` `${issue.path.join('.') \|\| 'body'}: ${issue.message}` `` / `'Invalid payload.'` | `"Groupie couldn't read this assignment. Try sending it again?"` (log the zod issue server side instead) | POLISH-A |
| `apps/server/src/canvas/importer.ts` | 139 | `'That pair code does not exist. Make a new one in Groupie.'` | `"That code does not exist. Tap Get my code in Groupie for a new one."` | POLISH-A |
| `apps/web/src/screens/Form.tsx` | 93, 140, 183 | `'Join the team'` (button and heading) | Button: `'Add my details'` (the bot button that opens this form says Add my details); heading can stay | POLISH-A |
| `apps/server/src/api.ts` | 154 | `'Send shareWorkload as true or false.'` | `'Something went wrong saving that. Try the switch again?'` | unowned (lead) |
| `apps/server/src/index.ts` | 62, 70, 83, 91 | `'Unknown group. See /dev/state for ids.'` | Dev-only preview routes; fine as is | unowned |
| `cubbie-skill/scripts/send.py` | 251 | `"Groupie could not read this assignment (bad_payload)."` | `"Groupie couldn't read this assignment. Try sending it again."` | DEMO / Skill |
| `cubbie-skill/scripts/send.py` | 253 | `"Groupie rejected the Skill's signature; the Skill needs an update."` | `"Groupie didn't accept this message. Reinstall the Groupie skill and try again."` | DEMO / Skill |
| `cubbie-skill/scripts/link.py` | 43 | `"Linked, but the token could not be saved here. Send /imessage again for a new code."` | `"Linked, but I couldn't save it on this device. Send /imessage again for a new code."` | DEMO / Skill |
