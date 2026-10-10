import Konva from 'konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildScene, type Scene, type SceneInput } from './cellarScene';

// The "Cellar view" picture: the inside of the cellar from the door, drawn from the pure scene in cellarScene.ts. Drag to look left or right.

const BASE: Record<string, [number, number, number]> = {
  floor: [217, 188, 140], wall: [239, 231, 216], glass: [205, 230, 242], rackTop: [205, 152, 98], rackEnd: [128, 84, 45], rackFront: [112, 74, 42], marker: [230, 185, 92],
};
const shade = ([r, g, b]: [number, number, number], k: number): string => `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;

export function paint(layer: Konva.Layer, scene: Scene, w: number, h: number, opts: { pad?: number; labels?: boolean } = {}): void {
  layer.destroyChildren();
  const bg = new Konva.Rect({ x: 0, y: 0, width: w, height: h, fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: { x: 0, y: h }, fillLinearGradientColorStops: [0, '#f6f2ea', 1, '#e3d9c6'], listening: false });
  layer.add(bg);
  const { bounds: b } = scene;
  const pad = opts.pad ?? 28;
  const k = Math.min((w - pad * 2) / Math.max(1, b.x1 - b.x0), (h - pad * 2) / Math.max(1, b.y1 - b.y0));
  const ox = (w - (b.x1 - b.x0) * k) / 2 - b.x0 * k, oy = (h - (b.y1 - b.y0) * k) / 2 - b.y0 * k;
  const X = (x: number): number => ox + x * k, Y = (y: number): number => oy + y * k;
  const flat = (pts: Array<[number, number]>): number[] => pts.flatMap(([x, y]) => [X(x), Y(y)]);

  // one far-to-near pass over faces and bottles together, so a bottle is hidden by anything nearer than the rack it sits in
  type Item = { depth: number; draw: () => void };
  const items: Item[] = [];
  for (const f of scene.faces) {
    items.push({ depth: f.depth, draw: () => {
      const base = BASE[f.kind] ?? BASE.wall;
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
  if (scene.door && opts.labels !== false) {
    layer.add(new Konva.Text({ x: X(scene.door.x) - 20, y: Y(scene.door.y) + 6, text: 'Door ▲', fontSize: 12, fontFamily: 'system-ui, sans-serif', fill: '#7a5a1c', listening: false }));
  }
  layer.batchDraw();
}

export function CellarView({ input, testid, description }: { input: Omit<SceneInput, 'yawDeg'>; testid: string; description: string }) {
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
      paint(layer.current, scene, size.w, size.h);
      el.dataset.bottles = String(scene.stats.bottles);
      el.dataset.racks = String(scene.stats.racks);
      el.dataset.doorx = scene.door ? scene.door.x.toFixed(1) : '';
      el.dataset.yaw = yaw.toFixed(1);
    }
  }, [scene, size, yaw]);

  return (
    <div className="drawing" data-testid={testid} data-tour="cp-drawing">
      <div ref={host} className="drawing-canvas" data-testid={`${testid}-canvas`} role="img" aria-label={description} />
      <span className="cellar-hint">Drag to look left or right</span>
      {yaw !== 0 && <button type="button" className="btn fit" title="Look straight ahead again." onClick={() => setYaw(0)} data-testid={`${testid}-reset`}>Reset</button>}
    </div>
  );
}
