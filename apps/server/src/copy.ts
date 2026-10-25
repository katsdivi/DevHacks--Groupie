/**
 * User-facing bot copy in one place, so tone, nickname use and button wording stay consistent.
 * Pure strings and tiny functions only: no imports, so anything can use it without a cycle.
 * Rules: no em dashes, no guessed pronouns, no developer terms, "Groupie" when there is no nickname.
 */

/** Escapes text for Telegram HTML. Kept here so copy.ts has no imports. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The fallback name when a group has no nickname (and in DMs). */
export const DEFAULT_NAME = 'Groupie';

// ---------------------------------------------------------------- button labels

/** Same action, same words, everywhere. */
export const BUTTON = {
  open: 'Open Groupie',
  avail: 'Fill your availability',
  code: 'Get my code',
  copy: 'Copy',
  details: 'Add my details',
  swap: 'Request swap',
  fair: 'Looks fair',
  upcoming: 'Open Upcoming',
  addToGroup: 'Add me to a group',
  dmMe: 'DM Groupie',
  nameMe: 'Name me',
  keepName: 'Keep Groupie',
  rename: 'Rename',
  settings: 'Open settings',
  changeSize: 'Change team size',
  updateTasks: 'Update my tasks',
} as const;

// ---------------------------------------------------------------- group Q&A (moment 4)

/** A teammate's private stuff, or a member question with nothing shared. */
export const shareLine = (name: string) => `That's ${name}'s to share.`;
/** Prompt injection or "repeat your context" style asks. Never says what data exists. */
export const REFUSE_INJECTION = 'Nice try. I only talk about this project in here.';
/** Asks for everyone's private info (grades, courses, schedules, notes). */
export const REFUSE_EVERYONE = "Nice try. That's each person's to share, and I only talk about this project in here.";
/** Group trailer when the private half of a self question went by DM. */
export const DM_SENT = 'Sent you the rest in DM.';
/** Group trailer when Telegram will not let the bot DM the asker. */
export const DM_BLOCKED = 'Open a chat with me and tap Start so I can DM you.';
/** Group trailer when the model failed on the private half. */
export const DM_RETRY = "I couldn't finish the private part just now. Ask me again in a sec?";
/** First line of the private half of a self question. */
export const DM_OPENER = "Here's the rest of your answer, just between us:";
/** The model failed on a group question. */
export const buffering = (nickname: string) => `${nickname} here. My brain is buffering. Ask me again in a sec?`;

// ---------------------------------------------------------------- reminders (moment 5)

/** Header of the batched reminder DM. */
export const reminderHead = (n: number) => `Heads up! ${n} ${n === 1 ? 'thing' : 'things'} due soon:`;
/** Footer of the batched reminder DM. */
export const REMINDER_FOOT = "You've got this. Change reminders in Settings.";

// ---------------------------------------------------------------- setup, /start, /help (bot/index.ts)

/** Reply to /start in a DM and to the "reminders" deep link. */
export const REMINDERS_READY = "You're set. I'll DM you before things are due.";
/** First message after Groupie joins a group. */
export const WELCOME = "Hey, I'm Groupie, your group's biggest fan. Want to give me a nickname?";
/** The welcome, edited after [Keep Groupie]. */
export const WELCOME_KEPT = "Hey, I'm Groupie, your group's biggest fan. Groupie it is!";
/** Toast for [Keep Groupie]. */
export const KEPT_TOAST = 'Groupie it is!';
/** A group-only command sent in a DM. */
export const GROUP_ONLY = 'That one works in your project group. Add me there!';
/** After a rename (HTML). */
export const renameText = (name: string) => `New name, who dis. I'm ${esc(name)} now.`;
/** After the first naming (HTML). */
export const namedText = (name: string) => `Call me ${esc(name)} from now on.`;
/** Asks a person to reply with the new name (HTML; `who` is already a mention link). */
export const askNameText = (who: string) => `${who}, reply with my new name.`;
/** The nickname did not parse. */
export const BAD_NAME = 'Hmm, try 1 to 20 letters, numbers or basic punctuation?';
/** /settings in a group (HTML). */
export const settingsText = (nickname: string) => `<b>Settings</b>\nI go by <b>${esc(nickname)}</b> in this group.`;
/** /app in a group (HTML). */
export const appText = (nickname: string) => `${esc(nickname)} here. Tap below to open me.`;
/** Asks for the team size (HTML). */
export const askSizeText = (nickname: string) => `<b>${esc(nickname)} here.</b> How many people are on this project?`;
/** Size button for the real head count. */
export const sizeHereLabel = (n: number) => `${n} (everyone here)`;
/** After the team size is picked (HTML). */
export const askAssignmentText = (size: number) =>
  `<b>Team of ${size}.</b> Love that for us.\nNow drop the assignment file here, or send /canvas to pull it from Canvas.`;
