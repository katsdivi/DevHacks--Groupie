// Minimal typing for the bits of Telegram.WebApp we use.
type HapticImpact = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type BottomButton = {
  setParams(p: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
  hide(): void;
};
export type WebApp = {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name: string } };
  version: string;
  platform: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast(v: string): boolean;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  setBottomBarColor?(c: string): void;
  requestWriteAccess?(cb?: (granted: boolean) => void): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  MainButton: BottomButton;
  HapticFeedback: {
    impactOccurred(s: HapticImpact): void;
    notificationOccurred(t: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

const raw = window.Telegram?.WebApp;
/** Present only when we're really inside Telegram (initData is empty in a normal browser). */
export const tg: WebApp | null = raw && raw.initData ? raw : null;

export const BRAND_BG = '#1E1E1E';

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  if (tg.isVersionAtLeast('6.1')) {
    tg.setHeaderColor(BRAND_BG);
    tg.setBackgroundColor(BRAND_BG);
  }
  if (tg.isVersionAtLeast('7.10')) tg.setBottomBarColor?.(BRAND_BG);
  askWriteAccessOnce();
}

/** Lets the bot DM this user later (nudges, swap approvals). Asked once per device. */
function askWriteAccessOnce() {
  if (!tg?.requestWriteAccess || !tg.isVersionAtLeast('6.9')) return;
  try {
    if (localStorage.getItem('groupie.writeAccess')) return;
    localStorage.setItem('groupie.writeAccess', '1');
  } catch {
    return;
  }
  tg.requestWriteAccess();
}

/** Start param from Telegram, or ?startapp= / ?tgWebAppStartParam= when testing in a browser. */
export function startParam(): string | undefined {
  const q = new URLSearchParams(location.search);
  return tg?.initDataUnsafe.start_param ?? q.get('tgWebAppStartParam') ?? q.get('startapp') ?? undefined;
}

export const haptic = {
  tap: () => tg?.HapticFeedback.impactOccurred('light'),
  select: () => tg?.HapticFeedback.selectionChanged(),
  success: () => tg?.HapticFeedback.notificationOccurred('success'),
  error: () => tg?.HapticFeedback.notificationOccurred('error'),
};
