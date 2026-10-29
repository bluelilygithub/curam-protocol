import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClipMeta } from '../bridge/types';
import type { Described } from '../lib/describe';
import { scrollToReveal, windowFor } from '../lib/virtual';
import ClipCard, { CARD_GAP, CARD_H, CARD_W } from './ClipCard';

interface Props {
  clips: ClipMeta[];
  described: Map<string, Described>;
  selectedId: string | null;
  thumbs: Map<string, string>;
  onSelect: (id: string) => void;
  /** Called with the ids of the picture cards now on screen, so only their pictures are fetched. */
  onVisiblePictures: (ids: string[]) => void;
}

/** The horizontal shelf. Only the cards in (or just beside) view exist in the page, however long the history. */
export default function CardStrip({ clips, described, selectedId, thumbs, onSelect, onVisiblePictures }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [viewport, setViewport] = useState(600);
  const frame = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setViewport(el.clientWidth);
    const ro = new ResizeObserver(() => setViewport(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const win = windowFor({ scroll, viewport, itemSize: CARD_W, gap: CARD_GAP, count: clips.length, overscan: 2 });
  const visible = clips.slice(win.start, win.end);

  // keep the chosen card on screen when it is chosen with the keyboard
  useEffect(() => {
    const el = ref.current;
    if (!el || !selectedId) return;
    const index = clips.findIndex((c) => c.id === selectedId);
    if (index < 0) return;
    const target = scrollToReveal(index, el.scrollLeft, el.clientWidth, CARD_W, CARD_GAP);
    if (target !== el.scrollLeft) el.scrollTo({ left: target, behavior: 'smooth' });
  }, [selectedId, clips]);

  // a mouse wheel scrolls sideways, as people expect on a shelf
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault(); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const pictureIds = visible.filter((c) => c.kind === 'image' && !c.masked).map((c) => c.id);
  const pictureKey = pictureIds.join('|');
  useEffect(() => { onVisiblePictures(pictureIds); }, [pictureKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Recent copies"
      aria-orientation="horizontal"
      className="relative h-full overflow-x-auto overflow-y-hidden pb-3"
      onScroll={(e) => {
        const left = e.currentTarget.scrollLeft;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => setScroll(left));
      }}
    >
      <div className="relative" style={{ width: win.total, height: CARD_H + 8 }}>
        {visible.map((c, k) => {
          const index = win.start + k;
          const d = described.get(c.id);
          if (!d) return null;
          return (
            <div key={c.id} className="absolute top-1" style={{ left: index * win.step }}>
              <ClipCard meta={c} desc={d} index={index} selected={c.id === selectedId} thumb={thumbs.get(c.id)} onSelect={onSelect} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
