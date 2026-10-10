import Konva from 'konva';
import { useEffect, useRef, useState } from 'react';
import { boundsOf, fitView, type Prim, type Tone } from '../views';

// Draws drawing primitives (millimetres, y down) with Konva. Fits the drawing until the person pans or zooms; "Fit" brings that back.

const FILL: Record<Tone, string> = { panel: '#8d99a6', glass: '#bfe0f2', stud: '#cdb99a', inside: '#f6f3ec', door: '#ecd6a2', rack: 'rgba(204,120,92,0.45)', rackIssue: 'rgba(239,68,68,0.45)', zone: 'rgba(245,158,11,0.18)', header: '#e4e4e0', equipment: '#a9b4bf', ink: '#1a1a1a', muted: '#888888', bottle: '#4b6b45' };
const STROKE: Record<Tone, string> = { panel: '#5c6670', glass: '#6aa6c8', stud: '#8c7752', inside: '#c9c4b8', door: '#b5832d', rack: '#cc785c', rackIssue: '#ef4444', zone: '#f59e0b', header: '#9a9a96', equipment: '#5c6670', ink: '#1a1a1a', muted: '#888888', bottle: '#2e4a2a' };

/** The public tool's warmer look: a timber floor and racks, dark slate walls, bottles with a little shine. The staff app keeps the plain drafting look. */
export type DrawingLook = 'plain' | 'warm' | 'warmWall';
const WARM_FILL: Partial<Record<Tone, string>> = { panel: '#4b5159', glass: '#d6ebf5', stud: '#c8b698', inside: '#efe3cd', door: '#e6b95c', rack: '#b98550', rackIssue: 'rgba(239,68,68,0.55)', zone: 'rgba(245,158,11,0.18)', header: '#e4e4e0', equipment: '#a9b4bf' };
const WARM_STROKE: Partial<Record<Tone, string>> = { panel: '#2f343a', glass: '#7ab3d1', stud: '#8c7752', inside: '#d7c7a6', door: '#b5832d', rack: '#6f4a28', rackIssue: '#ef4444', zone: '#f59e0b', header: '#9a9a96', equipment: '#5c6670' };

