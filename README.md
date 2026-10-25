# Groupie

Your group project's biggest fan. A Telegram bot (@CubbieGroupieBot) plus a Telegram Mini App that splits group assignments fairly, finds a meeting time, and keeps everyone on track.

See `SPEC.md` for the full plan and build order.

## Layout

- `apps/server`: Express API, grammY bot, Playwright card renderer, SQLite
- `apps/web`: React + Vite + Tailwind Mini App, built to static files served by the server
- `packages/shared`: shared types and zod schemas

## Setup

```sh
pnpm install
cp .env.example .env        # then fill in values
cd apps/server && pnpm exec playwright install chromium && cd ../..
```

## Run

```sh
pnpm dev          # server on :3000 (watch mode) and Vite on :5173
pnpm build        # build the Mini App into apps/web/dist
pnpm start        # serve API + built Mini App on :3000
pnpm typecheck
pnpm lint
pnpm test
```

Health check: http://localhost:3000/health

## Bot modes

`BOT_MODE` controls how the bot gets updates:

- `webhook` (default in production): Telegram posts to `<PUBLIC_URL>/tg/webhook`.
- `off` (default locally): the server runs without the bot.
- `polling`: run the bot from your laptop. This removes the production webhook, so redeploy (or restart the Railway service) afterwards to hand the bot back.

## Local HTTPS for the Mini App

```sh
cloudflared tunnel --url http://localhost:3000
```

Put the printed https URL in `PUBLIC_URL`.

## Google Calendar (optional)

Without keys, Groupie still shares the meeting: a card with the join link, an "Add to Google Calendar" button, an .ics file, and DMs. With keys it also creates the event on your Google account, adds a Meet link, and emails invites.

1. In Google Cloud Console: enable the Google Calendar API, set up the OAuth consent screen (External, add your Gmail as a test user), and create an OAuth client ID of type Desktop app.
2. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.
3. Run `pnpm google:auth` and click Allow. It saves `GOOGLE_REFRESH_TOKEN` to `.env`.
4. Set all three on Railway.

## Personal calendars, busy times only (optional)

Each person can connect their own calendar in the Mini App (Connect your calendar). Groupie stores only start and end times for the next 14 days, never titles, and syncs every 30 minutes. Canvas timed events (not due dates) count too, as one hour blocks.

- Calendar link (ICS): works with no extra setup beyond `FEED_ENCRYPTION_KEY`. Apple iCloud public links (`webcal://`), Outlook published ICS links, and Google's Secret address in iCal format. Links are encrypted at rest and never logged or returned.
- Google sign in: needs a separate OAuth client of type Web application (the team client above is a Desktop client). Authorized redirect URI `PUBLIC_URL/api/google/callback`, scope `https://www.googleapis.com/auth/calendar.freebusy` only. Set `GOOGLE_USER_CLIENT_ID` and `GOOGLE_USER_CLIENT_SECRET` (plus `PUBLIC_URL`, `LINK_SIGNING_SECRET`, `FEED_ENCRYPTION_KEY`). Without them the Google option is hidden. While the consent screen is in testing mode, add every teammate's Google email as a test user, and note that refresh tokens expire after 7 days (they reconnect from the Mini App).

Code: `apps/server/src/calendarSync.ts`, `busy.ts`, `googleUser.ts`, `icsBusy.ts`, `routes/calendar.ts`, `routes/googleCallback.ts`.

## Canvas via Cubbie (optional)

- `CUBBIE_PUBLIC_SIGNING_KEY` (renamed from `CUBBIE_HMAC_SECRET`): signs `POST /api/cubbie/import`. Make it with `openssl rand -hex 32`. Empty means every import is refused with 503.
- `FEED_ENCRYPTION_KEY`: 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts pasted Canvas calendar feed URLs at rest. Missing or the wrong length means feeds cannot be saved and the poller stays off.

The feed poller starts with the server and checks each feed every 30 minutes. Code lives in `apps/server/src/canvas/`.

Inspect production, read-only: `pnpm canvas:inspect [N]` (latest imports: status, rubric, attachment kinds and sizes, never the text) and `pnpm feed:inspect <telegram_user_id>` (calendar item stats, never the feed link). Both accept `--local <db>` for a backup copy. They use the app's `better-sqlite3` in read-only mode because the container has no `sqlite3` CLI. What Cubbie can and cannot do, with live evidence: `docs/CUBBIE_CAPABILITIES.md`.

The signing key is public by design. Cubbie cannot host team keys, so the value ships inside the public Skill (as `GROUPIE_SIGNING_KEY` in `cubbie-skill/scripts/send.py`) and anyone can read it. It is integrity and spam friction only; single-use, 15 minute pair codes plus rate limits are the real protection. Never reuse another secret for it: the server refuses to start if `CUBBIE_PUBLIC_SIGNING_KEY` equals `FEED_ENCRYPTION_KEY`, `BOT_TOKEN`, `WEBHOOK_SECRET`, `LINK_SIGNING_SECRET`, `GROQ_API_KEY`, `GOOGLE_CLIENT_SECRET` or `GOOGLE_REFRESH_TOKEN`, or if `FEED_ENCRYPTION_KEY` equals any of the others.

## Personal agents

- `GOOGLE_USER_CLIENT_ID`, `GOOGLE_USER_CLIENT_SECRET`: optional per-user Google free/busy. Create a **Web application** OAuth client with redirect URI `PUBLIC_URL/api/google/callback` and scope `calendar.freebusy`. In Google testing mode each teammate's Gmail must be a test user, and tokens expire after 7 days. Without these, students connect with a calendar link (ICS) instead.
- `PREFILL_START_HOUR`, `PREFILL_END_HOUR`: the hours the availability grid treats as reasonable when prefilling (default 8 and 22).
- Background jobs started with the server: reminders (15 min), calendar sync (30 min), availability deadlines (5 min), feed poller (30 min), weekly check-in.

## Deploy

One Railway service built from the `Dockerfile`, with a volume mounted at `/data` for SQLite.

To copy the Canvas variables (`CUBBIE_PUBLIC_SIGNING_KEY`, `FEED_ENCRYPTION_KEY`, `LOAD_AWARE_SPLIT`) from the repo-root `.env` to the linked Railway service without triggering a deploy:

```bash
scripts/railway-env.sh --dry-run   # validate; prints names and lengths only, never values
scripts/railway-env.sh             # railway variable set KEY --stdin --skip-deploys, one per key
scripts/railway-env.sh --delete-old  # also delete the old CUBBIE_HMAC_SECRET, once the renamed code is live
```

It refuses if any of the three is empty, or if the signing key equals the feed key. `-s SERVICE` and `-e ENVIRONMENT` pass through to `railway`. `railway variable delete` has no `--skip-deploys`, so `--delete-old` may start a redeploy; run it after the new code is deployed.
