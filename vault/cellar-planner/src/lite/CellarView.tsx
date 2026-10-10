import Konva from 'konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildScene, type Scene, type SceneInput } from './cellarScene';
import { FINISH_LOOK, type FinishKey } from './finishes';
import { ZoomControls } from './ZoomControls';

// The "Cellar view" picture: the inside of the cellar from the door, drawn from the pure scene in cellarScene.ts. Drag to look left or right.

const BASE: Record<string, [number, number, number]> = {
  floor: [217, 188, 140], wall: [239, 231, 216], glass: [205, 230, 242], rackTop: [205, 152, 98], rackEnd: [128, 84, 45], rackFront: [112, 74, 42], marker: [230, 185, 92],
};
const shade = ([r, g, b]: [number, number, number], k: number): string => `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;

export function paint(layer: Konva.Layer, scene: Scene, w: number, h: number, opts: { pad?: number; labels?: boolean; finish?: FinishKey; zoom?: number } = {}): void {
  const look = FINISH_LOOK[opts.finish ?? 'OAK'];
  const palette: Record<string, [number, number, number]> = { ...BASE, rackTop: look.top, rackEnd: look.end, rackFront: look.front };
  layer.destroyChildren();
  const bg = new Konva.Rect({ x: 0, y: 0, width: w, height: h, fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: 0, y: h }, fillLinearGradientColorStops: [0, '#f6f2ea', 1, '#e3d9c6'], listening: false });
  layer.add(bg);
  const { bounds: b } = scene;
  const pad = opts.pad ?? 28;
  const k = Math.min((w - pad * 2) / Math.max(1, b.x1 - b.x0), (h - pad * 2) / Math.max(1, b.y1 - b.y0)) * (opts.zoom ?? 1);
  const ox = (w - (b.x1 - b.x0) * k) / 2 - b.x0 * k, oy = (h - (b.y1 - b.y0) * k) / 2 - b.y0 * k;
  const X = (x: number): number => ox + x * k, Y = (y: number): number => oy + y * k;
  const flat = (pts: Array<[number, number]>): number[] => pts.flatMap(([x, y]) => [X(x), Y(y)]);

  // one far-to-near pass over faces and bottles together, so a bottle is hidden by anything nearer than the rack it sits in
  type Item = { depth: number; draw: () => void };
  const items: Item[] = [];
  for (const f of scene.faces) {
    items.push({ depth: f.depth, draw: () => {
      const base = palette[f.kind] ?? palette.wall;
      const glass = f.kind === 'glass';
      layer.add(new Konva.Line({
        points: flat(f.pts), closed: true, fill: glass ? 'rgba(205,230,242,0.6)' : shade(base, f.shade), stroke: glass ? '#8fbfd8' : f.kind === 'floor' ? '#c9ad7c' : 'rgba(60,40,20,0.35)', strokeWidth: glass ? 2 : 1, lineJoin: 'round', listening: false,
        ...(f.kind === 'rackTop' ? { shadowColor: '#000', shadowBlur: 8, shadowOpacity: 0.22, shadowOffset: { x: 0, y: 4 } } : {}),
      }));
    } });
  }
  for (const bt of scene.bottles) {
    items.push({ depth: bt.depth, draw: () => {
      const rx = bt.rx * k, ry = bt.ry * k;
      layer.add(new Konva.Ellipse({ x: X(bt.x), y: Y(bt.y), radiusX: rx, radiusY: ry, rotation: bt.rotation, fill: '#2f6a3d', stroke: '#9fd0a8', strokeWidth: Math.max(0.3, Math.min(rx, ry) * 0.12), listening: false }));
      if (rx >= 2.2 && ry >= 2.2) {
        layer.add(new Konva.Ellipse({ x: X(bt.x), y: Y(bt.y), radiusX: rx * 0.46, radiusY: ry * 0.46, rotation: bt.rotation, fill: 'rgba(222,186,104,0.9)', listening: false }));
        layer.add(new Konva.Circle({ x: X(bt.x) - rx * 0.4, y: Y(bt.y) - ry * 0.4, radius: Math.max(0.6, Math.min(rx, ry) * 0.14), fill: 'rgba(255,255,255,0.65)', listening: false }));
      }
    } });
  }
  items.sort((a, c) => c.depth - a.depth);
  // floor first (it has the largest depth anyway), then the boards on it
  for (const it of items) {
    it.draw();
    if (items.indexOf(it) === 0) for (const l of scene.lines) layer.add(new Konva.Line({ points: flat(l.pts), stroke: 'rgba(110,80,40,0.16)', strokeWidth: 1, listening: false }));
  }
  // measurements last, on top of everything: a thin line with end ticks and the size on a small white label
  if (opts.labels !== false) {
    for (const d of scene.dimensions) {
      const ax = X(d.a[0]), ay = Y(d.a[1]), bx = X(d.b[0]), by = Y(d.b[1]);
      const len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len * 5, ny = (bx - ax) / len * 5;
      layer.add(new Konva.Line({ points: [ax, ay, bx, by], stroke: '#3b3b3b', strokeWidth: 1.2, listening: false }));
      for (const [px, py] of [[ax, ay], [bx, by]]) layer.add(new Konva.Line({ points: [px - nx, py - ny, px + nx, py + ny], stroke: '#3b3b3b', strokeWidth: 1.2, listening: false }));
      const label = new Konva.Text({ text: d.text, fontSize: 12, fontFamily: 'system-ui, sans-serif', fill: '#222', padding: 3, listening: false });
      const lx = (ax + bx) / 2 - label.width() / 2, ly = (ay + by) / 2 - label.height() / 2;
      layer.add(new Konva.Rect({ x: lx, y: ly, width: label.width(), height: label.height(), fill: 'rgba(255,255,255,0.88)', cornerRadius: 3, listening: false }));
      label.position({ x: lx, y: ly });
      layer.add(label);
    }
  }
  if (scene.door && opts.labels !== false) {
    layer.add(new Konva.Text({ x: X(scene.door.x) - 20, y: Y(scene.door.y) - 22, text: 'Door ▲', fontSize: 12, fontFamily: 'system-ui, sans-serif', fill: '#7a5a1c', listening: false }));
  }
  layer.batchDraw();
}

export function CellarView({ input, testid, description, finish = 'OAK' }: { input: Omit<SceneInput, 'yawDeg'>; testid: string; description: string; finish?: FinishKey }) {
  const [zoom, setZoom] = useState(1);
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage | null>(null);
  const layer = useRef<Konva.Layer | null>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [yaw, setYaw] = useState(0);
  const drag = useRef<{ x: number; yaw: number } | null>(null);
  const scene = useMemo(() => buildScene({ ...input, yawDeg: yaw }), [input, yaw]);

  useEffect(() => {
    const el = host.current;
    if (!el) return undefined;
    const s = new Konva.Stage({ container: el, width: el.clientWidth || 600, height: el.clientHeight || 400 });
    const l = new Konva.Layer();
    s.add(l);
    stage.current = s; layer.current = l;
    const ro = new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; if (w && h) { s.size({ width: w, height: h }); setSize({ w, h }); } });
    ro.observe(el);
    // dragging turns the view a little to the left or right
    s.on('mousedown touchstart', () => { drag.current = { x: s.getPointerPosition()?.x ?? 0, yaw: yawRef.current }; el.classList.add('dragging'); });
    s.on('mousemove touchmove', () => {
      const p = s.getPointerPosition();
      if (!drag.current || !p) return;
      // dragging right slides the camera left, so the room appears to follow the hand
      setYaw(Math.max(-40, Math.min(40, drag.current.yaw - (p.x - drag.current.x) * 0.15)));
    });
    s.on('mouseup mouseleave touchend touchcancel', () => { drag.current = null; el.classList.remove('dragging'); });
    return () => { ro.disconnect(); s.destroy(); stage.current = null; layer.current = null; };
  }, []);
  const yawRef = useRef(yaw);
  yawRef.current = yaw;

  useEffect(() => {
    const el = host.current;
    if (layer.current && el) {
      paint(layer.current, scene, size.w, size.h, { finish, zoom });
      el.dataset.zoom = zoom.toFixed(2);
      el.dataset.finish = finish;
      el.dataset.dims = String(scene.dimensions.length);
      el.dataset.bottles = String(scene.stats.bottles);
      el.dataset.racks = String(scene.stats.racks);
      el.dataset.doorx = scene.door ? scene.door.x.toFixed(1) : '';
      el.dataset.yaw = yaw.toFixed(1);
    }
  }, [scene, size, yaw, finish, zoom]);

  return (
    <div className="drawing" data-testid={testid} data-tour="cp-drawing">
      <div ref={host} className="drawing-canvas" data-testid={`${testid}-canvas`} role="img" aria-label={description} />
      <span className="cellar-hint">Drag to look left or right</span>
      <ZoomControls testid={testid} onIn={() => setZoom((z) => Math.min(2.5, +(z * 1.25).toFixed(3)))} onOut={() => setZoom((z) => Math.max(1, +(z / 1.25).toFixed(3)))} onReset={() => { setZoom(1); setYaw(0); }} canReset={zoom !== 1 || yaw !== 0} />
    </div>
  );
}
