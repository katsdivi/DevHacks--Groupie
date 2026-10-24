import { useEffect } from 'react';
import { tg } from './telegram.ts';

type Opts = { text: string; onClick: () => void; enabled: boolean; loading?: boolean };

/**
 * Drives Telegram's MainButton. Returns false when not inside Telegram,
 * so the screen can render its own button instead.
 */
export function useMainButton({ text, onClick, enabled, loading }: Opts): boolean {
  useEffect(() => {
    if (!tg) return;
    const mb = tg.MainButton;
    mb.setParams({
      text,
      color: enabled ? '#F5F5F5' : '#3A3A3A',
      text_color: enabled ? '#1E1E1E' : '#8A8A8A',
      is_active: enabled,
      is_visible: true,
    });
    if (loading) mb.showProgress(false);
    else mb.hideProgress();
    mb.onClick(onClick);
    return () => mb.offClick(onClick);
  }, [text, onClick, enabled, loading]);

  useEffect(() => () => tg?.MainButton.hide(), []);
  return Boolean(tg);
}
