# Contract change requests (step 18a)

Agents: do not edit `apps/server/src/contextPolicy.ts` signatures, `packages/shared/src/agents.ts`, migration 8, or `db/schema.ts`. Append what you need here (who, what, why) and work around it. The lead resolves at integration.

- **REMIND (optional): export `OFFSET_CHOICES` from `packages/shared/src/agents.ts`.** The Mini App chips (72, 48, 24, 12, 6, 3, 1) and `apps/server/src/prefs.ts` each define the list. Worked around by duplicating it.
- **REMIND (optional): note in `PrefsUpdateRequest` that the server dedupes and sorts offsets.** No schema change needed; documentation only.
