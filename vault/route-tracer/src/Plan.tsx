import maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { api, ApiError, type PlannedRoute, type PlanProfile } from './api';
import { fromLines } from './drawing';
import { bboxOf, formatDistance, nearestOnLines, type Pos } from './geo';
import { fitToLimit } from './gpx';
import { setPlanned } from './mapLayers';
import { useStore } from './store';

export const PLAN_COLORS = ['#E4572E', '#1D6FA5', '#2E7D32'];
export const PROFILES: { id: PlanProfile; label: string; tip: string }[] = [
  { id: 'walking', label: 'Walking', tip: 'Footpaths, shared paths and quiet roads' },
  { id: 'hiking', label: 'Hiking', tip: 'Prefers trails and tracks' },
  { id: 'cycling', label: 'Cycling', tip: 'Bike paths and bike-friendly roads' },
  { id: 'driving', label: 'Driving', tip: 'Roads a car can use' },
];
const PROFILE_KEY = 'route-tracer:plan-profile';
const TAP_PX = 22;

const savedProfile = (): PlanProfile => {
  try { const v = localStorage.getItem(PROFILE_KEY); if (PROFILES.some((p) => p.id === v)) return v as PlanProfile; } catch { /* default */ }
  return 'walking';
};

interface PlanState {
  active: boolean;
  from: Pos | null;
  to: Pos | null;
  profile: PlanProfile;
  busy: boolean;
  error: string | null;
  routes: PlannedRoute[];
  selected: number;
  attribution: string | null;
  start(): void;
  cancel(): void;
  setFrom(p: Pos | null): void;
  setTo(p: Pos | null): void;
  setProfile(p: PlanProfile): void;
  swap(): void;
  reset(): void;
  select(i: number): void;
  setResult(routes: PlannedRoute[], attribution: string | null): void;
  setBusy(b: boolean): void;
  setError(e: string | null): void;
}

const blank = { from: null, to: null, busy: false, error: null, routes: [] as PlannedRoute[], selected: 0, attribution: null };

/** Plan route mode: two points, a way of travelling, and up to three routes between them along real roads and paths. */
export const usePlan = create<PlanState>((set, get) => ({
  active: false,
  ...blank,
  profile: savedProfile(),
  start: () => set({ active: true, ...blank }),
  cancel: () => set({ active: false, ...blank }),
  // a new point means the old answers no longer apply
  setFrom: (from) => set({ from, routes: [], error: null, selected: 0 }),
  setTo: (to) => set({ to, routes: [], error: null, selected: 0 }),
  setProfile: (profile) => { try { localStorage.setItem(PROFILE_KEY, profile); } catch { /* private window */ } set({ profile, routes: [], error: null, selected: 0 }); },
  swap: () => { const { from, to } = get(); set({ from: to, to: from, routes: [], error: null, selected: 0 }); },
  reset: () => set({ ...blank }),
  select: (selected) => set({ selected }),
  setResult: (routes, attribution) => set({ routes, attribution, selected: 0, busy: false, error: null }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error, busy: false, routes: [] }),
}));

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

function pin(label: string, kind: 'a' | 'b'): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `plan-pin plan-pin-${kind}`;
  el.textContent = label;
  el.title = kind === 'a' ? 'Start. Drag to move it.' : 'End. Drag to move it.';
  return el;
}

/** The map side of planning: taps place the start and end, the pins can be dragged, the routes are asked for and drawn, a tap chooses one. */
export function usePlanning(map: maplibregl.Map | null): void {
  const active = usePlan((s) => s.active);
  const from = usePlan((s) => s.from);
  const to = usePlan((s) => s.to);
  const profile = usePlan((s) => s.profile);
  const routes = usePlan((s) => s.routes);
  const selected = usePlan((s) => s.selected);
  const markers = useRef<{ a?: maplibregl.Marker; b?: maplibregl.Marker }>({});
  const req = useRef(0);
  const fitted = useRef(false); // the map is fitted to the routes once per plan: not again when a pin is dragged (the map would jump under the pointer)

  // taps: first the start, then the end, then (with routes showing) a tap on a line chooses that route
  useEffect(() => {
    if (!map || !active) return undefined;
    const el = map.getCanvasContainer();
    const prev = el.style.cursor;
    el.style.cursor = 'crosshair';
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const st = usePlan.getState();
      const pos: Pos = [e.lngLat.lng, e.lngLat.lat];
      if (!st.from) return st.setFrom(pos);
      if (!st.to) return st.setTo(pos);
      let best = -1;
      let bestPx = TAP_PX;
      st.routes.forEach((r, i) => {
        const hit = nearestOnLines([r.coordinates], (p) => map.project(p), e.point, TAP_PX);
        if (hit && hit.px < bestPx) { bestPx = hit.px; best = i; }
      });
      if (best >= 0) st.select(best);
      return undefined;
    };
    map.on('click', onClick);
    return () => { map.off('click', onClick); el.style.cursor = prev; };
  }, [map, active]);

  // the A and B pins (draggable: dropping one asks for new routes)
  useEffect(() => {
    if (!map) return undefined;
    const sync = (which: 'a' | 'b', pos: Pos | null): void => {
      const cur = markers.current[which];
      if (!active || !pos) { cur?.remove(); markers.current[which] = undefined; return; }
      if (cur) { cur.setLngLat(pos); return; }
      const el = pin(which === 'a' ? 'A' : 'B', which);
      el.addEventListener('click', (e) => e.stopPropagation()); // a tap on a pin is not a tap on the map
      el.addEventListener('pointerdown', () => { // the map must not pan while a pin is dragged
        map.dragPan.disable();
        const up = (): void => { map.dragPan.enable(); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      });
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(pos).addTo(map);
      m.on('dragend', () => { const ll = m.getLngLat(); const p: Pos = [ll.lng, ll.lat]; if (which === 'a') usePlan.getState().setFrom(p); else usePlan.getState().setTo(p); });
      markers.current[which] = m;
    };
    sync('a', from);
    sync('b', to);
    return undefined;
  }, [map, active, from, to]);
  useEffect(() => () => { markers.current.a?.remove(); markers.current.b?.remove(); markers.current = {}; }, []);

  useEffect(() => { if (!active || (!from && !to)) fitted.current = false; }, [active, from, to]);

  // ask for routes when both ends are set (after a short pause, ignoring answers that arrive late)
  useEffect(() => {
    if (!map || !active || !from || !to) return undefined;
    const id = ++req.current;
    usePlan.getState().setBusy(true);
    const t = setTimeout(() => {
      api.plan({ from, to, profile })
        .then((r) => {
          if (id !== req.current) return;
          usePlan.getState().setResult(r.routes, r.attribution);
          const box = bboxOf(r.routes.map((x) => x.coordinates));
          if (box && !fitted.current) {
            fitted.current = true;
            const phone = window.matchMedia('(max-width: 767px)').matches;
            map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: { top: 90, left: 60, right: 60, bottom: phone ? Math.round(window.innerHeight * 0.55) : 430 }, maxZoom: 17, duration: 600 });
          }
        })
        .catch((e: unknown) => { if (id === req.current) usePlan.getState().setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not plan that route.'); });
    }, 250);
    return () => { clearTimeout(t); };
  }, [map, active, from, to, profile]);

  // the routes on the map; the chosen one is thick and solid, the others thin and faded
  useEffect(() => {
    if (!map) return;
    setPlanned(map, active ? routes.map((r, i) => ({ coordinates: r.coordinates, color: PLAN_COLORS[i % PLAN_COLORS.length], sel: i === selected })) : []);
  }, [map, active, routes, selected]);
}

