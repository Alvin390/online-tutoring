import { useEffect, useState } from 'react';

/** 011Fixes / 02: laptop and tablet (768 px and wider) — where columns can be resized. */
export const WIDE_QUERY = '(min-width: 768px)';

const matches = () => {
  try { return typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches === true; } catch { return false; }
};

export function useIsWide() {
  const [wide, setWide] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(list.matches === true);
    list.addEventListener?.('change', onChange);
    return () => list.removeEventListener?.('change', onChange);
  }, []);
  return wide;
}
