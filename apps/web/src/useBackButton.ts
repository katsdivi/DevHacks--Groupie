import { useEffect } from 'react';
import { tg } from './telegram.ts';

/** Shows Telegram's native BackButton while `onBack` is set. */
export function useBackButton(onBack: (() => void) | null) {
  useEffect(() => {
    if (!tg || !onBack) return;
    tg.BackButton.show();
    tg.BackButton.onClick(onBack);
    return () => {
      tg?.BackButton.offClick(onBack);
      tg?.BackButton.hide();
    };
  }, [onBack]);
}
