# What Cubbie can do for Groupie's Canvas import

Groupie's Canvas import, powered by Cubbie, depends on what Cubbie's Canvas ability actually returns. Each row is checked with a live probe (a real ASU assignment through Cubbie, then `pnpm canvas:inspect` or `pnpm feed:inspect` on production). Status: UNTESTED, WORKS, PARTIAL, NO.

| Capability | Status | Evidence | Fallback in Groupie |
|---|---|---|---|
| Skill reaches Groupie's server (`*.up.railway.app`) and the import fits size and time limits | WORKS | 2026-10-25 04:18Z, request `EgwxIVeoS1u8hJ-ass7a6g`: UA `groupie-import-skill/1`, 8.1 KB body, signature verified (it got past the 401 check). Rejected only by Groupie's own team size check (see `docs/IMPORT_FIXES_ASSUMPTIONS.md`, Rejected import 1) | File upload in the group chat (PDF, Word, and more) |
| Rubric returned with the assignment (criteria, points, ratings) | NO (1 import) | Capstone Project I Sprint 3 report, 100 points: the payload had no `rubric` key at all; `assignment` carried `title, dueAt, pointsPossible, descriptionText, url` and an empty description. Recheck on an assignment known to have a Canvas rubric | Tasks come from the description only |
| Attachments: original file bytes vs extracted text only | PARTIAL (text only) | Same import: 1 attachment `{filename, mimeType, text}`, a .docx template as 2,765 characters of extracted text, no `base64` bytes. The kit documents no way for a Skill to save a Canvas file's bytes into the sandbox (quotes below). Phone probe pending: ask Cubbie to send the PDF in iMessage | Attachment text goes into the same intake; drop the file in the chat for full fidelity |
| Canvas group membership readable for a course | UNTESTED | | Teammates join through the Mini App |
| Calendar feed handed over by Cubbie | NOT USED (design decision) | The feed link works like a read-only credential, so Cubbie never sends it to us | Students paste the feed link once in Connect Canvas; it is encrypted at rest |

## What the kit says about files (for the attachments row)

From `imaginix-inc/cubbie-hackathon-kit` at bc505e9, `skills/cubbie-skill-creator/references/cubbie-capabilities.md`:

> | Canvas (*connected*) | Reads courses, assignments and due dates, grades, announcements, discussions, course pages, files and the Canvas inbox; searches and reads course materials |

> | Files and media | Reads photos, PDFs and documents the student sends; transcribes voice notes and videos |

> | Code sandbox | Runs Python and Node scripts in the student's private sandbox, with files that persist; ... |

> - **Scripts cannot call Cubbie's abilities.** There is no Cubbie token in the sandbox. Have Cubbie fetch what the script needs (Canvas, calendar, memory) first, then pass it to the script as arguments or a file. In the other direction, have the script print what Cubbie needs next (for a PDF, the text or Markdown to put in it).

Reading: Cubbie can *read* Canvas files and can hand a script "a file", but nothing documents downloading a Canvas file's original bytes into the sandbox. So the Skill keeps sending what Cubbie read (text), and Groupie never fetches from Canvas itself. If the phone probe shows Cubbie can send the real file in iMessage, the student can forward it to the group, which Groupie already reads.