export function PlanBar({ map }: { map: maplibregl.Map | null }) {
  const { active, from, to, profile, busy, error, routes, selected, attribution, cancel, setProfile, swap, reset, select } = usePlan();
  const units = useStore((s) => s.units);
  if (!active) return null;

  function useRoute(): void {
    const r = routes[selected];
    if (!r) return;
    const fit = fitToLimit([r.coordinates]);
    const s = useStore.getState();
    s.startDrawing(fromLines(fit.lines));
    s.setMode('edit');
    s.setPlanned(true);
    cancel();
    const box = bboxOf(fit.lines);
    if (map && box) window.dispatchEvent(new CustomEvent('route-tracer:fit', { detail: box }));
    s.toast('ok', `Route loaded: ${formatDistance(r.distanceM / 1000, s.units)}. Drag points to adjust it, then press Finish to save.`, 6000);
  }

  const step = !from ? 'Tap the map to set the start (A).' : !to ? 'Tap the map to set the end (B).' : busy ? 'Finding routes…' : error ? '' : routes.length ? 'Tap a route below, or a line on the map, to choose it.' : '';
  const shortest = routes.length > 1 ? routes.reduce((m, r, i) => (r.distanceM < routes[m].distanceM ? i : m), 0) : -1;
  return (
    <section className="drawbar planbar" aria-label="Plan a route" data-testid="planbar">
      <div className="plan-head">
        <b>Plan a route</b>
        <select
          aria-label="Travel by" value={profile} onChange={(e) => setProfile(e.target.value as PlanProfile)}
          title="How you are travelling: Walking uses footpaths and quiet roads, Hiking prefers trails, Cycling uses bike paths and roads, Driving uses roads a car can take"
        >
          {PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      {step && <p className="hint plan-step" data-testid="plan-step">{step}</p>}
      {error && <p className="plan-error" role="alert" data-testid="plan-error">{error}</p>}
      {routes.length > 0 && (
        <ul className="plan-routes" aria-label="Routes found">
          {routes.map((r, i) => (
            <li key={i}>
              <button
                type="button" aria-pressed={i === selected} onClick={() => select(i)} data-testid="plan-route"
                title="Show this route on the map. You can also tap its line on the map."
              >
                <span className="dot" style={{ background: PLAN_COLORS[i % PLAN_COLORS.length] }} />
                <span className="plan-name">Route {i + 1}{i === shortest ? ' · shortest' : ''}</span>
                <span className="plan-meta">{formatDistance(r.distanceM / 1000, units)}{r.durationS ? ` · ${formatDuration(r.durationS)}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button type="button" onClick={swap} disabled={!from || !to} title="Swap the start and the end and plan again">Swap A and B</button>
        <button type="button" onClick={reset} disabled={!from && !to} title="Clear both points and start again">Reset</button>
      </div>
      <div className="row">
        <button type="button" className="primary" onClick={useRoute} disabled={!routes.length} title="Open the chosen route in the drawing tools, where you can adjust its points, see its elevation and save it as a track">Use this route</button>
        <button type="button" onClick={cancel} title="Stop planning without keeping a route">Cancel</button>
      </div>
      <p className="hint plan-credit">Routes © <a href="https://openrouteservice.org" target="_blank" rel="noopener noreferrer" title="openrouteservice.org">openrouteservice.org</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" title="OpenStreetMap copyright and licence">OpenStreetMap contributors</a></p>
      {attribution ? <span className="sr-only">{attribution}</span> : null}
    </section>
  );
}