/** The team size picked after the task list already posted (HTML). The join message follows. */
export const sizeSetText = (size: number) => `<b>Team of ${size}.</b> Love that for us.`;
/** A group step needs the team size and the size buttons are close above. */
export const TAP_SIZE_ABOVE = 'Tap a team size above first.';
/** Toast after the team size is picked. */
export const sizeToast = (size: number) => `Team of ${size}!`;
/** Team size tapped after setup. */
export const SIZE_LOCKED = "Team's locked in. Send /reset to start over.";
/** /setup after setup (HTML). */
export const alreadySetUp = (nickname: string) => `${esc(nickname)} here. We're already set up. Send /reset to start over.`;
/** /join before the assignment (HTML). */
export const joinTooEarly = (nickname: string) => `${esc(nickname)} here. Send the assignment file first, then everyone can join.`;
/** /seed before setup (dev only). */
export const SEED_TOO_EARLY = 'Set the team size and send the assignment first, then /seed.';
/** /seed result (dev only). */
export const seededText = (added: number, painted: number) =>
  added || painted ? `Added ${added} pretend teammates${painted ? ` and painted free times for ${painted}` : ''}.` : 'No empty seats to fill.';
/** /reset (dev only). */
export const RESET_DONE = 'Fresh start. Everything for this group is wiped.';

// ---------------------------------------------------------------- check-ins and progress (bot/checkin.ts)

/** Check-in header (HTML). `week` is the optional week-ahead block. */
export const checkinHead = (nickname: string, week: string | null) =>
  `<b>Check-in time!</b> ${esc(nickname)} here. Tap how your tasks are going.${week ? `\n\n${week}` : ''}`;
/** A member with every task done. */
export const ALL_DONE = 'All done. Absolute legend.';
/** /checkin before the split. */
export const NO_CHECKIN_YET = 'Nothing to check in on yet. The split comes first!';
/** /progress before the split. */
export const NO_PROGRESS_YET = 'No progress to show yet. The split comes first!';
/** A check-in button for a task that no longer exists. */
export const TASK_GONE = 'That task is gone.';
/** Someone tapped a teammate's task. */
export const notYourTask = (owner: string) => `That's ${owner}'s task. Nice try!`;
/** Toasts after a status tap. */
export const STATUS_TOAST = { done: 'Done! Love to see it.', stuck: "Flagged. I'll ask the team to help.", on_track: 'On track. Keep going!' } as const;
/** Progress card caption pieces (HTML). */
export const progressHead = (nickname: string, percent: number, when: string) => `<b>${esc(nickname)} here.</b> ${percent}% done${when}.`;
export const progressStuck = (who: string) => `Stuck: ${esc(who)}. Someone help a friend out?`;
export const PROGRESS_ALL_DONE = 'Everything is done. I am so proud of you all.';

// ---------------------------------------------------------------- iMessage link (canvas/link.ts)

