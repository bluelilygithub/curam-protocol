import { useCallback, useEffect, useRef, useState } from 'react';
import { clampOffset, isDrag, parseOffset, sameOffset } from '../utils/dragPosition.mjs';

/**
 * Lets a floating element (a fixed button, a chat panel, a tool palette) be dragged out of the way.
 * The element keeps its normal CSS position; this only adds `transform: translate(x, y)`, so any page can
 * adopt it without changing its layout.
 *
 *   const drag = useDraggable({ storageKey: 'vault:finance-guide:pos' });
 *   <div ref={drag.ref} style={{ ...yourStyle, ...drag.style }}>
 *     <header {...drag.handleProps}>drag me</header>
 *   </div>
 *
 * - Works with mouse, touch and pen (pointer events); a press that moves less than a few pixels is still a click.
 * - After a real drag the click that follows is swallowed: wrap the element's onClick with `drag.guardClick(fn)`.
 * - Always stays fully on the screen, including after the window or the element is resized.
 * - Double-click the handle to put it back (`resetOnDoubleClick`).
 * - The position is remembered in this browser only (a per-viewer convenience); if storage is blocked it just
 *   forgets. `storageKey` is optional: without it the position lasts until the page is left.
 *
 * options: { storageKey, ignore, resetOnDoubleClick }
 *   ignore: a selector for children that must NOT start a drag (default: inputs, links, [data-nodrag]).
 *   Pass 'button, input, textarea, select, a, [data-nodrag]' when the handle is a header that holds buttons.
 */

const DEFAULT_IGNORE = 'input, textarea, select, a, [data-nodrag]';

function readStored(key) {
  if (!key) return { x: 0, y: 0 };
  try { return parseOffset(localStorage.getItem(key)); } catch { return { x: 0, y: 0 }; }
}
function writeStored(key, offset) {
  if (!key) return;
  try {
    if (offset.x === 0 && offset.y === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(offset));
  } catch { /* storage unavailable: the position just is not remembered */ }
}

export default function useDraggable({ storageKey, ignore = DEFAULT_IGNORE, resetOnDoubleClick = false } = {}) {
  const [offset, setOffset] = useState(() => readStored(storageKey));
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const nodeRef = useRef(null);
  const observerRef = useRef(null);
  const gesture = useRef(null);   // { startX, startY, startOffset, base, moved, id }
  const swallowClick = useRef(false);

  // Where the element would sit with no offset, measured from its current rect.
  const baseOf = (node, current) => {
    const r = node.getBoundingClientRect();
    return { left: r.left - current.x, top: r.top - current.y, width: r.width, height: r.height };
  };
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  // Pull the element back on screen after the window or the element itself changes size.
  const reclamp = useCallback(() => {
    const node = nodeRef.current;
    if (!node || gesture.current) return;
    const cur = offsetRef.current;
    const next = clampOffset(cur, baseOf(node, cur), viewport());
    if (!sameOffset(next, cur)) setOffset(next);
  }, []);

  const ref = useCallback((node) => {
    if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null; }
    nodeRef.current = node;
    if (node) {
      if (typeof ResizeObserver !== 'undefined') {
        observerRef.current = new ResizeObserver(() => reclamp());
        observerRef.current.observe(node);
      }
      reclamp();
    }
  }, [reclamp]);

  useEffect(() => {
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, [reclamp]);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest && e.target.closest(ignore)) return;
    const node = nodeRef.current;
    if (!node) return;
    gesture.current = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY,
      startOffset: offsetRef.current, base: baseOf(node, offsetRef.current), moved: false,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable: moves still arrive */ }
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved) {
      if (!isDrag(dx, dy)) return;
      g.moved = true;
      setDragging(true);
    }
    setOffset(clampOffset({ x: g.startOffset.x + dx, y: g.startOffset.y + dy }, g.base, viewport()));
  };

  const finish = (e) => {
    const g = gesture.current;
    if (!g || (e && e.pointerId !== g.id)) return;
    gesture.current = null;
    try { e?.currentTarget?.releasePointerCapture?.(g.id); } catch { /* already released */ }
    if (g.moved) {
      swallowClick.current = true;                     // the click that follows a drag is not a click
      setTimeout(() => { swallowClick.current = false; }, 0);
      setDragging(false);
      writeStored(storageKey, offsetRef.current);
    }
  };

  const reset = useCallback(() => {
    setOffset({ x: 0, y: 0 });
    writeStored(storageKey, { x: 0, y: 0 });
  }, [storageKey]);

  const onDoubleClick = (e) => {
    if (!resetOnDoubleClick) return;
    if (e.target.closest && e.target.closest(ignore)) return;
    reset();
  };

  const guardClick = (fn) => (...args) => {
    if (swallowClick.current) return undefined;
    return fn?.(...args);
  };

  return {
    ref,
    offset,
    dragging,
    reset,
    guardClick,
    // merge into the element's style
    style: { transform: offset.x || offset.y ? `translate(${offset.x}px, ${offset.y}px)` : undefined },
    // spread on whatever should be grabbed (the element itself, or its header)
    handleProps: {
      onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onDoubleClick,
      style: { touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' },
    },
  };
}
