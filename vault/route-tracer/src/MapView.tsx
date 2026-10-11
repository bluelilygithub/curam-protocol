import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { addLayers } from './mapLayers';
import { useStore } from './store';

const VIEW_KEY = 'route-tracer:view';
const DEFAULT_VIEW = { center: [153.03, -27.47] as [number, number], zoom: 10 };

function savedView(): { center: [number, number]; zoom: number } {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as { center?: [number, number]; zoom?: number } | null;
    if (v && Array.isArray(v.center) && typeof v.zoom === 'number') return { center: v.center, zoom: v.zoom };
  } catch { /* none */ }
  return DEFAULT_VIEW;
}

export const styleUrl = (id: string, key: string): string => `https://api.maptiler.com/maps/${id}/style.json?key=${key}`;

/** Owns the MapLibre instance. Reports it once created; re-adds the track layers after every style switch. */
export default function MapView({ mapKey, onMap }: { mapKey: string; onMap: (m: maplibregl.Map) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const styleId = useStore((s) => s.styleId);
  const [first] = useState(styleId);

  useEffect(() => {
    if (!box.current) return undefined;
    const v = savedView();
    const map = new maplibregl.Map({
      container: box.current,
      style: styleUrl(first, mapKey),
      center: v.center,
      zoom: v.zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({}), 'bottom-left');
    map.on('style.load', () => addLayers(map));
    map.on('moveend', () => {
      const c = map.getCenter();
      try { localStorage.setItem(VIEW_KEY, JSON.stringify({ center: [c.lng, c.lat], zoom: map.getZoom() })); } catch { /* private window */ }
    });
    mapRef.current = map;
    (window as unknown as { routeTracer?: { map: maplibregl.Map } }).routeTracer = { map }; // for the end-to-end test
    onMap(map);
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey]);

  useEffect(() => {
    const m = mapRef.current;
    if (m && styleId !== first) m.setStyle(styleUrl(styleId, mapKey));
  }, [styleId, first, mapKey]);

  return <div ref={box} className="map" data-testid="map" />;
}
