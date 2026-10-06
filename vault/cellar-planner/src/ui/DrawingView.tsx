import Konva from 'konva';
import { useEffect, useRef, useState } from 'react';
import { boundsOf, fitView, type Prim, type Tone } from '../views';

// Draws drawing primitives (millimetres, y down) with Konva. Fits the drawing until the person pans or zooms; "Fit" brings that back.

const FILL: Record<Tone, string> = { panel: '#8d99a6', glass: '#bfe0f2', stud: '#cdb99a', inside: '#f6f3ec', door: '#ecd6a2', rack: 'rgba(204,120,92,0.45)', rackIssue: 'rgba(239,68,68,0.45)', zone: 'rgba(245,158,11,0.18)', header: '#e4e4e0', equipment: '#a9b4bf', ink: '#1a1a1a', muted: '#888888' };
const STROKE: Record<Tone, string> = { panel: '#5c6670', glass: '#6aa6c8', stud: '#8c7752', inside: '#c9c4b8', door: '#b5832d', rack: '#cc785c', rackIssue: '#ef4444', zone: '#f59e0b', header: '#9a9a96', equipment: '#5c6670', ink: '#1a1a1a', muted: '#888888' };

function draw(layer: Konva.Layer, prims: Prim[], v: { scale: number; ox: number; oy: number }): void {
  layer.destroyChildren();
  const X = (x: number): number => v.ox + x * v.scale, Y = (y: number): number => v.oy + y * v.scale;
  for (const p of prims) {
    if (p.kind === 'rect') {
      const w = p.w * v.scale, h = p.h * v.scale;
      layer.add(new Konva.Rect({ x: X(p.x), y: Y(p.y), width: w, height: h, fill: FILL[p.tone], stroke: STROKE[p.tone], strokeWidth: 1, dash: p.dash ? [6, 4] : undefined }));
      if (p.label && Math.min(w, h) >= 14 && w > p.label.length * 5.5) layer.add(new Konva.Text({ x: X(p.x) + 4, y: Y(p.y) + 3, text: p.label, fontSize: 10, fontFamily: 'system-ui, sans-serif', fill: '#1a1a1a' }));
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

export function DrawingView({ prims, testid }: { prims: Prim[]; testid: string }) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage | null>(null);
  const layer = useRef<Konva.Layer | null>(null);
  const view = useRef({ scale: 0.1, ox: 0, oy: 0 });
  const touched = useRef(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const primsRef = useRef(prims);
  primsRef.current = prims;
  const [size, setSize] = useState({ w: 600, h: 400 });

  const redraw = (): void => {
    const el = host.current;
    if (!el || !layer.current) return;
    if (!touched.current) view.current = fitView(boundsOf(primsRef.current), size.w, size.h, 56);
    draw(layer.current, primsRef.current, view.current);
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
      ev.evt.preventDefault();
      const pos = s.getPointerPosition();
      if (!pos) return;
      const f = ev.evt.deltaY < 0 ? 1.12 : 1 / 1.12, v = view.current;
      const scale = Math.min(5, Math.max(0.01, v.scale * f));
      view.current = { scale, ox: pos.x - ((pos.x - v.ox) / v.scale) * scale, oy: pos.y - ((pos.y - v.oy) / v.scale) * scale };
      touched.current = true;
      redraw();
    });
    s.on('mousedown touchstart', () => { drag.current = s.getPointerPosition(); });
    s.on('mousemove touchmove', () => {
      const pos = s.getPointerPosition();
      if (!drag.current || !pos) return;
      view.current = { ...view.current, ox: view.current.ox + pos.x - drag.current.x, oy: view.current.oy + pos.y - drag.current.y };
      drag.current = pos; touched.current = true; redraw();
    });
    s.on('mouseup mouseleave touchend', () => { drag.current = null; });
    return () => { ro.disconnect(); s.destroy(); stage.current = null; layer.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { redraw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [prims, size]);

  return (
    <div className="drawing" data-testid={testid} data-tour="cp-drawing">
      <div ref={host} className="drawing-canvas" data-testid={`${testid}-canvas`} />
      <button type="button" className="btn fit" title="Bring the whole drawing back into view." onClick={() => { touched.current = false; redraw(); }} data-testid={`${testid}-fit`}>Fit</button>
    </div>
  );
}
