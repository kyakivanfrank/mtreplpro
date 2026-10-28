import { useEffect, useState } from 'react';

/**
 * The unread count on the Chat row.
 *
 * Dealt once per session and kept in `sessionStorage`, so the number does not reshuffle on every
 * render or every return to the tab — a badge that changes while you look at it reads as live,
 * and this one is a mock.
 */
export function useChatBadge(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem('chatBadgeCount');
    if (stored !== null) {
      setCount(parseInt(stored, 10));
    } else {
      const dealt = Math.floor(Math.random() * 16); // 0 to 15
      sessionStorage.setItem('chatBadgeCount', dealt.toString());
      setCount(dealt);
    }
  }, []);

  return count;
}
