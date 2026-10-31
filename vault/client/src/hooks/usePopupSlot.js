import { useEffect } from 'react';
import usePopupStore from '../store/popupStore';
import { pickPopup } from '../utils/popupQueue.mjs';

/**
 * A popup that appears by itself asks for its turn: `const myTurn = usePopupSlot('task-reminder', hasSomethingToShow)`, and renders only when
 * `myTurn` is true. While a more important popup is up, this one waits; when that one goes away it appears. Pass `wants` = "I have something
 * to show right now". Call it before any early return.
 */
export default function usePopupSlot(id, wants) {
  const want = usePopupStore((s) => s.want);
  const unwant = usePopupStore((s) => s.unwant);
  useEffect(() => {
    if (!wants) return undefined;
    want(id);
    return () => unwant(id);
  }, [id, wants, want, unwant]);
  const turn = usePopupStore((s) => pickPopup(s.wanting));
  return !!wants && turn === id;
}
