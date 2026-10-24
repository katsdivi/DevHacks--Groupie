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

## Deploy

One Railway service built from the `Dockerfile`, with a volume mounted at `/data` for SQLite.
