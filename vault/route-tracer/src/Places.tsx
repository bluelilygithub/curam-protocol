import { Landmark, X } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import { useEffect, useMemo, useRef } from 'react';
import { create } from 'zustand';
import { api, ApiError } from './api';
import { displayLines } from './drawing';
import { formatDistance } from './geo';
import { setPlaces } from './mapLayers';
import { ALL_CATEGORY_IDS, DEFAULT_CATEGORIES, nearestRadius, pickRoute, radiusOptions, readCats, toFeatures, visiblePlaces, type Place, type PlaceCategory } from './placesModel';
import { usePlan } from './Plan';
import { useStore } from './store';

const RADIUS_KEY = 'route-tracer:places-radius';
const CATS_KEY = 'route-tracer:places-cats';
const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* private window */ } };

interface Found { places: Place[]; counts: Record<string, number>; categories: PlaceCategory[]; truncated: boolean; radiusKm: number; routeKm: number; routeKey: string; routeLabel: string; attribution: string }

interface PlacesState {
  open: boolean;
  setOpen(v: boolean): void;
  radiusKm: number;
  setRadiusKm(km: number): void;
  cats: string[];
  toggleCat(id: string): void;
  setCats(ids: string[]): void;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  found: Found | null;
  search(): Promise<void>;
  clear(): void;
}

let seq = 0;

/** Places near a route: the choices (distance, categories), the last answer, and the search. */
export const usePlaces = create<PlacesState>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  radiusKm: Number(read(RADIUS_KEY)) > 0 ? Number(read(RADIUS_KEY)) : 2,
  setRadiusKm: (radiusKm) => { write(RADIUS_KEY, String(radiusKm)); set({ radiusKm }); },
  cats: readCats(read(CATS_KEY), ALL_CATEGORY_IDS, DEFAULT_CATEGORIES),
  toggleCat: (id) => { const cats = get().cats.includes(id) ? get().cats.filter((c) => c !== id) : [...get().cats, id]; write(CATS_KEY, JSON.stringify(cats)); set({ cats }); },
  setCats: (cats) => { write(CATS_KEY, JSON.stringify(cats)); set({ cats }); },
  status: 'idle',
  error: null,
  found: null,
  clear: () => { seq += 1; set({ status: 'idle', error: null, found: null }); },
  search: async () => {
    const st = useStore.getState(); const plan = usePlan.getState();
    const route = pickRoute({ planActive: plan.active, planRoutes: plan.routes, planSelected: plan.selected, drawing: st.drawing, drawLines: displayLines(st.draw), track: st.selected });
    if (!route) { set({ status: 'error', error: 'Open a track, plan a route or draw one first, then search near it.' }); return; }
    const id = ++seq;
    set({ status: 'loading', error: null });
    try {
      const r = await api.places({ line: route.line, radiusKm: get().radiusKm });
      if (id !== seq) return;
      set({ status: 'ready', found: { places: r.places, counts: r.counts, categories: r.categories, truncated: r.truncated, radiusKm: r.radiusKm, routeKm: r.routeKm, routeKey: route.key, routeLabel: route.label, attribution: r.attribution } });
    } catch (e) {
      if (id !== seq) return;
      set({ status: 'error', error: e instanceof ApiError || e instanceof Error ? e.message : 'Places could not be found.' });
    }
  },
}));

/** The route the panel would search near right now. */
function useRoute() {
  const planActive = usePlan((s) => s.active);
  const planRoutes = usePlan((s) => s.routes);
  const planSelected = usePlan((s) => s.selected);
  const { drawing, draw, selected } = useStore();
  return useMemo(() => pickRoute({ planActive, planRoutes, planSelected, drawing, drawLines: displayLines(draw), track: selected }), [planActive, planRoutes, planSelected, drawing, draw, selected]);
}

