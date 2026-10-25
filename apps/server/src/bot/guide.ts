import { html } from './format.ts';

/** The short guide for /start and /help (Telegram HTML). Details live in the app and behind buttons. */
export function featureGuide(nickname = 'Groupie'): string {
  const n = html(nickname);
  return [
    `<b>Hi, I'm ${n}!</b> Your group project's biggest fan.`,
    '',
    '<b>In your group</b>',
    '• /setup to start, /rename to rename me',
    '• Drop the assignment or send /canvas, then /split',
    '• /avail finds a meeting time (/deadline, /meetlink)',
    `• /checkin, /progress, or ask "${n}, what's due?"`,
    '',
    '<b>Just for you</b>',
    '• DM me for plans and reminders, /canvas for your own work',
    '• /imessage links Cubbie. The app has Upcoming and your calendar.',
    '• Your chats, other classes and calendar details stay private unless you share. /forgetchat wipes our chat.',
  ].join('\n');
}
