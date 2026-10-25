# Contract change requests

Subagents: do not edit `packages/shared/src/canvas.ts` or the migration. Append what you need here (who, what, why) and work around it. The lead resolves these at integration.

## Skill agent (feat/canvas-skill)

No contract changes needed. Assumptions the server should match (or tell the Skill otherwise):

1. **Error body shape.** `POST /api/cubbie/import` errors are `{ "error": "<code>", "message": "..." }`, like the rest of the API. The Skill tells the three 409s apart by `error`: `code_used` and `code_expired` (ask for a fresh code) versus `not_expecting`. A 409 with any other `error` is treated as `not_expecting`.
2. **Success shape.** 2xx with `ok: true` is success; the Skill prints `message` (falls back to "Sent to Groupie. Check your group.").
3. **Signature.** `X-Groupie-Signature: sha256=<hex>` over the exact raw body bytes. The Skill sends compact JSON (`separators=(",", ":")`, UTF-8, non-ASCII kept) and signs those bytes; the server must verify against `rawBody`, never a re-serialized object.
4. **Pair code is uppercased and trimmed by the Skill** before signing, so the server sees `K7Q2MX` even if the student typed `k7q2mx`.
5. **Due dates.** The Skill requires seconds and a `Z` or `+HH:MM` offset (a subset of `z.string().datetime({ offset: true })`).
6. **Signing key placeholder.** `cubbie-skill/scripts/send.py` ships `GROUPIE_SIGNING_KEY = os.environ.get("GROUPIE_SIGNING_KEY") or "REPLACE_AT_PUBLISH"`. The lead must paste the server's `CUBBIE_HMAC_SECRET` into the public copy at publish time (README, Publishing). Until then every real import is a 401.
7. **Folder name.** The Skill is `name: groupie-import` but lives in `cubbie-skill/` here (assumption 2 in `CANVAS_ASSUMPTIONS.md`); publish it as a folder named `groupie-import`.
