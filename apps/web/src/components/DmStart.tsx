import { haptic, openTelegram } from '../telegram.ts';

/** Card that opens the bot DM with /start reminders, so Telegram lets Groupie DM this person. */
export function DmStart({ link, text = 'Tap here so I can send you reminders' }: { link: string; text?: string }) {
  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        haptic.tap();
        openTelegram(link, e);
      }}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-line-strong bg-panel px-4 py-4 text-left active:opacity-70"
    >
      <span>
        <span className="block text-[16px] font-semibold">{text}</span>
        <span className="mt-1 block text-[13px] text-muted">Opens a chat with me. Hit Start and you're done.</span>
      </span>
      <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M6 3.5h6.5V10M12.5 3.5L4 12" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
