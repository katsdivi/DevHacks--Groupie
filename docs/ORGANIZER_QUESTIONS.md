# Questions for the Cubbie organizers

Each one is a capability the kit docs do not clearly allow, so the Canvas build works around it. A "yes" unlocks the item in the last column. Paste these in the hackathon Discord.

| # | Question | Why we ask | Built today instead | Unlocks if yes |
|---|---|---|---|---|
| 1 | Does a Track 1 Skill that sends data to our own HTTPS server still count as "runs with Cubbie's existing abilities, no backend needed"? | Rules say no backend is needed; our Skill posts to Groupie's server | The Skill does it, with a plain disclosure and the student's yes | Confirms our Track 1 entry is eligible |
| 2 | Can Cubbie's Canvas ability return an assignment's **rubric** (criteria, points, ratings)? | The capability list names assignments, files, pages, but not rubrics | Rubric is optional; only sent if Canvas includes it with the assignment | Tasks mapped to rubric criteria for every import |
| 3 | Can Cubbie save a Canvas **attachment's original file** (PDF bytes) into the Skill sandbox for a script to read? | Docs say Cubbie passes data "as arguments or a file", not whether binary files work | Attachments are sent as extracted text | Original files go through our full file intake (tables, layout) |
| 4 | Can Cubbie's Canvas ability read **Canvas group membership** for a course? | Not listed | Members join through the Telegram Mini App | Auto-fill the team from the Canvas group, with school emails |
| 5 | May a Skill hand the student's **Canvas calendar feed URL** to our server if the student says yes? It works like a read-only credential | `cubbie-auth.md` says never send credentials to the team's server | Students paste the feed link into our Mini App themselves | One-tap calendar sync through Cubbie ("Groupie calendar CODE") |
| 6 | Is `*.up.railway.app` reachable from the Skill sandbox, and are there request size or time limits? | Our import payload can be tens of KB with attachment text | Payload capped (60k chars per text field, 5 attachments) | Confidence that large assignments import |
| 7 | Is a signing key embedded in a public Skill acceptable, given team keys are not hosted? | Kit says to assume anyone can read a shipped key | Pair codes (single use, 15 min) are the real gate; the key is spam friction | Nothing; confirms the approach |
| 8 | Can our Track 1 Skill feed our Track 3 bot for judging, or is Track 1 judged on its own? | One story across tracks | Both work standalone (Track 3 also accepts file uploads) | Present them as one connected demo |
