import maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { displayLines } from './drawing';
import { markersAlong, metersPerPixel, stepKmFor, thinFactor, type Lines } from './geo';
import { useStore } from './store';

const NONE: Lines = [];

/**
 * Numbered dots along the line every 1 km (1 mi in miles). Shown for the drawing in progress and for the open track.
 * DOM markers rather than a map text layer: a text layer needs the style's own font names, which differ between Streets, Outdoor and
 * Satellite. Zoomed out they thin to every 2nd / 5th / 10th ... so the numbers never pile up.
 */
export function useDistanceMarkers(map: maplibregl.Map | null): void {
  const { drawing, draw, selected, units, markersOn, drawColor } = useStore();
  const lines = drawing ? displayLines(draw) : selected ? selected.geometry.coordinates : NONE;
  const color = drawing ? drawColor : (selected?.color ?? drawColor);
  const live = useRef(new Map<number, maplibregl.Marker>());

  useEffect(() => {
    if (!map) return undefined;
    let raf = 0;
    const step = stepKmFor(units);
    const sync = () => {
      raf = 0;
      const all = markersOn ? markersAlong(lines, step) : [];
      const mpp = metersPerPixel(map.getZoom(), map.getCenter().lat);
      const every = thinFactor((step * 1000) / mpp, all.length);
      const keep = new Set<number>();
      for (const m of all) {
        if (m.n % every !== 0) continue;
        keep.add(m.n);
        let mk = live.current.get(m.n);
        if (!mk) {
          const el = document.createElement('div');
          el.className = 'km-marker';
          el.setAttribute('aria-hidden', 'true');
          mk = new maplibregl.Marker({ element: el }).setLngLat(m.pos).addTo(map);
          live.current.set(m.n, mk);
        } else mk.setLngLat(m.pos);
        const el = mk.getElement();
        el.textContent = String(m.n);
        el.style.borderColor = color;
      }
      for (const [n, mk] of live.current) if (!keep.has(n)) { mk.remove(); live.current.delete(n); }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(sync); };
    schedule();
    map.on('zoomend', schedule);
    return () => { map.off('zoomend', schedule); cancelAnimationFrame(raf); };
  }, [map, lines, units, markersOn, color]);

  useEffect(() => {
    const markers = live.current;
    return () => { markers.forEach((m) => m.remove()); markers.clear(); };
  }, [map]);
}
