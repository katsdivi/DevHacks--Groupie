import { Logo } from './Logo.tsx';

export function Header({ nickname, title }: { nickname: string; title: string }) {
  return (
    <header className="flex items-center gap-3 px-5 pt-5 pb-2">
      <Logo />
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold leading-tight">{nickname}</div>
        <div className="truncate text-[13px] text-muted">{title}</div>
      </div>
    </header>
  );
}