/** Puts the places that are switched on on the map, and shows a small card when one is tapped (but not while drawing or planning: a tap there places a point). */
export function usePlacesLayer(map: maplibregl.Map | null): void {
  const found = usePlaces((s) => s.found);
  const cats = usePlaces((s) => s.cats);
  const shown = useMemo(() => (found ? visiblePlaces(found.places, new Set(cats)) : []), [found, cats]);
  const units = useStore((s) => s.units);
  const popup = useRef<maplibregl.Popup | null>(null);

  useEffect(() => { if (map) setPlaces(map, toFeatures(shown, found?.categories ?? [])); }, [map, shown, found]);

  useEffect(() => {
    if (!map) return undefined;
    const tap = (e: maplibregl.MapLayerMouseEvent): void => {
      if (useStore.getState().drawing || usePlan.getState().active) return;
      const f = e.features?.[0];
      if (!f || f.geometry.type !== 'Point') return;
      const p = f.properties as { name: string; category: string; distKm: number };
      const box = document.createElement('div');
      box.className = 'place-card';
      const h = document.createElement('strong'); h.textContent = p.name;
      const c = document.createElement('div'); c.textContent = p.category;
      const d = document.createElement('div'); d.className = 'hint'; d.textContent = `${formatDistance(Number(p.distKm), units)} from the route`;
      box.append(h, c, d);
      popup.current?.remove();
      popup.current = new maplibregl.Popup({ closeButton: true, maxWidth: '240px', offset: 10 }).setLngLat(f.geometry.coordinates as [number, number]).setDOMContent(box).addTo(map);
    };
    const over = (): void => { map.getCanvas().style.cursor = 'pointer'; };
    const out = (): void => { map.getCanvas().style.cursor = ''; };
    map.on('click', 'places-dot', tap); map.on('mouseenter', 'places-dot', over); map.on('mouseleave', 'places-dot', out);
    return () => { map.off('click', 'places-dot', tap); map.off('mouseenter', 'places-dot', over); map.off('mouseleave', 'places-dot', out); popup.current?.remove(); };
  }, [map, units]);

  useEffect(() => { if (!found) popup.current?.remove(); }, [found]);
}

/** The button among the map buttons. It shows as pressed while places are on the map. */
export function PlacesButton() {
  const { open, setOpen, found } = usePlaces();
  return (
    <div className="mapctl-group">
      <button type="button" onClick={() => setOpen(!open)} aria-label="Places near the route" aria-expanded={open} aria-haspopup="dialog" aria-pressed={!!found} data-tour="rt-places"
        title="Show notable buildings, landmarks and entertainment venues within a distance of the route you have open, planned or drawn. Choose the distance and the kinds of place.">
        <Landmark size={20} />
      </button>
    </div>
  );
}

