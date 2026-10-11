import { useEffect, useState } from 'react';
import { buildProfile, maptilerTiles, pointAtKm, type Profile } from './elevation';
import { formatDistance, type Lines } from './geo';
import { useStore } from './store';

const W = 320;
const H = 112;
const PAD = { l: 38, r: 8, t: 8, b: 18 };
const FT = 3.28084;

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; profile: Profile };

/** Heights in metres, or feet when the units are miles. */
export function formatElevation(m: number, units: 'km' | 'mi'): string {
  return units === 'mi' ? `${Math.round(m * FT).toLocaleString()} ft` : `${Math.round(m).toLocaleString()} m`;
}

/**
 * The elevation profile under a route: height along the distance, with total climb and descent. Heights come from MapTiler's terrain
 * tiles with the browser key. Hovering or dragging across the chart puts a pin on that spot of the map and reads its height and distance.
 */
export function ElevationChart({ lines, color, name }: { lines: Lines; color: string; name: string }) {
  const mapKey = useStore((s) => s.mapKey);
  const units = useStore((s) => s.units);
  const setProbe = useStore((s) => s.setProbe);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [cursor, setCursor] = useState<number | null>(null); // index of the sample under the pointer

  useEffect(() => {
    if (!mapKey) { setState({ status: 'error', message: 'The map key is not available.' }); return undefined; }
    let dead = false;
    setState({ status: 'loading' });
    // the route may be changing under the pen: wait for a pause, and ignore an answer that arrives after a newer request
    const t = setTimeout(() => {
      buildProfile(lines, maptilerTiles(mapKey))
        .then((profile) => { if (!dead) setState({ status: 'ready', profile }); })
        .catch((e: unknown) => { if (!dead) setState({ status: 'error', message: e instanceof Error ? e.message : 'Elevation is not available.' }); });
    }, 400);
    return () => { dead = true; clearTimeout(t); };
  }, [lines, mapKey]);

  useEffect(() => () => { useStore.getState().setProbe(null); }, []);

  if (state.status === 'loading') return <p className="hint" data-testid="ele-loading">Reading terrain heights…</p>;
  if (state.status === 'error') return <p className="hint" role="alert" data-testid="ele-error">{state.message}</p>;

  const p = state.profile;
  const span = Math.max(20, p.max - p.min); // a flat route is not stretched into a mountain
  const lo = p.min - (span - (p.max - p.min)) / 2;
  const x = (km: number): number => PAD.l + (p.totalKm === 0 ? 0 : (km / p.totalKm) * (W - PAD.l - PAD.r));
  const y = (e: number): number => PAD.t + (1 - (e - lo) / span) * (H - PAD.t - PAD.b);
  const line = p.km.map((k, i) => `${x(k).toFixed(1)},${y(p.ele[i]).toFixed(1)}`).join(' ');
  const base = H - PAD.b;
  const area = `${x(0).toFixed(1)},${base} ${line} ${x(p.totalKm).toFixed(1)},${base}`;

  function at(clientX: number, el: SVGSVGElement): void {
    const r = el.getBoundingClientRect();
    const fx = ((clientX - r.left) / r.width) * W;
    const km = Math.min(p.totalKm, Math.max(0, ((fx - PAD.l) / (W - PAD.l - PAD.r)) * p.totalKm));
    let i = 0;
    while (i < p.km.length - 1 && p.km[i + 1] < km) i += 1;
    if (i < p.km.length - 1 && km - p.km[i] > p.km[i + 1] - km) i += 1; // the nearer sample
    setCursor(i);
    const pos = pointAtKm(lines, p.km[i]);
    if (pos) setProbe({ pos, km: p.km[i], totalKm: p.totalKm, name, color, several: false, ele: p.ele[i] });
  }
  const leave = (): void => { setCursor(null); setProbe(null); };

  const summary = `Climb ${formatElevation(p.ascent, units)}, descent ${formatElevation(p.descent, units)}, lowest ${formatElevation(p.min, units)}, highest ${formatElevation(p.max, units)}`;
  return (
    <div className="ele" data-testid="elevation">
      <div className="ele-stats" data-testid="ele-stats" aria-live="polite" title="Climb and descent only count rises and falls of more than 3 m, so small bumps in the terrain data do not add up. Heights are a terrain model, good to a few metres.">
        <span><b>↑ {formatElevation(p.ascent, units)}</b> climb</span>
        <span><b>↓ {formatElevation(p.descent, units)}</b> descent</span>
        <span>{formatElevation(p.min, units)} to {formatElevation(p.max, units)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`} className="ele-svg" role="img" aria-label={`Elevation profile. ${summary}`} data-testid="ele-svg"
        onPointerMove={(e) => at(e.clientX, e.currentTarget)} onPointerDown={(e) => at(e.clientX, e.currentTarget)} onPointerLeave={leave}
        data-tip="Move across the chart (or drag a finger) to see that spot on the map with its height and distance"
      >
        <polygon points={area} fill={color} opacity="0.22" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={base} className="ele-axis" />
        <line x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} className="ele-axis" />
        <text x={PAD.l - 4} y={PAD.t + 8} textAnchor="end" className="ele-label">{formatElevation(lo + span, units)}</text>
        <text x={PAD.l - 4} y={base} textAnchor="end" className="ele-label">{formatElevation(lo, units)}</text>
        <text x={PAD.l} y={H - 4} className="ele-label">0</text>
        <text x={W - PAD.r} y={H - 4} textAnchor="end" className="ele-label">{formatDistance(p.totalKm, units)}</text>
        {cursor !== null && (
          <>
            <line x1={x(p.km[cursor])} x2={x(p.km[cursor])} y1={PAD.t} y2={base} className="ele-cursor" />
            <circle cx={x(p.km[cursor])} cy={y(p.ele[cursor])} r="4" fill="#fff" stroke={color} strokeWidth="2" />
          </>
        )}
      </svg>
      {p.gaps > 0 && <p className="hint">{p.gaps} points had no terrain data and were estimated from their neighbours.</p>}
    </div>
  );
}
