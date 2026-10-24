import { Logo } from './Logo.tsx';

/** Full-screen friendly message for errors and "open me in Telegram". */
export function Message({ title, body, action }: { title: string; body: string; action?: { label: string; href: string } }) {
  return (
    <main className="flex min-h-screen animate-enter flex-col items-center justify-center px-8 text-center">
      <Logo size={56} />
      <h1 className="mt-6 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-muted">{body}</p>
      {action && (
        <a
          href={action.href}
          className="mt-8 rounded-full bg-text px-6 py-3 text-[15px] font-semibold text-ink active:scale-[0.98]"
        >
          {action.label}
        </a>
      )}
    </main>
  );
}