/** DM after Cubbie links. */
export const LINKED_DM = "iMessage linked! Text Cubbie 'Groupie status' any time. /unlink to disconnect.";
/** What Cubbie shows after linking. */
export const LINKED_MESSAGE = "Linked to Groupie. Text me 'Groupie status' any time.";
/** /imessage in a group. */
export const IMESSAGE_IN_GROUP = "DM me /imessage and I'll send your code there.";
/** /unlink in a group. */
export const UNLINK_IN_GROUP = 'DM me /unlink to disconnect your iMessage.';
/** /unlink results. */
export const UNLINKED = 'Done, iMessage unlinked. Send /imessage to link it again.';
export const NOT_LINKED = "Your iMessage isn't linked yet. Send /imessage to link it.";
/** Messages Cubbie may relay to the student. */
export const LINK_ERR = {
  unreadable: "Groupie couldn't read that request. Try again?",
  badCode: 'That does not look like a Groupie code. Send /imessage to Groupie for a new one.',
  unknown: 'That link code does not exist. Send /imessage to Groupie for a new one.',
  used: 'That link code was already used. Send /imessage to Groupie for a new one.',
  expired: 'That link code expired. Send /imessage to Groupie for a new one.',
  off: 'iMessage linking is not turned on yet.',
  busy: 'Too many tries. Give it a few minutes and try again.',
  notLinked: 'This Cubbie is not linked yet. Send /imessage to Groupie in Telegram.',
  unlinked: 'Unlinked from Groupie.',
} as const;

// ---------------------------------------------------------------- personal Canvas plan (canvas/personal.ts)

export const PLAN_INTRO = 'Your plan, step by step:';
export const PLAN_FAILED = "I couldn't turn this one into steps. Ask me about it here, or open it in Canvas.";
export const PLAN_SAVED = "It's in your Upcoming list, and I'll remind you before it's due.";
export const PLAN_NO_DUE = "Canvas has no due date for this one, so I didn't add it to your Upcoming list.";

// ---------------------------------------------------------------- wrong app (canvas/bot.ts)

/** Their code was unknown, used, or expired, so a new one is in the message. */
export const CODE_EXPIRED_FRESH = "That code expired, here's a fresh one.";

// ---------------------------------------------------------------- "send me the assignment" (bot/assignmentFile.ts)

/** Caption when the original assignment file is re-sent. */
export const fileCaption = (title: string) => `Here's the assignment: ${title}`;
/** Caption for a PDF made from text that came from Canvas (the original file never reached Groupie). */
export const CANVAS_PDF_CAPTION = "Here's the assignment text from Canvas. Got the original file? Drop it in the group.";
/** Caption for a PDF made from text pasted or read from a file Groupie no longer has. */
export const TEXT_PDF_CAPTION = "Here's the assignment as a PDF.";
/** No assignment anywhere yet. */
export const NO_ASSIGNMENT_FILE = "I don't have the assignment yet. Drop it in your group, or send /canvas there.";
/** The file and the PDF both failed to send. */
export const FILE_SEND_FAILED = "I couldn't send the file just now. Try again in a sec?";

// ---- canvas-ux INSTANT

/** Extra button labels for the instant /canvas answers. */
export const CANVAS_BUTTON = {
  pull: 'Pull full details via Cubbie',
  split: 'Split this one',
  connect: 'Connect calendar',
  viaCubbie: 'Import via Cubbie',
} as const;
/** Something meant for Cubbie was sent to Groupie in Telegram. */
export const WRONG_APP_CUBBIE = "That one's for Cubbie in iMessage.";
/** "Groupie status" from someone whose iMessage is not linked yet. */
export const LINK_FIRST_DM = 'Link your iMessage first: send me /imessage here.';
export const LINK_FIRST_GROUP = 'Link your iMessage first: DM me /imessage.';
/** The wrong-app reply (HTML): the exact Cubbie text in a code block. */
export const wrongAppCubbieText = (message: string, fresh: boolean, extra: string | null = null) =>
  [...(fresh ? [CODE_EXPIRED_FRESH] : []), WRONG_APP_CUBBIE, `<code>${esc(message)}</code>`, ...(extra ? [extra] : [])].join('\n');
/** No calendar items and no imports for this person. */
export const CANVAS_NOT_CONNECTED = "I don't see your Canvas yet.";
/** The install step (HTML), shown only to people whose iMessage is not linked. */
export const installLine = (skillUrl: string) =>
  `<b>First time only:</b> text Cubbie <code>Install this skill: ${esc(skillUrl)}</code> and wait until it's installed.`;