function draw(layer: Konva.Layer, prims: Prim[], v: { scale: number; ox: number; oy: number }, look: DrawingLook = 'plain'): void {
  layer.destroyChildren();
  const X = (x: number): number => v.ox + x * v.scale, Y = (y: number): number => v.oy + y * v.scale;
  for (const p of prims) {
    if (p.kind === 'rect') {
      const w = p.w * v.scale, h = p.h * v.scale;
      const warm = look !== 'plain';
      const fill = (warm && WARM_FILL[p.tone]) || FILL[p.tone], stroke = (warm && WARM_STROKE[p.tone]) || STROKE[p.tone];
      const rack = warm && (p.tone === 'rack');
      layer.add(new Konva.Rect({
        x: X(p.x), y: Y(p.y), width: w, height: h, fill, stroke, strokeWidth: rack ? 1.5 : 1, dash: p.dash ? [6, 4] : undefined, cornerRadius: warm && p.tone !== 'inside' ? 2 : 0,
        ...(rack ? { fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: 0, y: h }, fillLinearGradientColorStops: [0, '#c99560', 1, '#a2723f'], shadowColor: '#000', shadowBlur: 6, shadowOpacity: 0.28, shadowOffset: { x: 2, y: 3 } } : {}),
      }));
      if (look === 'warm' && p.tone === 'inside') {
        // floor boards: faint lines along the longer side of the room
        const along = p.w >= p.h, step = 140 * v.scale;
        if (step >= 4) {
          for (let k = 1; k * step < (along ? h : w); k++) {
            layer.add(new Konva.Line({ points: along ? [X(p.x), Y(p.y) + k * step, X(p.x) + w, Y(p.y) + k * step] : [X(p.x) + k * step, Y(p.y), X(p.x) + k * step, Y(p.y) + h], stroke: 'rgba(120,90,50,0.10)', strokeWidth: 1, listening: false }));
          }
        }
      }
      // the full label if it fits, else the first shorter one that does, else none
      const text = [p.label, ...(p.shortLabels ?? [])].find((t) => t && Math.min(w, h) >= 14 && w > t.length * 5.5);
      if (text) layer.add(new Konva.Text({ x: X(p.x) + 4, y: Y(p.y) + 3, text, fontSize: 10, fontFamily: 'system-ui, sans-serif', fill: '#1a1a1a' }));
    } else if (p.kind === 'circle') {
      const r = Math.max(0.6, p.r * v.scale);
      if (look !== 'plain' && p.tone === 'bottle') {
        // a glass bottle seen end-on: dark glass, a lighter neck, a small highlight
        const cx = X(p.cx), cy = Y(p.cy);
        layer.add(new Konva.Circle({ x: cx, y: cy, radius: r, fillRadialGradientStartPoint: { x: -r * 0.3, y: -r * 0.3 }, fillRadialGradientStartRadius: 0, fillRadialGradientEndPoint: { x: 0, y: 0 }, fillRadialGradientEndRadius: r, fillRadialGradientColorStops: [0, '#4f8a5c', 0.7, '#2b5236', 1, '#16301e'], listening: false }));
        if (r >= 3) {
          layer.add(new Konva.Circle({ x: cx, y: cy, radius: r * 0.42, fill: 'rgba(224,190,110,0.85)', listening: false }));
          layer.add(new Konva.Circle({ x: cx - r * 0.38, y: cy - r * 0.38, radius: r * 0.16, fill: 'rgba(255,255,255,0.7)', listening: false }));
        }
      } else {
        layer.add(new Konva.Circle({ x: X(p.cx), y: Y(p.cy), radius: r, fill: FILL[p.tone], stroke: STROKE[p.tone], strokeWidth: 0.6, listening: false }));
      }
    } else if (p.kind === 'poly') {
      const pts = p.pts.map((n, i) => (i % 2 === 0 ? X(n) : Y(n)));
      layer.add(new Konva.Line({ points: pts, closed: p.closed, stroke: STROKE[p.tone], strokeWidth: 1.5, dash: p.dash ? [6, 4] : undefined, fill: p.closed ? FILL[p.tone] : undefined }));
    } else if (p.kind === 'text') {
      const t = new Konva.Text({ x: X(p.x), y: Y(p.y), text: p.text, fontSize: p.size ?? 11, fontFamily: 'system-ui, sans-serif', fill: STROKE[p.tone] });
      if (p.anchor === 'middle') t.offsetX(t.width() / 2); else if (p.anchor === 'end') t.offsetX(t.width());
      layer.add(t);
    } else {
      const dx = p.x2 - p.x1, dy = p.y2 - p.y1, len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * p.offset, ny = (dx / len) * p.offset;
      const a = [X(p.x1), Y(p.y1)], b = [X(p.x2), Y(p.y2)], c = [X(p.x1 + nx), Y(p.y1 + ny)], d = [X(p.x2 + nx), Y(p.y2 + ny)];
      const line = { stroke: '#444', strokeWidth: 1 };
      layer.add(new Konva.Line({ ...line, points: [a[0], a[1], c[0], c[1]], opacity: 0.5 }));
      layer.add(new Konva.Line({ ...line, points: [b[0], b[1], d[0], d[1]], opacity: 0.5 }));
      layer.add(new Konva.Line({ ...line, points: [c[0], c[1], d[0], d[1]] }));
      const ux = (d[0] - c[0]), uy = (d[1] - c[1]), ul = Math.hypot(ux, uy) || 1, tx = (ux / ul) * 5, ty = (uy / ul) * 5;
      for (const e of [c, d]) layer.add(new Konva.Line({ ...line, points: [e[0] - tx - ty, e[1] - ty + tx, e[0] + tx + ty, e[1] + ty - tx], strokeWidth: 1.5 }));
      const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
      const flip = angle > 90 || angle < -90 ? 180 : 0;
      const label = new Konva.Text({ text: p.text, fontSize: 11, fontFamily: 'system-ui, sans-serif', fill: '#1a1a1a', rotation: angle + flip });
      const mx = (c[0] + d[0]) / 2, my = (c[1] + d[1]) / 2;
      label.offsetX(label.width() / 2);
      label.offsetY(label.height() + 2);
      label.x(mx); label.y(my);
      layer.add(label);
    }
  }
  layer.batchDraw();
}

