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

## Canvas via Cubbie (optional)

- `CUBBIE_PUBLIC_SIGNING_KEY` (renamed from `CUBBIE_HMAC_SECRET`): signs `POST /api/cubbie/import`. Make it with `openssl rand -hex 32`. Empty means every import is refused with 503.
- `FEED_ENCRYPTION_KEY`: 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts pasted Canvas calendar feed URLs at rest. Missing or the wrong length means feeds cannot be saved and the poller stays off.

The feed poller starts with the server and checks each feed every 30 minutes. Code lives in `apps/server/src/canvas/`.

The signing key is public by design. Cubbie cannot host team keys, so the value ships inside the public Skill (as `GROUPIE_SIGNING_KEY` in `cubbie-skill/scripts/send.py`) and anyone can read it. It is integrity and spam friction only; single-use, 15 minute pair codes plus rate limits are the real protection. Never reuse another secret for it: the server refuses to start if `CUBBIE_PUBLIC_SIGNING_KEY` equals `FEED_ENCRYPTION_KEY`, `BOT_TOKEN`, `WEBHOOK_SECRET`, `LINK_SIGNING_SECRET`, `GROQ_API_KEY`, `GOOGLE_CLIENT_SECRET` or `GOOGLE_REFRESH_TOKEN`, or if `FEED_ENCRYPTION_KEY` equals any of the others.

## Deploy

One Railway service built from the `Dockerfile`, with a volume mounted at `/data` for SQLite.

To copy the Canvas variables (`CUBBIE_PUBLIC_SIGNING_KEY`, `FEED_ENCRYPTION_KEY`, `LOAD_AWARE_SPLIT`) from the repo-root `.env` to the linked Railway service without triggering a deploy:

```bash
scripts/railway-env.sh --dry-run   # validate; prints names and lengths only, never values
scripts/railway-env.sh             # railway variable set KEY --stdin --skip-deploys, one per key
scripts/railway-env.sh --delete-old  # also delete the old CUBBIE_HMAC_SECRET, once the renamed code is live
```

It refuses if any of the three is empty, or if the signing key equals the feed key. `-s SERVICE` and `-e ENVIRONMENT` pass through to `railway`. `railway variable delete` has no `--skip-deploys`, so `--delete-old` may start a redeploy; run it after the new code is deployed.
