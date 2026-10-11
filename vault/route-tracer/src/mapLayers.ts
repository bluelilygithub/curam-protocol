import type maplibregl from 'maplibre-gl';
import { displayLines, midOf, MIN_MID_PX, screenDist } from './drawing';
import type { Lines } from './geo';
import { useStore } from './store';

/** Sources and layers for the line being drawn ('draw') and saved tracks ('saved'). Re-added after every style change. */
export interface SavedLine { id: string; name: string; color: string; lines: Lines }

/** The saved tracks currently drawn on the map (the tap-a-track readout reads these). */
export const getSavedLines = (): SavedLine[] => saved;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
let saved: SavedLine[] = [];
const MAX_HANDLES = 2500;

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
  map.addLayer({ id: 'draw-mid', type: 'circle', source: 'draw', filter: ['==', ['get', 'kind'], 'mid'], paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-opacity': 0.75, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.75 } });
  map.addLayer({ id: 'draw-vertex', type: 'circle', source: 'draw', filter: ['==', ['get', 'kind'], 'vertex'], paint: { 'circle-radius': ['case', ['get', 'sel'], 9, 6], 'circle-color': ['case', ['get', 'sel'], ['get', 'color'], '#fff'], 'circle-stroke-color': ['case', ['get', 'sel'], '#fff', ['get', 'color']], 'circle-stroke-width': 3 } });
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
  const { draw, drawing, rubber, mode, drawColor, selectedVertex } = useStore.getState();
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
  if (mode === 'edit') {
    // handles only for what is on screen (a long track can have thousands of points), capped
    const b = map.getBounds();
    const inView = (p: [number, number]) => p[0] >= b.getWest() && p[0] <= b.getEast() && p[1] >= b.getSouth() && p[1] <= b.getNorth();
    let n = 0;
    lines.forEach((l, li) => {
      l.forEach((p, vi) => {
        if (n >= MAX_HANDLES || !inView(p)) return;
        n += 1;
        const sel = selectedVertex?.li === li && selectedVertex.vi === vi;
        features.push({ type: 'Feature', properties: { kind: 'vertex', color: drawColor, sel }, geometry: { type: 'Point', coordinates: p } });
      });
      for (let i = 1; i < l.length && n < MAX_HANDLES; i += 1) {
        if (!inView(l[i]) && !inView(l[i - 1])) continue;
        const a = map.project(l[i - 1]);
        const c = map.project(l[i]);
        if (screenDist(a, c) < MIN_MID_PX) continue;
        n += 1;
        features.push({ type: 'Feature', properties: { kind: 'mid', color: drawColor }, geometry: { type: 'Point', coordinates: midOf(l[i - 1], l[i]) } });
      }
    });
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