// ctrlZoom: the mouse wheel scrolls the page and only Ctrl/Cmd + wheel zooms (for the drawing embedded in a web page, so it never traps page scrolling)
export function DrawingView({ prims, testid, description, ctrlZoom = false, look = 'plain' }: { prims: Prim[]; testid: string; description: string; ctrlZoom?: boolean; look?: DrawingLook }) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage | null>(null);
  const layer = useRef<Konva.Layer | null>(null);
  const view = useRef({ scale: 0.1, ox: 0, oy: 0 });
  const touched = useRef(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const primsRef = useRef(prims);
  primsRef.current = prims;
  const ctrlZoomRef = useRef(ctrlZoom);
  ctrlZoomRef.current = ctrlZoom;
  const hintTimer = useRef<number | undefined>(undefined);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [hint, setHint] = useState(false);

  const redraw = (): void => {
    const el = host.current;
    if (!el || !layer.current) return;
    if (!touched.current) view.current = fitView(boundsOf(primsRef.current), size.w, size.h, 56);
    draw(layer.current, primsRef.current, view.current, look);
    el.dataset.prims = String(primsRef.current.length);
    el.dataset.scale = view.current.scale.toFixed(4);
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const s = new Konva.Stage({ container: el, width: el.clientWidth || 600, height: el.clientHeight || 400 });
    const l = new Konva.Layer();
    s.add(l);
    stage.current = s; layer.current = l;
    const ro = new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; if (w && h) { s.size({ width: w, height: h }); setSize({ w, h }); } });
    ro.observe(el);
    s.on('wheel', (ev) => {
      if (ctrlZoomRef.current && !ev.evt.ctrlKey && !ev.evt.metaKey) {
        // let the page scroll; remind how to zoom
        setHint(true);
        window.clearTimeout(hintTimer.current);
        hintTimer.current = window.setTimeout(() => setHint(false), 1500);
        return;
      }
      ev.evt.preventDefault();
      const pos = s.getPointerPosition();
      if (!pos) return;
      const f = ev.evt.deltaY < 0 ? 1.12 : 1 / 1.12, v = view.current;
      const scale = Math.min(5, Math.max(0.01, v.scale * f));
      view.current = { scale, ox: pos.x - ((pos.x - v.ox) / v.scale) * scale, oy: pos.y - ((pos.y - v.oy) / v.scale) * scale };
      touched.current = true;
      redraw();
    });
    // one pointer pans; two touches pinch-zoom about their midpoint (and pan with it)
    const pinch = { d: 0, cx: 0, cy: 0 };
    const two = (ev: Konva.KonvaEventObject<TouchEvent>): { d: number; cx: number; cy: number } | null => {
      const t = ev.evt.touches;
      if (t.length < 2) return null;
      const r = s.container().getBoundingClientRect();
      return { d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY), cx: (t[0].clientX + t[1].clientX) / 2 - r.left, cy: (t[0].clientY + t[1].clientY) / 2 - r.top };
    };
    s.on('mousedown touchstart', (ev) => {
      const p = two(ev as Konva.KonvaEventObject<TouchEvent>);
      if (p) { Object.assign(pinch, p); drag.current = null; } else drag.current = s.getPointerPosition();
    });
    s.on('mousemove touchmove', (ev) => {
      const p = ev.evt instanceof TouchEvent ? two(ev as Konva.KonvaEventObject<TouchEvent>) : null;
      if (p) {
        ev.evt.preventDefault();
        if (pinch.d > 0) {
          const v = view.current, scale = Math.min(5, Math.max(0.01, v.scale * (p.d / pinch.d)));
          view.current = { scale, ox: p.cx - ((pinch.cx - v.ox) / v.scale) * scale, oy: p.cy - ((pinch.cy - v.oy) / v.scale) * scale };
          touched.current = true; redraw();
        }
        Object.assign(pinch, p);
        return;
      }
      const pos = s.getPointerPosition();
      if (!drag.current || !pos) return;
      view.current = { ...view.current, ox: view.current.ox + pos.x - drag.current.x, oy: view.current.oy + pos.y - drag.current.y };
      drag.current = pos; touched.current = true; redraw();
    });
    s.on('mouseup mouseleave touchend touchcancel', (ev) => {
      drag.current = null; pinch.d = 0;
      // one finger left after a pinch: carry on panning from where it is, without a jump
      if (ev.evt instanceof TouchEvent && ev.evt.touches.length === 1) { const r = s.container().getBoundingClientRect(), t = ev.evt.touches[0]; drag.current = { x: t.clientX - r.left, y: t.clientY - r.top }; }
    });
    return () => { window.clearTimeout(hintTimer.current); ro.disconnect(); s.destroy(); stage.current = null; layer.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { redraw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [prims, size, look]);

  return (
    <div className="drawing" data-testid={testid} data-tour="cp-drawing">
      <div ref={host} className="drawing-canvas" data-testid={`${testid}-canvas`} role="img" aria-label={description} />
      {hint && <div className="drawing-hint" role="status">Hold Ctrl (Cmd on Mac) and scroll to zoom</div>}
      <button type="button" className="btn fit" title="Bring the whole drawing back into view." onClick={() => { touched.current = false; redraw(); }} data-testid={`${testid}-fit`}>Fit</button>
    </div>
  );
}
