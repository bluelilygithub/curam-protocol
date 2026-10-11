import type maplibregl from 'maplibre-gl';
import { useEffect } from 'react';
import {
  addVertex, cancelStroke, displayLines, endStroke, extendStroke, HIT_PX, HIT_TOUCH_PX, hitTest, insertVertex, JOIN_PX, MIN_POINT_PX,
  pushHistory, screenDist, setVertex, startStroke, TAP_PX, type VertexRef,
} from './drawing';
import { degreesPerPixel, type Pos } from './geo';
import { scheduleDrawRender } from './mapLayers';
import { useStore } from './store';

/**
 * Pointer handling for drawing. It only translates pointer events into the pure functions in drawing.ts.
 *  Freehand: map pan is off while one pointer draws; a second pointer cancels the stroke and hands over to the map (pinch / two-finger pan).
 *            Space + drag pans with a mouse. touch-action: none keeps the browser from scrolling the page.
 *  Click:    the map keeps panning; a tap or click (MapLibre filters out drags) adds a vertex; double-click ends.
 */
export function useDrawing(map: maplibregl.Map | null, onFinish: () => void): void {
  const drawing = useStore((s) => s.drawing);
  const mode = useStore((s) => s.mode);

  useEffect(() => {
    if (!map || !drawing) return undefined;
    const el = map.getCanvasContainer();
    const { apply, setRubber } = useStore.getState();
    const rerender = () => scheduleDrawRender(map);
    const unsub = useStore.subscribe(rerender);
    rerender(); // show what is already there (a track opened for Extend, a recovered drawing)
    map.dragRotate.disable();
    map.touchPitch.disable();
    map.keyboard.disableRotation();
    const cleanups: Array<() => void> = [unsub];
    const rect = () => el.getBoundingClientRect();
    const xy = (e: PointerEvent) => { const r = rect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const toPos = (p: { x: number; y: number }): Pos => { const ll = map.unproject([p.x, p.y]); return [ll.lng, ll.lat]; };

    if (mode === 'freehand') {
      const pointers = new Set<number>();
      let stroke: number | null = null;
      let lastKept = { x: 0, y: 0 };
      let space = false;
      map.dragPan.disable();
      map.doubleClickZoom.enable();
      const prevTouch = el.style.touchAction;
      el.style.touchAction = 'none';
      el.style.cursor = 'crosshair';

      const onDown = (e: PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (space) return; // Space held: the map pans
        (document.activeElement as HTMLElement | null)?.blur?.();
        pointers.add(e.pointerId);
        if (pointers.size > 1) {
          // a second finger: this is a pinch or a pan, not a line
          if (stroke !== null) apply(cancelStroke);
          stroke = null;
          map.dragPan.enable();
          return;
        }
        const p = xy(e);
        const lines = useStore.getState().draw.lines;
        const end = lines[lines.length - 1]?.at(-1);
        const near = !!end && screenDist(p, map.project(end)) <= JOIN_PX;
        stroke = e.pointerId;
        lastKept = p;
        try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        apply((s) => startStroke(s, toPos(p), near));
      };
      const onMove = (e: PointerEvent) => {
        if (stroke !== e.pointerId) return;
        const evs = e.getCoalescedEvents?.() ?? [];
        for (const ev of evs.length ? evs : [e]) {
          const p = xy(ev);
          if (screenDist(p, lastKept) < MIN_POINT_PX) continue;
          lastKept = p;
          apply((s) => extendStroke(s, toPos(p)));
        }
      };
      const onUp = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        if (stroke === e.pointerId) {
          stroke = null;
          const tol = degreesPerPixel(map.getZoom());
          apply((s) => (e.type === 'pointercancel' ? cancelStroke(s) : endStroke(s, tol)));
        }
        if (pointers.size === 0 && !space) map.dragPan.disable();
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code !== 'Space' || e.repeat || /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? '')) return; // a focused button must not swallow the pan key
        e.preventDefault();
        space = true;
        if (stroke !== null) { apply(cancelStroke); stroke = null; }
        map.dragPan.enable();
        el.style.cursor = 'grab';
      };
      const onKeyUp = (e: KeyboardEvent) => {
        if (e.code !== 'Space') return;
        if (space) e.preventDefault(); // Space on a focused toolbar button would otherwise click it on release
        space = false;
        if (pointers.size === 0) map.dragPan.disable();
        el.style.cursor = 'crosshair';
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      cleanups.push(() => {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        el.style.touchAction = prevTouch;
        apply(cancelStroke);
      });
    } else if (mode === 'edit') {
      // Existing points: drag one to move it, drag a small dot (the middle of a segment) to add a point there, tap a point to pick it for
      // Delete point. A press on nothing pans the map as usual; dragPan is off only while a point is being dragged.
      const { setSelectedVertex, deleteSelectedVertex } = useStore.getState();
      const pointers = new Set<number>();
      let drag: (VertexRef & { id: number; moved: boolean; down: { x: number; y: number } }) | null = null;
      map.dragPan.enable();
      el.style.cursor = 'default';

      const onDown = (e: PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        pointers.add(e.pointerId);
        if (pointers.size > 1) { drag = null; map.dragPan.enable(); return; } // a second finger: pinch / pan
        const p = xy(e);
        const lines = displayLines(useStore.getState().draw);
        const hit = hitTest(lines, (q) => map.project(q), p, e.pointerType === 'touch' ? HIT_TOUCH_PX : HIT_PX);
        if (!hit) { setSelectedVertex(null); return; }
        map.dragPan.disable();
        try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        if (hit.kind === 'mid') {
          apply((s) => insertVertex(s, hit, hit.pos)); // one undo step; a drag that follows only moves the new point
          drag = { li: hit.li, vi: hit.vi, id: e.pointerId, moved: true, down: p };
        } else drag = { li: hit.li, vi: hit.vi, id: e.pointerId, moved: false, down: p };
        setSelectedVertex({ li: drag.li, vi: drag.vi });
      };
      const onMove = (e: PointerEvent) => {
        if (!drag || drag.id !== e.pointerId) return;
        const p = xy(e);
        if (!drag.moved) {
          if (screenDist(p, drag.down) < TAP_PX) return; // still a tap
          apply(pushHistory);
          drag.moved = true;
        }
        const ref = { li: drag.li, vi: drag.vi };
        apply((s) => setVertex(s, ref, toPos(p)));
      };
      const onUp = (e: PointerEvent) => {
        pointers.delete(e.pointerId);
        if (drag?.id === e.pointerId) drag = null;
        if (pointers.size === 0) map.dragPan.enable();
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if ((e.key !== 'Delete' && e.key !== 'Backspace') || /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? '')) return;
        e.preventDefault();
        deleteSelectedVertex();
      };
      const onMoveEnd = () => rerender(); // which handles are on screen depends on the view
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      window.addEventListener('keydown', onKeyDown);
      map.on('moveend', onMoveEnd);
      cleanups.push(() => {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        window.removeEventListener('keydown', onKeyDown);
        map.off('moveend', onMoveEnd);
        setSelectedVertex(null);
      });
    } else {
      map.dragPan.enable();
      map.doubleClickZoom.disable();
      el.style.cursor = 'crosshair';
      let lastAt = 0;
      let lastPt = { x: -99, y: -99 };
      let grabbed: (VertexRef & { id: number; moved: boolean; down: { x: number; y: number } }) | null = null;
      let justGrabbed = false;
      const onClick = (e: maplibregl.MapMouseEvent) => {
        if (justGrabbed) return; // the release of a point that was being dragged (or tapped) is not a new point
        // a double-click delivers two clicks at one spot: keep one vertex
        const now = performance.now();
        if (now - lastAt < 350 && screenDist(e.point, lastPt) < 6) return;
        lastAt = now;
        lastPt = e.point;
        apply((s) => addVertex(s, [e.lngLat.lng, e.lngLat.lat]));
      };
      const onDbl = () => onFinish();
      const onMouseMove = (e: maplibregl.MapMouseEvent) => setRubber([e.lngLat.lng, e.lngLat.lat]); // mouse only: touch has no hover
      const onLeave = () => setRubber(null);
      // Points already placed can be dragged: a press on one moves it (the map stays still); a press anywhere else pans / clicks as before.
      const onGrab = (e: PointerEvent) => {
        if ((e.pointerType === 'mouse' && e.button !== 0) || grabbed) return;
        const p = xy(e);
        const hit = hitTest(displayLines(useStore.getState().draw), (q) => map.project(q), p, e.pointerType === 'touch' ? HIT_TOUCH_PX : HIT_PX, Infinity);
        if (!hit || hit.kind !== 'vertex') return;
        map.dragPan.disable();
        try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
        grabbed = { li: hit.li, vi: hit.vi, id: e.pointerId, moved: false, down: p };
        justGrabbed = true;
      };
      const onGrabMove = (e: PointerEvent) => {
        if (!grabbed || grabbed.id !== e.pointerId) return;
        const p = xy(e);
        if (!grabbed.moved) {
          if (screenDist(p, grabbed.down) < TAP_PX) return; // still a tap
          apply(pushHistory);
          grabbed.moved = true;
        }
        const ref = { li: grabbed.li, vi: grabbed.vi };
        apply((s) => setVertex(s, ref, toPos(p)));
      };
      const onGrabEnd = (e: PointerEvent) => {
        if (!grabbed || grabbed.id !== e.pointerId) return;
        grabbed = null;
        map.dragPan.enable();
        window.setTimeout(() => { justGrabbed = false; }, 60); // after the click that follows this release has been ignored
      };
      el.addEventListener('pointerdown', onGrab, true); // capture phase: before the map's own handlers see the press
      el.addEventListener('pointermove', onGrabMove);
      el.addEventListener('pointerup', onGrabEnd);
      el.addEventListener('pointercancel', onGrabEnd);
      map.on('click', onClick);
      map.on('dblclick', onDbl);
      map.on('mousemove', onMouseMove);
      el.addEventListener('mouseleave', onLeave);
      cleanups.push(() => {
        map.off('click', onClick);
        el.removeEventListener('pointerdown', onGrab, true);
        el.removeEventListener('pointermove', onGrabMove);
        el.removeEventListener('pointerup', onGrabEnd);
        el.removeEventListener('pointercancel', onGrabEnd);
        map.off('dblclick', onDbl);
        map.off('mousemove', onMouseMove);
        el.removeEventListener('mouseleave', onLeave);
        setRubber(null);
      });
    }

    return () => {
      cleanups.forEach((c) => c());
      el.style.cursor = '';
      map.dragPan.enable();
      map.doubleClickZoom.enable();
      map.keyboard.enableRotation();
      scheduleDrawRender(map);
    };
  }, [map, drawing, mode, onFinish]);
}
