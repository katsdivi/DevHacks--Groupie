# What Cubbie can do for Groupie's Canvas import

Groupie's Canvas import, powered by Cubbie, depends on what Cubbie's Canvas ability actually returns. Each row is checked with a live probe (a real ASU assignment through Cubbie, then `pnpm canvas:inspect` or `pnpm feed:inspect` on production). Status: UNTESTED, WORKS, PARTIAL, NO.

| Capability | Status | Evidence | Fallback in Groupie |
|---|---|---|---|
| Skill reaches Groupie's server (`*.up.railway.app`) and the import fits size and time limits | UNTESTED | | File upload in the group chat (PDF, Word, and more) |
| Rubric returned with the assignment (criteria, points, ratings) | UNTESTED | | Tasks come from the description only |
| Attachments: original file bytes vs extracted text only | UNTESTED | | Attachment text goes into the same intake; drop the file in the chat for full fidelity |
| Canvas group membership readable for a course | UNTESTED | | Teammates join through the Mini App |
| Calendar feed handed over by Cubbie | NOT USED (design decision) | The feed link works like a read-only credential, so Cubbie never sends it to us | Students paste the feed link once in Connect Canvas; it is encrypted at rest |
