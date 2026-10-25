# Contract change requests

Subagents: do not edit `packages/shared/src/canvas.ts` or the migration. Append what you need here (who, what, why) and work around it. The lead resolves these at integration.

## UI agent (feat/canvas-ui): assumptions, no contract change needed

- **Upcoming day grouping uses the device time zone.** `MeResponse.group` has no `tz`, so Today/Tomorrow/weekday and due times follow the browser's local zone. If the lead adds `tz` to `MeResponse.group`, swap `dayKey`/`timeOf` in `apps/web/src/screens/Upcoming.tsx` to format in that zone.
- **"No feed" detection.** The spec does not say what `GET /api/feed/upcoming` returns when nothing is connected, so the Upcoming screen fetches `/feed/status` and `/feed/upcoming` in parallel and branches on `connected`.
- **`PUT /api/feed` response body is ignored.** After a successful PUT the UI refetches `/feed/status`. The pasted URL is cleared from state right after the PUT and never rendered again (the connected view shows a masked `feeds/••••` placeholder).
- **`sms:&body=` link.** `tg.openLink` is documented for http(s) only, so "Open Messages" is a real `<a href="sms:&body=...">`, tries `openExternal` first, and falls back to `location.href` if Telegram throws.
- **Pair code 404 while polling** is treated as expired. Network errors keep polling. Polling pauses while the page is hidden and stops on imported, failed, expired, or unmount. The countdown also flips the code to expired locally at `expiresAt`.
- **"Already has its assignment" rule** in the Canvas screen: status not in `setup`/`collecting_members`, or `task_count > 0 && joined > 0`. Then the import card shows a calm note and no code button; calendar sync still works.
- **Course colors** are a string hash of the full course name into `MEMBER_COLORS` (`apps/web/src/components/Course.tsx`); chips drop the trailing term, so "CSE 340 (Fall 2026)" reads "CSE 340".
