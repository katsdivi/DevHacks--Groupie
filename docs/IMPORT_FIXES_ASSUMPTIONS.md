# Import fixes: assumptions

Logged by the lead during the "Cubbie import fixes from the live phone test" run.

1. **Branch base.** `feat/import-fixes` is cut from `feat/step18` (28d1e74), not `main`. Step 18 rewrote the same files these fixes touch (`canvas/bot.ts`, `copy.ts`, `intake.ts`, `bot/index.ts`), so branching from `main` would mean redoing those merges. Step 18 is fully tested (385 server, 43 shared, a 2-run scripted dry run of the 5 demo moments) but not yet deployed, so this ship deploys step 18 and the import fixes together, with both sets of smoke tests (including step 18's restart-survives-DM-history check).
