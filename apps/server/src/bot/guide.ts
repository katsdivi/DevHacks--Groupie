import { html } from './format.ts';

/** Everything Groupie does, for /start and /help (Telegram HTML, well under the 4,096 character limit). */
export function featureGuide(nickname = 'Groupie'): string {
  const n = html(nickname);
  return [
    `<b>Hey, I'm ${n}</b>, your group project's biggest fan. Here's everything I do:`,
    '',
    '<b>In your project group</b>',
    '• Add me to the group chat, give me a nickname (/rename), and pick your team size (/setup).',
    '• Drop the assignment (PDF, Word, slides and more) or pull it straight from Canvas through Cubbie (/canvas). I break it into tasks with effort points.',
    '• Everyone taps Add my details, then I split the work fairly (usually within 1 point) and post the split card. Want to trade? Request a swap any time (/split).',
    '• Paint when you are free (/avail). Connect your calendar and the grid fills itself. I suggest the best 3 times, run a quick poll, and send the invite with a Meet or Zoom link, a calendar file, and DMs (/meetlink to change the link, /deadline to decide automatically).',
    '• Check-ins every Monday and on /checkin, plus a progress card (/progress) that shows who might need a hand.',
    `• Ask me anything about the project: "${n}, what's due?" or "${n}, who's stuck?"`,
    '',
    '<b>Just for you</b>',
    '• Chat with me right here: what to do first, step-by-step plans, or "remember I work Thursday nights".',
    '• Reminders before things are due (48, 24 and 3 hours by default, with quiet hours). Change them in Settings.',
    '• /canvas here: send me your own Canvas assignment through Cubbie and I will DM you a plan.',
    '• /imessage: link Cubbie so you can text "Groupie status" from iMessage.',
    '• In the app: Upcoming (all your Canvas due dates), Connect your calendar, and What I remember (you choose what your group sees).',
    '',
    '<b>Privacy</b>: your chats with me, your other classes, and your calendar details never go to the group. Only what you choose to share does. Send /forgetchat here to wipe our chat.',
    '',
    'Send /help any time to see this again.',
  ].join('\n');
}
