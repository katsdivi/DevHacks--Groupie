# Canvas UX: assumptions

Logged by the lead for "make /canvas feel instant + make iMessage linking useful".

## Before anything: the last rejection is fixed and deployed

- Fix deployed in merge `b25e53d` (Railway SUCCESS, smoke tests passed: every rejection code, 413 JSON, key hash match).
- Production evidence after the deploy: `cubbie_imports` id 3, code BERXPX, group -5305218337, created 2026-10-25T05:08:02Z, status **imported**, 7,727 bytes. So a real Cubbie import has succeeded since the fix. The group sits in `collecting_members` with `team_size` NULL, waiting for a size tap (the new flow).

## Why "Groupie status" said "not in a project group"

- Telegram user 8484575705 has **zero `members` rows** in production (checked 2026-10-25 ~05:20Z). The test group was `/reset` (which deletes the group's members) and nobody has tapped Add my details since. The user did create codes for that group (`/canvas`) and is linked (`cubbie_links` row 05:18Z, not revoked).
- So the membership read was correct by the data, but unhelpful: the user is in the Telegram group and drove its import, yet "not in a project group" reads as broken. Fix (INSTANT): status and membership answers also recognise groups where the user is a Telegram member or made the group's codes but has not added details, and say "You're in <group> but haven't added your details yet" with the Add my details button. Regression test for a user with codes and no member row.

## Import 3: what the tasks came from

`pnpm canvas:inspect`: import 3 (2026-10-25 05:08Z, group -5305218337) imported; course "Capstone Project I (2026 Fall C)", due 2026-10-27 23:59 -07:00, 100 points, description 4,411 characters, no rubric, 1 attachment as **text** (2,765 characters, .docx template), no bytes.

Source of the 12 tasks (measured on production without printing any assignment text: per task, distinct words found only in the description, only in the template, or in both): the template mirrors the description, so most words are shared; words unique to one source total 15 from the description and 3 from the template (one each in "Assemble evidence appendix", "Update EPICs and user stories", "Compile risk management"). So the tasks came mainly from the assignment description; the template only nudged three section-shaped tasks. The intake already orders the text as header, description, then attachments.
