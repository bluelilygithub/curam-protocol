import { useEffect, useState } from 'react';

/** True while the window is narrower than `px`. Used to switch the week from a 7-column grid to a list. */
export default function useNarrow(px = 900) {
  const query = `(max-width: ${px - 1}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return narrow;
}
