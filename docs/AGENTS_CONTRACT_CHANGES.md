# Contract change requests (step 18a)

Agents: do not edit `apps/server/src/contextPolicy.ts` signatures, `packages/shared/src/agents.ts`, migration 8, or `db/schema.ts`. Append what you need here (who, what, why) and work around it. The lead resolves at integration.

- **POLICY: `bot/index.ts` one-line registration.** `bot.filter((ctx) => ctx.chat?.type === 'private').use(dmComposer)` after `qaComposer`, so DM plain text gets a reply. Other agents adding DM handlers (BRIDGE `/canvas` in DMs, REMIND `/start`) should register before it; it ignores commands and pending inputs.
- **POLICY: `MemoryUpdateRequest` has no `key`.** The Memory screen edits values only. If renaming labels matters, add `key: z.string().trim().min(1).max(60).optional()`.
- **POLICY: `contextPolicy.ts` unchanged.** Bucket narrowing (`onlyMember`, `withoutTeammates`) and the DM context (`buildDmContext`) live in `context.ts` and only call `buildContext`. The lead may move them into contextPolicy.ts at integration.
