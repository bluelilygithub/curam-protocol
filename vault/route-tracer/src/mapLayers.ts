import type maplibregl from 'maplibre-gl';
import { displayLines } from './drawing';
import type { Lines } from './geo';
import { useStore } from './store';

/** Sources and layers for the line being drawn ('draw') and saved tracks ('saved'). Re-added after every style change. */
export interface SavedLine { id: string; color: string; lines: Lines }

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
let saved: SavedLine[] = [];

/** What was last handed to each source, readable by the end-to-end test (window.routeTracer.sent). */
function sent(name: 'draw' | 'saved', data: GeoJSON.FeatureCollection): void {
  const rt = (window as unknown as { routeTracer?: { sent?: Record<string, GeoJSON.FeatureCollection> } }).routeTracer;
  if (rt) (rt.sent ??= {})[name] = data;
}

export function addLayers(map: maplibregl.Map): void {
  if (map.getSource('saved')) return;
  map.addSource('saved', { type: 'geojson', data: EMPTY });
  map.addSource('draw', { type: 'geojson', data: EMPTY });
  const join = { 'line-join': 'round', 'line-cap': 'round' } as const;
  map.addLayer({ id: 'saved-casing', type: 'line', source: 'saved', layout: join, paint: { 'line-color': '#fff', 'line-width': 6 } });
  map.addLayer({ id: 'saved-line', type: 'line', source: 'saved', layout: join, paint: { 'line-color': ['get', 'color'], 'line-width': 4 } });
  map.addLayer({ id: 'draw-casing', type: 'line', source: 'draw', filter: ['==', ['get', 'kind'], 'line'], layout: join, paint: { 'line-color': '#fff', 'line-width': 6 } });
  map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', filter: ['==', ['get', 'kind'], 'line'], layout: join, paint: { 'line-color': ['get', 'color'], 'line-width': 4 } });
  map.addLayer({ id: 'draw-rubber', type: 'line', source: 'draw', filter: ['==', ['get', 'kind'], 'rubber'], layout: join, paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [1.5, 1.5] } });
  map.addLayer({ id: 'draw-vertex', type: 'circle', source: 'draw', filter: ['==', ['get', 'kind'], 'vertex'], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 3 } });
  pushSaved(map);
  renderDrawNow(map);
}

function pushSaved(map: maplibregl.Map): void {
  const src = map.getSource('saved') as maplibregl.GeoJSONSource | undefined;
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: saved.filter((s) => s.lines.length).map((s) => ({
      type: 'Feature', properties: { id: s.id, color: s.color }, geometry: { type: 'MultiLineString', coordinates: s.lines },
    })),
  };
  sent('saved', data);
  src?.setData(data);
}

export function setSaved(map: maplibregl.Map, tracks: SavedLine[]): void {
  saved = tracks;
  if (map.getSource('saved')) pushSaved(map);
}

function renderDrawNow(map: maplibregl.Map): void {
  const src = map.getSource('draw') as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  const { draw, drawing, rubber, mode, drawColor } = useStore.getState();
  if (!drawing) { sent('draw', EMPTY); src.setData(EMPTY); return; }
  const lines = displayLines(draw);
  const features: GeoJSON.Feature[] = lines.filter((l) => l.length >= 2).map((l) => ({
    type: 'Feature', properties: { kind: 'line', color: drawColor }, geometry: { type: 'LineString', coordinates: l },
  }));
  const last = lines[lines.length - 1];
  if (mode === 'click') {
    for (const l of lines) for (const p of l) features.push({ type: 'Feature', properties: { kind: 'vertex', color: drawColor }, geometry: { type: 'Point', coordinates: p } });
    if (rubber && last?.length) features.push({ type: 'Feature', properties: { kind: 'rubber', color: drawColor }, geometry: { type: 'LineString', coordinates: [last[last.length - 1], rubber] } });
  }
  const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
  sent('draw', data);
  src.setData(data);
}

/** At most one setData per animation frame, however many points arrive. */
let frame = 0;
export function scheduleDrawRender(map: maplibregl.Map): void {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; renderDrawNow(map); });
}
