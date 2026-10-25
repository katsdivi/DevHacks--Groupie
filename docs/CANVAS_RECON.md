# Canvas recon (read this first)

Every agent working on the Canvas feature reads this file and `docs/CANVAS_ASSUMPTIONS.md` before touching code.

## Stack

| Thing | Where |
|---|---|
| Monorepo | pnpm workspaces. `apps/server` (Express 5, grammY, Playwright cards), `apps/web` (React 19 + Vite + Tailwind 4 Mini App), `packages/shared` (zod schemas and pure logic) |
| Runtime | Node 24, TypeScript run directly with `tsx` (no build step for the server). Imports use explicit `.ts` extensions |
| DB | SQLite via `better-sqlite3` + Drizzle ORM. File at `DATABASE_PATH` |
| Migrations | Hand-written SQL strings appended to `MIGRATIONS` in `apps/server/src/db/index.ts`, tracked by `PRAGMA user_version`. Only ever append. Drizzle table objects mirror them in `apps/server/src/db/schema.ts`. No jsonb: JSON lives in TEXT columns (`text(..., { mode: 'json' })`) |
| Mini App auth | `Authorization: tma <Telegram initData>`, HMAC-checked in `apps/server/src/initData.ts`; `requireAuth` in `apps/server/src/auth.ts` sets `res.locals.tgUser`. Group routes call `loadGroupFor()` in `apps/server/src/api.ts`, which also checks group membership via `getChatMember` |
| API router | `apps/server/src/api.ts` (mounted at `/api`). Dev routes live in `apps/server/src/index.ts` behind `DEV_MODE` |
| Bot | grammY; `apps/server/src/bot/index.ts` wires composers (`assignment`, `split`, `schedule`, `meeting`, `checkin`, `qa`). Bot instance and Mini App URL helpers in `apps/server/src/bot/core.ts` |
| Assignment intake | `apps/server/src/intake.ts` exports `ingestAssignment(groupId, input)`: text in, tasks saved, task list + join message posted. Both the Telegram file upload (`bot/assignment.ts`) and the Cubbie import call it. File-to-text lives in `apps/server/src/parse.ts` (`extractDocumentText(bytes, ext)`), the LLM parse is `parseAssignment(text, teamSize, onWait, extraContext?)` |
| Split algorithm | Pure `split(tasks, members, constraints)` in `packages/shared/src/split.ts`. Tasks `{id, effort, skill_tags}`, members `{id, skills, weak_areas}`, constraints `{locked, forbidden}`. Server glue in `apps/server/src/splitService.ts`; card in `apps/server/src/cards/splitCard.ts` |
| LLM context | Group facts: `groupContext(groupId)` in `apps/server/src/context.ts` (group Q&A and private chat). Private chat turn: `apps/server/src/agent.ts`. Group Q&A: `apps/server/src/bot/qa.ts`. Weekly check-in: `apps/server/src/bot/checkin.ts` |
| Mini App | `apps/web/src/App.tsx` screen stack (`Screen` union in `packages/shared/src/startParam.ts`), screens in `apps/web/src/screens/`, `api()` client in `apps/web/src/api.ts`, Telegram helpers in `apps/web/src/telegram.ts` |
| Commands | `pnpm typecheck`, `pnpm lint`, `pnpm test` (vitest; server tests use an in-memory DB via `apps/server/vitest.config.ts`), `pnpm build` (web). Per package: `pnpm --filter @groupie/server test` etc. |
| Style | 2-space indent, single quotes, short doc comments, no em dashes anywhere (code, copy, docs, commits) |

## Cubbie Skill capabilities

Source: the official kit, `imaginix-inc/cubbie-hackathon-kit`, `skills/cubbie-skill-creator/references/cubbie-capabilities.md` (cited as CAP) and `cubbie-auth.md` (AUTH).

| Capability | Status | Evidence |
|---|---|---|
| Read Canvas assignments: title, due date, description | CONFIRMED | CAP L17: "Reads courses, assignments and due dates, grades, announcements, discussions, course pages, files" |
| Read assignment attachment content (PDF text) | CONFIRMED as text | CAP L17 "files"; CAP L20 Web "reads pages and PDFs"; CAP L25 "Reads photos, PDFs and documents" |
| Hand raw attachment bytes (base64) to a script | UNCLEAR | CAP L35-37: Cubbie passes data "as arguments or a file"; nothing says it can save a Canvas file's binary into the sandbox |
| Points possible | UNCLEAR | Not listed; often part of the assignment Canvas returns, so the Skill sends it only "if Canvas shows it" |
| Rubric (criteria and ratings) | UNCLEAR | Not listed in CAP L17 |
| Canvas group membership | UNCLEAR | Not listed |
| Submission status | CONFIRMED | `examples/canvas-deadline-nudge/SKILL.md` L23 "already submitted" |
| Script sends HTTPS POST to our server | CONFIRMED | CAP L71 "HTTPS (port 443) to any website"; AUTH L53 "Scripts can reach any website over HTTPS" |
| Requires the student's yes before sending | CONFIRMED (rule) | CAP L44-45 |
| Must state plainly that data goes to our server | CONFIRMED (rule) | CAP L46-47 |
| Team secret kept private | NOT ALLOWED | AUTH L43-45: "Team keys are not hosted ... assume anyone who installs the Skill can read it" |
| Sending a student credential to our server | NOT ALLOWED | AUTH L46-47 |
| Cubbie hands the Canvas calendar feed URL to our server | NOT ALLOWED | The feed URL is a secret per-user credential (anyone with it reads the calendar), so AUTH L46-47 applies. Not built; students paste it in the Mini App instead |
| Scripts call Cubbie abilities directly | NOT ALLOWED | CAP L35, L73 |
| MCP servers | NOT ALLOWED | CAP L69 |
| Skill must be in a public git repo to install | CONFIRMED | `cubbie-testing.md` Publish step 1 |
| Script output limit | CONFIRMED | 8,000 characters (`cubbie-testing.md`) |

Consequences for the build:
- The HMAC signing key (`CUBBIE_PUBLIC_SIGNING_KEY`, formerly `CUBBIE_HMAC_SECRET`) ships inside the public Skill, so it is integrity and spam friction only. The real gate is the single-use, 15 minute pair code plus rate limits.
- `POST /api/cubbie/feed` is not built. The Skill has no "Groupie calendar" trigger.
- Attachments are sent as extracted text (`attachments[].text`). The `base64` and `url` shapes stay in the contract for the file upload path and future use, but the Skill does not produce them.
- Rubrics are optional in the payload; the Skill does not request them separately. If Canvas returns rubric text inside the assignment, it arrives as part of `descriptionText`.