/** The panel: pick how far from the route and which kinds of place, search, then read or tap the results. It sits over the map beside the map buttons. */
export function PlacesPanel({ map }: { map: maplibregl.Map | null }) {
  const { open, setOpen, radiusKm, setRadiusKm, cats, toggleCat, setCats, status, error, found, search, clear } = usePlaces();
  const units = useStore((s) => s.units);
  const route = useRoute();
  const opts = radiusOptions(units);
  const radius = nearestRadius(units, radiusKm);
  const enabled = useMemo(() => new Set(cats), [cats]);
  const list = useMemo(() => (found ? visiblePlaces(found.places, enabled) : []), [found, enabled]);
  const categories = found?.categories ?? [];
  const stale = !!found && !!route && found.routeKey !== route.key;
  const changedDistance = !!found && Math.abs(found.radiusKm - radius) > 1e-6;

  return (
    <>
      {open && (
        <div className="places-pop" role="dialog" aria-label="Places near the route" data-testid="places-panel">
          <div className="places-head">
            <h2>Places near the route</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close places" title="Close this panel (the places stay on the map)"><X size={16} aria-hidden="true" /></button>
          </div>
          <p className="hint" data-testid="places-route">{route ? <>Route: <b>{route.label}</b></> : 'No route yet. Open a track, plan a route or draw one, then search near it.'}</p>
          <div className="places-radius" role="group" aria-label="Distance from the route">
            <span>Within</span>
            {opts.map((o) => (
              <button key={o.km} type="button" aria-pressed={Math.abs(o.km - radius) < 1e-6} onClick={() => setRadiusKm(o.km)} title={`Places up to ${o.label} from any point on the route`}>{o.label}</button>
            ))}
          </div>
          <button type="button" className="primary wide" disabled={!route || status === 'loading'} onClick={() => void search()} data-testid="places-search"
            title={route ? 'Look up notable places near the route (from OpenStreetMap)' : 'Choose a route first'}>
            {status === 'loading' ? 'Searching…' : found ? 'Search again' : 'Find places'}
          </button>
          {status === 'error' && error && <p className="plan-error" role="alert" data-testid="places-error">{error}</p>}
          {(stale || changedDistance) && status !== 'loading' && <p className="hint" data-testid="places-stale">{stale ? 'The route has changed since this search.' : 'The distance has changed since this search.'} Press Search again.</p>}

          <fieldset className="places-cats">
            <legend>Kinds of place</legend>
            <div className="row">
              <button type="button" onClick={() => setCats(ALL_CATEGORY_IDS)} title="Show every kind of place">All</button>
              <button type="button" onClick={() => setCats([])} title="Hide every kind of place">None</button>
            </div>
            {(categories.length ? categories : ALL_CATEGORY_IDS.map((id) => ({ id, label: FALLBACK_LABEL[id] ?? id, color: '#777777' }))).map((c) => (
              <label key={c.id} className="check places-cat" title={`Show or hide: ${c.label}`}>
                {/* one control, not two: the tick box itself wears the colour of that kind's pins on the map */}
                <input type="checkbox" checked={enabled.has(c.id)} onChange={() => toggleCat(c.id)} title={`Show or hide: ${c.label}`} style={{ accentColor: c.color }} />
                <span className="places-label">{c.label}</span>
                {found && <span className="places-n" aria-label={`${found.counts[c.id] ?? 0} found`}>{found.counts[c.id] ?? 0}</span>}
              </label>
            ))}
          </fieldset>

          {found && (
            <>
              <p className="hint" data-testid="places-summary" aria-live="polite">
                {list.length} shown, within {formatDistance(found.radiusKm, units)} of the route{found.truncated ? ' (the best-known of each kind; choose a smaller distance to see more)' : ''}.
                {' '}<button type="button" className="linklike" onClick={clear} title="Take the places off the map">Clear</button>
                {list.length > 0 && <> <button type="button" className="linklike" onClick={() => fitPlaces(map, list)} title="Zoom the map to fit all the places shown">Show all</button></>}
              </p>
              {!list.length && <p className="hint" data-testid="places-none">{Object.values(found.counts).some((n) => n > 0) ? 'None of the kinds you have switched on were found. Switch more on.' : 'Nothing notable was found that close. Try a larger distance.'}</p>}
              <ul className="places-list" data-testid="places-list">
                {list.slice(0, 100).map((p) => {
                  const c = categories.find((x) => x.id === p.category);
                  return (
                    <li key={p.id}>
                      <button type="button" onClick={() => map?.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 16) })} title={`Fly the map to ${p.name}`} style={{ borderLeft: `4px solid ${c?.color ?? '#777'}` }}>
                        <span className="places-name">{p.name}</span>
                        <span className="places-dist">{formatDistance(p.distKm, units)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="hint">Places © OpenStreetMap contributors. Coverage varies by area; a place missing here may be missing from OpenStreetMap.</p>
            </>
          )}
        </div>
      )}
    </>
  );
}

const FALLBACK_LABEL: Record<string, string> = {
  landmarks: 'Landmarks and attractions', museums: 'Museums and galleries', shows: 'Theatres and cinemas', sport: 'Stadiums and arenas', fun: 'Zoos and theme parks',
  nightlife: 'Nightclubs and casinos', worship: 'Notable places of worship', civic: 'Civic buildings and libraries', campus: 'Universities and hospitals',
};

function fitPlaces(map: maplibregl.Map | null, list: Place[]): void {
  if (!map || !list.length) return;
  const b = new maplibregl.LngLatBounds([list[0].lng, list[0].lat], [list[0].lng, list[0].lat]);
  for (const p of list) b.extend([p.lng, p.lat]);
  map.fitBounds(b, { padding: 80, maxZoom: 16, duration: 600 });
}
