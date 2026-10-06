import { useEffect, useRef, useState } from 'react';
import { isLocated, type GardenProject } from '../domain/types';
import { toPixel, TILE } from '../map/mercator';
import type { MapStatus } from '../map/tiles';
import { useApp, useUi } from './AppContext';
import { CheckField, NumField } from './fields';
import { Icon } from './icons';

/** The map's status (is it set up, what to credit), asked once. */
export function useMapStatus(enabled = true): MapStatus | null {
  const app = useApp();
  const [s, setS] = useState<MapStatus | null>(() => app.mapTiles.peekStatus());
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    void app.mapTiles.status().then((v) => { if (live) setS(v); });
    return () => { live = false; };
  }, [app, enabled]);
  return s;
}

/** Garden settings: switch the satellite map on, line it up with the plot, fade it. */
export function MapSection({ project }: { project: GardenProject }) {
  const app = useApp();
  const align = useUi((s) => s.mapAlign);
  const on = !!project.map?.on;
  const status = useMapStatus(true);
  return (
    <>
      <h3>Satellite map</h3>
      <CheckField label="Show a satellite map under the plan" checked={on} onChange={(v) => app.showMap(v)} hint="Aerial photo of your street, so you can trace the plot, house and beds. Shadows from the sun slider fall across it." />
      {status && !status.enabled && <p className="note warn" role="status" data-testid="map-unavailable">{status.reason}</p>}
      {on && status?.enabled && (
        <>
          <p className="note" data-testid="map-howto">{isLocated(project.location)
            ? 'The map is centred on your address (the middle of the plan). If the pin is a little off your house, move the map until it sits where you drew it. Then draw over it.'
            : 'Your location is only as exact as a suburb, so move the map until your house sits where you drew it. Then draw over it.'}</p>
          <div className="row">
            <button type="button" className={`btn${align ? ' primary' : ''}`} aria-pressed={align} onClick={() => app.ui.getState().set({ mapAlign: !align })}>
              <Icon name="map" size={15} /> {align ? 'Done moving' : 'Move map'}
            </button>
            <button type="button" className="btn" title="Put the map back at the garden's location" onClick={() => app.resetMap()}>Reset</button>
          </div>
          <NumField label="Map strength" unit="%" value={Math.round((project.map?.opacity ?? 1) * 100)} min={10} max={100} step={5} decimals={0} onCommit={(v) => project.map && app.setMap({ ...project.map, opacity: v / 100 }, 'Change map strength')} />
          <p className="note">The map turns with the north arrow, and is true to scale, so lengths you draw are real. It lies on the ground in the 3D view too, where the sun's shadows fall across it.</p>
        </>
      )}
    </>
  );
}

/** The credit the provider requires, over the corner of the plan, whenever the map is showing. */
export function MapAttribution({ project }: { project: GardenProject }) {
  const status = useMapStatus(!!project.map?.on);
  if (!project.map?.on || !status?.enabled) return null;
  return <p className="map-credit" data-testid="map-attribution">{status.attribution}</p>;
}

/**
 * A small map of the place chosen in the wizard: the tiles around it with a pin. Only asks once the place has settled for a moment, and
 * shows nothing (not an error) when the map is not available.
 */
export function MapPreview({ lat, lng, zoom = 16 }: { lat: number; lng: number; zoom?: number }) {
  const app = useApp();
  const ref = useRef<HTMLCanvasElement>(null);
  const status = useMapStatus(true);
  const [tick, setTick] = useState(0);
  const W = 360, H = 200, Z = Math.min(20, Math.max(10, Math.round(zoom)));
  useEffect(() => {
    const c = ref.current;
    if (!c || !status?.enabled) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const centre = toPixel({ lat, lng }, Z);
    const x0 = centre.x - W / 2, y0 = centre.y - H / 2;
    ctx.fillStyle = '#e8ebe0';
    ctx.fillRect(0, 0, W, H);
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + H) / TILE); ty += 1) {
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + W) / TILE); tx += 1) {
        const img = app.mapTiles.tile(Z, tx, ty, () => setTick((n) => n + 1));
        if (img) ctx.drawImage(img, tx * TILE - x0, ty * TILE - y0, TILE, TILE);
      }
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.fillStyle = '#d93a2b';
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }, [app, lat, lng, status, tick, Z]);
  if (!status?.enabled) return null;
  return (
    <figure className="map-preview" data-testid="map-preview">
      <canvas ref={ref} width={W} height={H} role="img" aria-label="Map of the chosen place" />
      <figcaption>{status.attribution}</figcaption>
    </figure>
  );
}

export type { MapStatus };
