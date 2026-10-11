import maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { formatDistance, nearestOnLines } from './geo';
import { getSavedLines } from './mapLayers';
import { useStore } from './store';

const TAP_PX = 22; // how close to a line a tap must land (a finger is not a pixel)

/**
 * Tap (or click) a track on the map: a pin lands on the nearest point of the line and the readout says how far that is from the start
 * and how far is left. Works on the track that is open (and on every track when Show all is on); not while drawing or editing, where
 * a tap already means something. Tap away from the line, press Escape or open another track to clear it.
 */
export function useDistanceProbe(map: maplibregl.Map | null): void {
  const { drawing, selected, showAll, probe } = useStore();
  const pin = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!map || drawing) return undefined;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const tracks = getSavedLines();
      let best: { hit: NonNullable<ReturnType<typeof nearestOnLines>>; name: string; color: string } | null = null;
      for (const t of tracks) {
        const hit = nearestOnLines(t.lines, (p) => map.project(p), e.point, TAP_PX);
        if (hit && (!best || hit.px < best.hit.px)) best = { hit, name: t.name, color: t.color };
      }
      useStore.getState().setProbe(best ? { pos: best.hit.pos, km: best.hit.km, totalKm: best.hit.totalKm, name: best.name, color: best.color, several: tracks.length > 1 } : null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useStore.getState().setProbe(null); };
    map.on('click', onClick);
    window.addEventListener('keydown', onKey);
    return () => { map.off('click', onClick); window.removeEventListener('keydown', onKey); };
  }, [map, drawing]);

  // a different track, Show all toggled or drawing started: the old reading no longer means anything
  useEffect(() => { useStore.getState().setProbe(null); }, [selected?.id, showAll, drawing]);

  useEffect(() => {
    if (!map) return undefined;
    if (!probe) { pin.current?.remove(); pin.current = null; return undefined; }
    if (!pin.current) {
      const el = document.createElement('div');
      el.className = 'probe-pin';
      el.setAttribute('aria-hidden', 'true');
      pin.current = new maplibregl.Marker({ element: el }).setLngLat(probe.pos).addTo(map);
    } else pin.current.setLngLat(probe.pos);
    pin.current.getElement().style.background = probe.color;
    return undefined;
  }, [map, probe]);

  useEffect(() => () => { pin.current?.remove(); pin.current = null; }, [map]);
}

export function ProbeReadout() {
  const { probe, units, setProbe } = useStore();
  if (!probe) return null;
  const toGo = Math.max(0, probe.totalKm - probe.km);
  return (
    <div className="probe" role="status" aria-live="polite" data-testid="probe">
      {probe.several && <div className="probe-name">{probe.name}</div>}
      <div className="probe-main"><strong>{formatDistance(probe.km, units)}</strong> from start</div>
      <div className="probe-sub">{formatDistance(toGo, units)} to go</div>
      <button type="button" className="probe-close" aria-label="Clear distance reading" onClick={() => setProbe(null)}>✕</button>
    </div>
  );
}