/** Headings for the instant answers. */
export const CANVAS_HEAD = { next: 'Your next one:', week: 'Due in the next 7 days:', named: 'Found it:' } as const;
/** Nothing matched the ask. */
export const CANVAS_NONE = { next: 'Nothing coming up in your Canvas items.', week: 'Nothing due in the next 7 days.' } as const;
/** A named assignment that is not in the person's items (HTML). */
export const canvasNotFound = (q: string) => `I couldn't find "${esc(q)}" in your Canvas items. Cubbie can pull it from Canvas.`;
/** More items than the list shows. */
export const canvasMore = (n: number) => `And ${n} more in Upcoming.`;
/** Group line when the asker's items went by DM. */
export const CANVAS_DM_SENT = 'Sent you the details in DM.';
/** First line of the DM half of a group /canvas ask. */
export const CANVAS_DM_OPENER = 'From your /canvas in the group, just between us:';
/** [Split this one] reply (HTML). */
export const splitText = (title: string, message: string, minutes: number) =>
  `Text Cubbie this to split <b>${esc(title)}</b> here (works once, ${minutes} min):\n<code>${esc(message)}</code>`;
/** [Split this one] tapped by someone other than the asker. */
export const SPLIT_NOT_YOURS = 'Only the asker can split this one. Send /canvas for yours.';
/** [Split this one] when the group already has its assignment. */
export const SPLIT_HAS_ASSIGNMENT = 'This group already has its assignment. Use /reset to start over.';
/** In a group, or found by the asker, but no member row yet. */
export const pendingGroupLine = (title: string) => `You're in ${title || 'your project group'} but haven't added your details yet.`;

// ---------------------------------------------------------------- personal setup checklist (setupStatus.ts, DM /setup and /start)

/** One line per step: what it says while still to do, and once done. Plain text. */
export const SETUP_STEP = {
  group: { todo: 'Add me to your project group', done: (title: string) => `In ${title || 'your project group'}` },
  details: { todo: 'Add your details', waiting: 'Add your details once the assignment is in', done: 'Details added' },
  calendar: { todo: 'Connect your calendar', done: 'Calendar connected' },
  canvas: { todo: 'Connect your Canvas feed', done: 'Canvas feed connected' },
  imessage: { todo: 'Link iMessage through Cubbie', done: 'iMessage linked' },
  reminders: { todo: 'Let me DM you reminders', done: 'Reminders on' },
} as const;
/** Button text for each step. */
export const SETUP_BUTTON = {
  group: 'Add me to a group',
  details: 'Add my details',
  calendar: 'Connect calendar',
  canvas: 'Connect Canvas',
  imessage: 'Link iMessage',
  reminders: 'Turn on reminders',
} as const;
/** How the Cubbie link works, for the Mini App row. Plain text. */
export const IMESSAGE_HINT = 'Tap Link iMessage and I will DM you two texts for Cubbie. Send them and you are linked.';
/** Checklist header (HTML). */
export const setupHead = (done: number, total: number) => `<b>Your setup:</b> ${done} of ${total} done.`;
/** Every step is done. */
export const ALL_SET = "You're all set. I've got you from here.";
/** The last line of the DM /start checklist. */
export const START_HELP_LINE = 'Send /help to see everything I do.';
/** Marks for done and to-do rows. */
export const SETUP_MARK = { done: '✅', todo: '⬜' } as const;

// ---------------------------------------------------------------- group /setup after setup (bot/index.ts)

/** The group's state, for /setup once the group is already set up (HTML). */
export const groupStateText = (s: {
  nickname: string;
  teamSize: number | null;
  assignmentTitle: string | null;
  joined: number;
  meeting: string | null;
}) =>
  [
    `<b>${esc(s.nickname)} here.</b> Here's where we're at:`,
    s.teamSize ? `• Team of ${s.teamSize}` : '• Team size: not picked yet',
    s.assignmentTitle ? `• Assignment: ${esc(s.assignmentTitle)}` : '• Assignment: in',
    s.teamSize ? `• ${s.joined} of ${s.teamSize} joined` : `• ${s.joined} joined`,
    s.meeting ? `• Meeting: ${esc(s.meeting)}` : '• Meeting: not picked yet',
  ].join('\n');
