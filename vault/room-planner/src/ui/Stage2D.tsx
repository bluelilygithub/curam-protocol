import { useEffect, useRef } from 'react';
import { canvasToWorld, panBy, zoomAt } from '../adapters/canvas';
import { computeHandles, hitHandle } from '../interaction/handles';
import type { PointerEv } from '../interaction/interaction';
import { SceneRenderer } from '../render2d/SceneRenderer';
import { hoverText } from './hoverLabel';
import { useApp } from './AppContext';

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/**
 * Hosts the Konva stage and turns DOM pointer/keyboard/wheel events into world-space events for the interaction engine.
 * It owns no design state and renders nothing through React after mount (A12).
 */
export function Stage2D() {
  const app = useApp();
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current!;
    const tipEl = tip.current!;
    const { project, ui, view, bus, interaction } = app;
    // the hover label is drawn straight into the DOM (never through a store: pointer moves must not cause updates, A12)
    const hideTip = (): void => { tipEl.style.display = 'none'; };
    const showTip = (text: string, x: number, y: number): void => {
      tipEl.textContent = text;
      tipEl.style.display = 'block';
      const w = tipEl.offsetWidth;
      const left = Math.max(4, Math.min(x + 14, el.clientWidth - w - 4));
      tipEl.style.left = `${left}px`;
      tipEl.style.top = `${Math.max(4, y - 34)}px`;
    };

    const size = (): void => {
      const r = el.getBoundingClientRect();
      view.getState().setViewport(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    const renderer = new SceneRenderer({ container: el, project, ui, view, bus, onAnimationDone: () => interaction.animationDone() });
    (window as unknown as { roomPlannerRenderer?: SceneRenderer }).roomPlannerRenderer = renderer; // for the browser walkthrough
    if (project.getState().project?.rooms.length) app.fitToRoom();

    const toEv = (e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; button?: number }): PointerEv => {
      const r = el.getBoundingClientRect();
      const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
      const v = view.getState().view;
      return { world: canvasToWorld(screen, v), screen, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, mpp: 1 / v.scale, button: e.button };
    };

    // --- pointers (mouse, pen, touch); two fingers pinch/pan the view and cancel any gesture
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; cx: number; cy: number } | null = null;
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    const pinchState = (): { dist: number; cx: number; cy: number } => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    };

    const onDown = (e: PointerEvent): void => {
      hideTip();
      if (e.button === 2) return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        interaction.cancel();
        pinch = pinchState();
        return;
      }
      if (pointers.size === 1) {
        interaction.pointerDown(toEv(e));
        // touch: holding a press on a wall in the wall tool inserts a corner (B1 long-press)
        if (e.pointerType === 'touch' && ui.getState().tool === 'wall_edit') {
          clearTimeout(pressTimer);
          pressTimer = setTimeout(() => interaction.longPress(), 550);
        }
      }
    };
    const onMove = (e: PointerEvent): void => {
      if (pointers.has(e.pointerId)) {
        const prev = pointers.get(e.pointerId)!;
        if (Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 6) clearTimeout(pressTimer);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (pinch && pointers.size === 2) {
        const next = pinchState();
        const r = el.getBoundingClientRect();
        let v = view.getState().view;
        v = panBy(v, next.cx - pinch.cx, next.cy - pinch.cy);
        v = zoomAt(v, { x: next.cx - r.left, y: next.cy - r.top }, next.dist / pinch.dist);
        view.getState().setView(v);
        pinch = next;
        return;
      }
      const ev = toEv(e);
      interaction.pointerMove(ev);
      if (e.pointerType !== 'touch' && interaction.stateName === 'idle' && !ui.getState().placing && ui.getState().tool !== 'pan') {
        const text = hoverText(project.getState().project, ev.world, Math.max(0.02, 3 * ev.mpp));
        if (text) showTip(text, ev.screen.x, ev.screen.y); else hideTip();
      } else hideTip();
      if (interaction.stateName === 'idle' && !ui.getState().placing && ui.getState().tool === 'select') {
        const p = project.getState().project;
        const hit = p ? hitHandle(computeHandles(p, ui.getState().selection, ev.mpp), ev.world, ev.mpp) : null;
        el.style.cursor = hit?.kind === 'rotate' ? 'grab' : hit?.kind === 'resize' ? 'nwse-resize' : 'default';
      }
    };
    const onLeave = (): void => hideTip();
    const onUp = (e: PointerEvent): void => {
      clearTimeout(pressTimer);
      const had = pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; return; }
      if (had) interaction.pointerUp(toEv(e));
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      view.getState().setView(zoomAt(view.getState().view, { x: e.clientX - r.left, y: e.clientY - r.top }, factor));
    };
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return;
      if (e.key === 'Home' && !e.ctrlKey && !e.metaKey && !e.altKey) { hideTip(); app.fitToRoom(); e.preventDefault(); return; } // bring the room back into view
      if (interaction.keyDown({ key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey })) e.preventDefault();
    };
    const noMenu = (e: Event): void => e.preventDefault();

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', noMenu);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('keydown', onKey);
      ro.disconnect();
      renderer.dispose();
    };
  }, [app]);

  return (
    <>
      <div ref={host} className="stage" data-testid="stage" />
      <div ref={tip} className="hover-tip" role="tooltip" data-testid="hover-label" style={{ display: 'none' }} />
    </>
  );
}
