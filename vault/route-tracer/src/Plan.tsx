import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, Bike, Car, ChevronLeft, Footprints, Mountain, Plus, Search, X } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { api, ApiError, type Cue, type GeocodeResult, type PlannedRoute, type PlanProfile } from './api';
import { fromLines } from './drawing';
import { bboxOf, formatDistance, nearestOnLines, type Pos } from './geo';
import { fitToLimit } from './gpx';
import { fitPadding } from './layout';
import { setPlanned } from './mapLayers';
import { Field, Mic } from './Mic';
import { MIN_LETTERS, suggestPlaces } from './placeSearch';
import { tidySpoken } from './voice';
import { parseSpokenNumber } from '@vault-client/utils/units/numbers.mjs';
import { DirectionsList } from './Directions';
import { useStore } from './store';

export const PLAN_COLORS = ['#E4572E', '#1D6FA5', '#2E7D32'];
export const PROFILES: { id: PlanProfile; label: string; tip: string; Icon: typeof Footprints }[] = [
  { id: 'walking', label: 'Walking', tip: 'Footpaths, shared paths and quiet roads', Icon: Footprints },
  { id: 'hiking', label: 'Hiking', tip: 'Prefers trails and tracks', Icon: Mountain },
  { id: 'cycling', label: 'Cycling', tip: 'Bike paths and bike-friendly roads', Icon: Bike },
  { id: 'driving', label: 'Driving', tip: 'Roads a car can use', Icon: Car },
];
const PROFILE_KEY = 'route-tracer:plan-profile';
const LOOP_KEY = 'route-tracer:loop-km';
export const LOOP_MIN_KM = 1;
export const LOOP_MAX_KM = 50;
export const DETOUR_MIN_KM = 1;
export const DETOUR_MAX_KM = 100;
export const MAX_STOPS = 8; // between A and B; the server takes ten points in all
const KM_PER_MI = 1.609344;
const TAP_PX = 22;

const savedProfile = (): PlanProfile => {
  try { const v = localStorage.getItem(PROFILE_KEY); if (PROFILES.some((p) => p.id === v)) return v as PlanProfile; } catch { /* default */ }
  return 'walking';
};

const savedLoopKm = (): number => {
  try { const v = Number(localStorage.getItem(LOOP_KEY)); if (v >= LOOP_MIN_KM && v <= LOOP_MAX_KM) return v; } catch { /* default */ }
  return 5;
};

/** direct: the best routes from A to B. loop: out from A and back to A, about lengthKm. detour: from A to B, but about detourKm (longer than direct). */
export type PlanKind = 'direct' | 'loop' | 'detour';

interface PlanState {
  kind: PlanKind;
  /** Loop length. */
  lengthKm: number;
  /** Detour length; null = not chosen yet (the direct route is shown so the person can see how long that is). */
  detourKm: number | null;
  /** Loops and detours: 0, 1, 2 ... asks for different ones of the same length. */
  round: number;
  /** The length of the direct route A to B (detours), when known. */
  directM: number | null;
  /** A to B only: stops to pass through between A and B, in order (at most MAX_STOPS), with their place names (null while being looked up). */
  vias: Pos[];
  viaNames: (string | null)[];
  /** The next tap on the map adds a stop. */
  addingStop: boolean;
  startAddStop(): void;
  addVia(p: Pos, name?: string | null): void;
  setVia(i: number, p: Pos, name?: string | null): void;
  nameVia(i: number, p: Pos, name: string): void;
  removeVia(i: number): void;
  moveVia(i: number, by: -1 | 1): void;
  setKind(k: PlanKind): void;
  setLengthKm(km: number): void;
  setDetourKm(km: number | null): void;
  moreLoops(): void;
  active: boolean;
  from: Pos | null;
  to: Pos | null;
  /** The place name shown in the A and B fields; null while it is being looked up. */
  fromName: string | null;
  toName: string | null;
  profile: PlanProfile;
  busy: boolean;
  error: string | null;
  routes: PlannedRoute[];
  selected: number;
  attribution: string | null;
  start(): void;
  cancel(): void;
  setFrom(p: Pos | null, name?: string | null): void;
  setTo(p: Pos | null, name?: string | null): void;
  /** The looked-up name for a point; ignored if the point has moved on since. */
  nameFor(which: 'from' | 'to', p: Pos, name: string): void;
  setProfile(p: PlanProfile): void;
  swap(): void;
  reset(): void;
  select(i: number): void;
  setResult(routes: PlannedRoute[], attribution: string | null, directM?: number | null): void;
  setBusy(b: boolean): void;
  setError(e: string | null, directM?: number | null): void;
}

const blank = { vias: [] as Pos[], viaNames: [] as (string | null)[], addingStop: false, from: null, to: null, fromName: null as string | null, toName: null as string | null, busy: false, error: null, routes: [] as PlannedRoute[], selected: 0, attribution: null, round: 0, directM: null as number | null };
const fresh = { addingStop: false, routes: [] as PlannedRoute[], error: null, selected: 0, round: 0, directM: null as number | null };

/** Plan route mode: points, a way of travelling, and up to three routes along real roads and paths. */
export const usePlan = create<PlanState>((set, get) => ({
  kind: 'direct',
  lengthKm: savedLoopKm(),
  detourKm: null,
  // A loop has no end, so switching to one drops B; A to B and a longer A to B share both points
  setKind: (kind) => { if (kind !== get().kind) set({ kind, ...(kind === 'loop' ? { to: null } : {}), ...(kind !== 'direct' ? { vias: [], viaNames: [] } : {}), ...fresh }); }, // choosing what is already chosen changes nothing; stops only belong to A to B
  setLengthKm: (lengthKm) => { if (lengthKm === get().lengthKm) return; try { localStorage.setItem(LOOP_KEY, String(lengthKm)); } catch { /* private window */ } set({ lengthKm, ...fresh }); },
  setDetourKm: (detourKm) => { if (detourKm === get().detourKm) return; set({ detourKm, ...fresh }); },
  moreLoops: () => set({ round: get().round + 1, routes: [], error: null, selected: 0 }),
  active: false,
  ...blank,
  profile: savedProfile(),
  start: () => set({ active: true, ...blank }),
  cancel: () => set({ active: false, ...blank }),
  // a new point means the old answers no longer apply
  setFrom: (from, name = null) => set({ from, fromName: name, ...fresh }),
  setTo: (to, name = null) => set({ to, toName: name, ...fresh }),
  nameFor: (which, p, name) => { const st = get(); if ((which === 'from' ? st.from : st.to) === p) set(which === 'from' ? { fromName: name } : { toName: name }); },
  setProfile: (profile) => { try { localStorage.setItem(PROFILE_KEY, profile); } catch { /* private window */ } set({ profile, ...fresh }); },
  swap: () => { const { from, to, fromName, toName, vias, viaNames } = get(); set({ from: to, to: from, fromName: toName, toName: fromName, vias: [...vias].reverse(), viaNames: [...viaNames].reverse(), ...fresh }); },
  startAddStop: () => { const st = get(); if (st.kind === 'direct' && st.from && st.to && st.vias.length < MAX_STOPS) set({ addingStop: true }); },
  addVia: (p, name = null) => { const st = get(); if (st.vias.length >= MAX_STOPS) return; set({ vias: [...st.vias, p], viaNames: [...st.viaNames, name], ...fresh }); },
  setVia: (i, p, name = null) => { const st = get(); if (i < 0 || i >= st.vias.length) return; set({ vias: st.vias.map((v, k) => (k === i ? p : v)), viaNames: st.viaNames.map((n, k) => (k === i ? name : n)), ...fresh }); },
  nameVia: (i, p, name) => { const st = get(); if (st.vias[i] === p) set({ viaNames: st.viaNames.map((n, k) => (k === i ? name : n)) }); },
  removeVia: (i) => { const st = get(); set({ vias: st.vias.filter((_, k) => k !== i), viaNames: st.viaNames.filter((_, k) => k !== i), ...fresh }); },
  moveVia: (i, by) => {
    const st = get(); const j = i + by;
    if (j < 0 || j >= st.vias.length) return;
    const vias = [...st.vias]; const names = [...st.viaNames];
    [vias[i], vias[j]] = [vias[j], vias[i]]; [names[i], names[j]] = [names[j], names[i]];
    set({ vias, viaNames: names, ...fresh });
  },
  reset: () => set({ ...blank }),
  select: (selected) => set({ selected }),
  setResult: (routes, attribution, directM = null) => set({ routes, attribution, directM, selected: 0, busy: false, error: null }),
  setBusy: (busy) => set({ busy }),
  setError: (error, directM = null) => set({ error, directM, busy: false, routes: [] }),
}));

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '';
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** A point written out when no place name is known: 27.4684° S, 153.0281° E. */
export function coordLabel(p: Pos): string {
  return `${Math.abs(p[1]).toFixed(4)}° ${p[1] < 0 ? 'S' : 'N'}, ${Math.abs(p[0]).toFixed(4)}° ${p[0] < 0 ? 'W' : 'E'}`;
}

function pin(label: string, kind: 'a' | 'b'): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `plan-pin plan-pin-${kind}`;
  el.textContent = label;
  el.title = kind === 'a' ? 'Start. Drag to move it.' : 'End. Drag to move it.';
  return el;
}

/** The sentence for an error the server sent with numbers (a target shorter than the direct route, or far longer), in the person's units. */
function numberedError(e: ApiError, targetKm: number | null): { message: string; directM: number | null } | null {
  const b = e.body as { code?: string; directM?: number; maxM?: number } | undefined;
  if (!b || typeof b.directM !== 'number') return null;
  const units = useStore.getState().units;
  const direct = formatDistance(b.directM / 1000, units);
  if (b.code === 'TARGET_TOO_SHORT') {
    return { message: `The shortest route is already ${direct}${targetKm ? `, longer than the ${formatDistance(targetKm, units)} you asked for` : ''}. Choose a longer distance.`, directM: b.directM };
  }
  if (b.code === 'TARGET_TOO_LONG') {
    return { message: `That is a lot longer than the direct route (${direct}). Choose up to ${formatDistance((b.maxM ?? b.directM * 4) / 1000, units)}, or use Loop instead.`, directM: b.directM };
  }
  return null;
}

/** The map side of planning: taps place the start and end, the pins can be dragged, the routes are asked for and drawn, a tap chooses one. */
export function usePlanning(map: maplibregl.Map | null): void {
  const active = usePlan((s) => s.active);
  const fromName = usePlan((s) => s.fromName);
  const toName = usePlan((s) => s.toName);
  const from = usePlan((s) => s.from);
  const to = usePlan((s) => s.to);
  const profile = usePlan((s) => s.profile);
  const kind = usePlan((s) => s.kind);
  const lengthKm = usePlan((s) => s.lengthKm);
  const detourKm = usePlan((s) => s.detourKm);
  const round = usePlan((s) => s.round);
  const routes = usePlan((s) => s.routes);
  const selected = usePlan((s) => s.selected);
  const vias = usePlan((s) => s.vias);
  const viaNames = usePlan((s) => s.viaNames);
  const addingStop = usePlan((s) => s.addingStop);
  const markers = useRef<{ a?: maplibregl.Marker; b?: maplibregl.Marker }>({});
  const viaMarkers = useRef<maplibregl.Marker[]>([]);
  const req = useRef(0);
  const fitted = useRef(false); // the map is fitted to the routes once per plan: not again when a pin is dragged (the map would jump under the pointer)

  // taps: first the start, then the end (not for a loop), then (with routes showing) a tap on a line chooses that route
  useEffect(() => {
    if (!map || !active) return undefined;
    const el = map.getCanvasContainer();
    const prev = el.style.cursor;
    el.style.cursor = 'crosshair';
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const st = usePlan.getState();
      const pos: Pos = [e.lngLat.lng, e.lngLat.lat];
      if (!st.from) return st.setFrom(pos);
      if (st.kind !== 'loop' && !st.to) return st.setTo(pos);
      if (st.addingStop) return st.addVia(pos); // the Add a stop button was pressed: this tap is the stop
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
  useEffect(() => () => { markers.current.a?.remove(); markers.current.b?.remove(); markers.current = {}; viaMarkers.current.forEach((m) => m.remove()); viaMarkers.current = []; }, []);

  // numbered pins for the stops between A and B (draggable like A and B: dropping one asks for the route again)
  useEffect(() => {
    if (!map) return;
    viaMarkers.current.forEach((m) => m.remove());
    viaMarkers.current = [];
    if (!active) return;
    vias.forEach((pos, i) => {
      const el = document.createElement('div');
      el.className = 'plan-pin plan-pin-via';
      el.textContent = String(i + 1);
      el.title = `Stop ${i + 1}. Drag to move it.`;
      el.addEventListener('click', (e) => e.stopPropagation());
      el.addEventListener('pointerdown', () => {
        map.dragPan.disable();
        const up = (): void => { map.dragPan.enable(); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      });
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(pos).addTo(map);
      m.on('dragend', () => { const ll = m.getLngLat(); usePlan.getState().setVia(i, [ll.lng, ll.lat]); });
      viaMarkers.current.push(m);
    });
  }, [map, active, vias]);

  // the cursor says a tap will add a stop
  useEffect(() => {
    if (!map || !active || !addingStop) return undefined;
    const el = map.getCanvasContainer();
    el.classList.add('adding-stop');
    return () => el.classList.remove('adding-stop');
  }, [map, active, addingStop]);

  // the name of each stop that was tapped or dragged to: one lookup per point (nameVia ignores an answer for a point that has since moved on)
  const asked = useRef(new WeakSet<Pos>());
  useEffect(() => {
    if (!active) return;
    vias.forEach((p, i) => {
      if (viaNames[i] !== null || asked.current.has(p)) return;
      asked.current.add(p);
      api.reverse(p[1], p[0]).then((r) => usePlan.getState().nameVia(i, p, r.result?.label ?? coordLabel(p))).catch(() => usePlan.getState().nameVia(i, p, coordLabel(p)));
    });
  }, [active, vias, viaNames]);

  // the name of a place that was tapped or dragged to: one deliberate lookup each (the server spaces them), the coordinates if there is no name
  useEffect(() => {
    if (!active || !from || fromName !== null) return undefined;
    let dead = false;
    api.reverse(from[1], from[0]).then((r) => { if (!dead) usePlan.getState().nameFor('from', from, r.result?.label ?? coordLabel(from)); }).catch(() => { if (!dead) usePlan.getState().nameFor('from', from, coordLabel(from)); });
    return () => { dead = true; };
  }, [active, from, fromName]);
  useEffect(() => {
    if (!active || !to || toName !== null) return undefined;
    let dead = false;
    api.reverse(to[1], to[0]).then((r) => { if (!dead) usePlan.getState().nameFor('to', to, r.result?.label ?? coordLabel(to)); }).catch(() => { if (!dead) usePlan.getState().nameFor('to', to, coordLabel(to)); });
    return () => { dead = true; };
  }, [active, to, toName]);

  useEffect(() => { if (!active || (!from && !to)) fitted.current = false; }, [active, from, to]);
  useEffect(() => { fitted.current = false; }, [kind]);

  // ask for routes when what is needed is set (both ends; or a start and a length), after a short pause, ignoring answers that arrive late
  useEffect(() => {
    if (!map || !active || !from) return undefined;
    if (kind !== 'loop' && !to) return undefined;
    if (kind === 'loop' && !(lengthKm >= LOOP_MIN_KM && lengthKm <= LOOP_MAX_KM)) return undefined;
    if (kind === 'detour' && detourKm !== null && !(detourKm >= DETOUR_MIN_KM && detourKm <= DETOUR_MAX_KM)) return undefined;
    const id = ++req.current;
    usePlan.getState().setBusy(true);
    const t = setTimeout(() => {
      const ask: Promise<{ routes: PlannedRoute[]; attribution: string; directM?: number }> = kind === 'loop' ? api.loop({ from, lengthKm, profile, round })
        : kind === 'detour' ? api.detour({ from, to: to as Pos, profile, lengthKm: detourKm ?? undefined, round })
          : vias.length ? api.multi({ points: [from, ...vias, to as Pos], profile }).then((r) => ({ routes: [r.route], attribution: r.attribution }))
            : api.plan({ from, to: to as Pos, profile });
      ask
        .then((r) => {
          if (id !== req.current) return;
          usePlan.getState().setResult(r.routes, r.attribution, r.directM ?? null);
          const box = bboxOf(r.routes.map((x) => x.coordinates));
          if (box && !fitted.current) {
            fitted.current = true;
            map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: fitPadding(), maxZoom: 17, duration: 600 });
          }
        })
        .catch((e: unknown) => {
          if (id !== req.current) return;
          const numbered = e instanceof ApiError ? numberedError(e, detourKm) : null;
          if (numbered) usePlan.getState().setError(numbered.message, numbered.directM);
          else usePlan.getState().setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not plan that route.');
        });
    }, kind === 'direct' ? 250 : 500); // a length is typed, so wait for the typing to stop
    return () => { clearTimeout(t); };
  }, [map, active, kind, from, to, vias, profile, lengthKm, detourKm, round]);

  // the routes on the map; the chosen one is thick and solid, the others thin and faded
  useEffect(() => {
    if (!map) return;
    setPlanned(map, active ? routes.map((r, i) => ({ coordinates: r.coordinates, color: PLAN_COLORS[i % PLAN_COLORS.length], sel: i === selected })) : []);
  }, [map, active, routes, selected]);
}

const KIND_WORD: Record<PlanKind, string> = { direct: 'route', loop: 'loop', detour: 'route' };

const TYPE_PAUSE_MS = 300; // suggestions are asked for once typing pauses this long, not on every keystroke

/**
 * One of the two place fields. Suggestions appear as you type (after a short pause, from 3 letters) from MapTiler; Enter searches straight
 * away; the arrow keys and Enter pick a suggestion, Escape closes the list. An answer to an older keystroke is never shown over a newer one.
 * If MapTiler cannot answer, Enter falls back to Vault's own private place search. Tapping the map or dragging a pin fills in the name.
 */
function PlaceRow({ which, map }: { which: 'from' | 'to' | number; map: maplibregl.Map | null }) {
  const point = usePlan((s) => (which === 'from' ? s.from : which === 'to' ? s.to : s.vias[which] ?? null));
  const name = usePlan((s) => (which === 'from' ? s.fromName : which === 'to' ? s.toName : s.viaNames[which] ?? null));
  const mapKey = useStore((s) => s.mapKey);
  const [text, setText] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [fromMapTiler, setFromMapTiler] = useState(true);
  const typing = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const ctl = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const isStop = typeof which === 'number';
  const label = which === 'from' ? 'A' : which === 'to' ? 'B' : String(which + 1);
  const what = which === 'from' ? 'start' : which === 'to' ? 'end' : `stop ${label}`;
  const shown = point ? (name ?? 'Finding the place…') : '';
  useEffect(() => { if (!typing.current) setText(shown); }, [shown]);
  useEffect(() => () => { window.clearTimeout(timer.current); ctl.current?.abort(); }, []);

  function stop(): void { window.clearTimeout(timer.current); ctl.current?.abort(); seq.current += 1; setBusy(false); }

  /** Ask for places for `q`: `now` is Enter (no pause, and the private search if MapTiler cannot answer). */
  async function ask(q: string, now: boolean): Promise<void> {
    const id = ++seq.current;
    ctl.current = new AbortController();
    setBusy(true); setNote('');
    const c = map?.getCenter();
    try {
      const r = await suggestPlaces(q, mapKey, c ? [c.lng, c.lat] : null, ctl.current.signal);
      if (id !== seq.current) return;
      setResults(r); setActive(-1); setFromMapTiler(true);
      if (!r.length) setNote('No places found. Try another name, or tap the map.');
    } catch (e) {
      if (id !== seq.current || (e as { name?: string })?.name === 'AbortError') return;
      if (!now) { setResults([]); setNote('Suggestions are not available right now. Press Enter to search.'); return; }
      try { // Enter: the private search through Vault instead
        const r = await api.geocode(q);
        if (id !== seq.current) return;
        setResults(r.results); setActive(-1); setFromMapTiler(false);
        if (!r.results.length) setNote('No places found. Try another name, or tap the map.');
      } catch (err) { if (id === seq.current) { setResults([]); setNote(err instanceof Error ? err.message : 'Search failed.'); } }
    } finally { if (id === seq.current) setBusy(false); }
  }

  function typed(v: string): void {
    typing.current = true;
    setText(v); setNote(''); setActive(-1);
    stop();
    if (v.trim().length < MIN_LETTERS) { setResults([]); return; }
    timer.current = window.setTimeout(() => { void ask(v.trim(), false); }, TYPE_PAUSE_MS);
  }
  function search(e: React.FormEvent): void {
    e.preventDefault();
    if (active >= 0 && results[active]) { choose(results[active]); return; }
    stop();
    const q = text.trim();
    if (q.length < MIN_LETTERS) { setResults([]); setNote('Type at least 3 letters, then press Enter.'); return; }
    void ask(q, true);
  }
  function choose(r: GeocodeResult): void {
    stop();
    typing.current = false;
    setText(r.label); // even if this is the place the field already had, the typed words give way to its name
    setResults([]); setNote(''); setActive(-1);
    const p: Pos = [r.lng, r.lat];
    if (which === 'from') usePlan.getState().setFrom(p, r.label); else if (which === 'to') usePlan.getState().setTo(p, r.label); else usePlan.getState().setVia(which, p, r.label);
    map?.flyTo({ center: p, zoom: Math.max(map.getZoom(), 14) });
  }
  function onKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); setActive((i) => (i + 1) % results.length); }
    else if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); setActive((i) => (i <= 0 ? results.length - 1 : i - 1)); }
    else if (e.key === 'Escape' && (results.length || note)) { e.stopPropagation(); stop(); setResults([]); setNote(''); setActive(-1); }
  }
  const open = results.length > 0 || !!note || (busy && text.trim().length >= MIN_LETTERS);
  return (
    <form className="field-row" onSubmit={search}>
      <span className={`field-dot ${isStop ? 'via' : which}`} aria-hidden="true">{label}</span>
      <span className="vwrap">
        <input
          aria-label={which === 'from' ? 'Start (A)' : which === 'to' ? 'End (B)' : `Stop ${label}`} value={text} placeholder={which === 'from' ? 'Search a place, or tap the map' : which === 'to' ? 'Search a place, or tap the map again' : 'Search a place for this stop'}
          autoComplete="off" aria-autocomplete="list" aria-expanded={open}
          onChange={(e) => typed(e.target.value)} onKeyDown={onKey}
          onBlur={() => { typing.current = false; stop(); setText(shown); setResults([]); setNote(''); }}
          title={which === 'from' ? 'The start (A). Start typing a place and pick a suggestion (arrow keys and Enter work), or tap the map. You can also drag the A pin.' : which === 'to' ? 'The end (B). Start typing a place and pick a suggestion (arrow keys and Enter work), or tap the map. You can also drag the B pin.' : `Stop ${label}, on the way from A to B. Start typing a place and pick a suggestion, or drag its pin on the map.`}
        />
        <Mic label={`Speak the ${what} place`} onText={(t) => { typing.current = true; setText(t); }} onDone={(t) => { const w = tidySpoken(t); typing.current = true; setText(w); stop(); if (w.length < MIN_LETTERS) { setNote('Say at least 3 letters of a place name.'); return; } void ask(w, true); }} />
      </span>
      <button type="submit" className="field-go" aria-label={`Search for ${label}`} title={`Search for this place now and set ${label} there`}><Search size={16} aria-hidden="true" /></button>
      {open && (
        <div className="field-pop" role="listbox" aria-label="Places found" aria-live="polite">
          {busy && results.length === 0 && <p className="hint">Searching…</p>}
          {results.map((r, i) => (
            <button key={i} type="button" role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r)} title={`Set ${label} here`}>{r.label}</button>
          ))}
          {note && <p className="hint">{note}</p>}
          {results.length > 0 && <p className="hint pop-credit">{fromMapTiler ? '© MapTiler © OpenStreetMap contributors' : '© OpenStreetMap contributors'}</p>}
        </div>
      )}
    </form>
  );
}

/** The sidebar while planning: where from and to, how you are travelling, what kind of route, and the routes found. */
export function PlanPanel({ map }: { map: maplibregl.Map | null }) {
  const { active, kind, from, to, vias, addingStop, profile, busy, error, routes, selected, attribution, lengthKm, detourKm, directM, round, cancel, setKind, setLengthKm, setDetourKm, moreLoops, setProfile, swap, reset, select, startAddStop, removeVia, moveVia } = usePlan();
  const units = useStore((s) => s.units);
  const unit = units === 'mi' ? 'mi' : 'km';
  const toUnit = (km: number): number => (units === 'mi' ? km / KM_PER_MI : km);
  const shown = (km: number | null): string => (km === null ? '' : String(Math.round(toUnit(km) * 10) / 10));
  const [text, setText] = useState('');
  const typing = useRef(false);
  // the length box shows the stored length in the chosen units, except while it is being typed into
  useEffect(() => { if (!typing.current) setText(shown(kind === 'detour' ? detourKm : lengthKm)); }, [kind, lengthKm, detourKm, units]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!active) return null;

  const loop = kind === 'loop';
  const detour = kind === 'detour';
  const hasLength = loop || detour;
  const minKm = loop ? LOOP_MIN_KM : DETOUR_MIN_KM;
  const maxKm = loop ? LOOP_MAX_KM : DETOUR_MAX_KM;
  const minU = Math.ceil(toUnit(minKm) * 10) / 10;
  const maxU = Math.floor(toUnit(maxKm) * 10) / 10;
  const typed = Number(text);
  const empty = text.trim() === '';
  const valueOk = !empty && Number.isFinite(typed) && typed >= minU && typed <= maxU;
  const lengthOk = detour ? empty || valueOk : valueOk; // a longer-route with no length yet just shows the direct route
  function onLength(v: string): void {
    typing.current = true;
    setText(v);
    const n = Number(v);
    const km = units === 'mi' ? n * KM_PER_MI : n;
    if (v.trim() === '') { if (detour) setDetourKm(null); return; }
    if (Number.isFinite(n) && n >= minU && n <= maxU) { if (detour) setDetourKm(km); else setLengthKm(km); }
  }

  function chooseRoute(): void {
    const r = routes[selected];
    if (!r) return;
    const fit = fitToLimit([r.coordinates]);
    const s = useStore.getState();
    s.startDrawing(fromLines(fit.lines));
    s.setMode('edit');
    s.setPlanned(true);
    s.setPlannedCues(r.steps && r.steps.length ? { cues: r.steps, lines: fit.lines } : null); // saved with the track while the line is left as it is
    cancel();
    const box = bboxOf(fit.lines);
    if (map && box) window.dispatchEvent(new CustomEvent('route-tracer:fit', { detail: box }));
    s.toast('ok', `${loop ? 'Loop' : 'Route'} loaded: ${formatDistance(r.distanceM / 1000, s.units)}. Drag points to adjust it, then press Finish to save.`, 6000);
  }

  const word = KIND_WORD[kind];
  const directOnly = detour && detourKm === null;
  const step = !from ? (loop ? 'Tap the map to set the start. The loop begins and ends there.' : 'Tap the map to set the start (A).')
    : !loop && !to ? 'Tap the map to set the end (B).'
      : hasLength && !lengthOk ? ''
        : busy ? (loop ? 'Finding loops…' : detour ? 'Finding routes of that length…' : 'Finding routes…')
          : error ? ''
            : directOnly && directM ? `The direct route is ${formatDistance(directM / 1000, units)}. Type how long you want it to be (longer than that) for a detour.`
              : routes.length ? (vias.length ? `This ${word} passes through your ${vias.length === 1 ? 'stop' : `${vias.length} stops`} in order. Drag a pin to change it.` : `Tap a ${word} below, or a line on the map, to choose it.`) : '';
  // A to B lists the shortest first (the others in order of length); the map colours and the service's own first choice ("Suggested") stay with each route
  const order = routes.map((_, i) => i);
  if (kind === 'direct' && routes.length > 1) order.sort((a, b) => routes[a].distanceM - routes[b].distanceM);
  const offText = (pct?: number): string => (pct === undefined ? '' : Math.abs(pct) < 1 ? ' (on target)' : ` (${pct > 0 ? '+' : '−'}${Math.abs(Math.round(pct))}%)`);
  const name = (idx: number, pos: number): string => (loop ? `Loop ${pos + 1}` : detour ? (directOnly ? 'Direct route' : `Route ${pos + 1}`) : vias.length ? 'Through your stops' : routes.length === 1 ? 'Route' : pos === 0 ? 'Shortest' : `Option ${pos + 1}`);
  const different = loop ? 'Different loops' : 'Different routes';
  return (
    <section className="side-view" aria-label="Plan a route" data-testid="planbar">
      <div className="side-head">
        <div className="side-back"><button type="button" className="back" onClick={cancel} title="Go back to your tracks and the other choices. Nothing is kept from this plan." data-testid="plan-back"><ChevronLeft size={18} aria-hidden="true" /> Back</button></div>
        <h2>Plan a route</h2>
        <div className="plan-fields" data-tour="rt-fields">
          <div className="plan-fields-rows">
            <PlaceRow which="from" map={map} />
            {vias.map((_, i) => (
              <div className="via-row" key={i}>
                <PlaceRow which={i} map={map} />
                <span className="via-ctl">
                  <button type="button" className="icon-btn" onClick={() => moveVia(i, -1)} disabled={i === 0} aria-label={`Move stop ${i + 1} earlier`} title="Visit this stop earlier"><ArrowUp size={14} aria-hidden="true" /></button>
                  <button type="button" className="icon-btn" onClick={() => moveVia(i, 1)} disabled={i === vias.length - 1} aria-label={`Move stop ${i + 1} later`} title="Visit this stop later"><ArrowDown size={14} aria-hidden="true" /></button>
                  <button type="button" className="icon-btn" onClick={() => removeVia(i)} aria-label={`Remove stop ${i + 1}`} title="Remove this stop and plan the route again"><X size={14} aria-hidden="true" /></button>
                </span>
              </div>
            ))}
            {!loop && <PlaceRow which="to" map={map} />}
          </div>
          {!loop && <button type="button" className="swap-btn" onClick={swap} disabled={!from || !to} aria-label="Swap A and B" title="Swap the start and the end and plan again"><ArrowUpDown size={18} aria-hidden="true" /></button>}
        </div>
        <div className="seg four" role="group" aria-label="Travel by">
          {PROFILES.map(({ id, label, tip, Icon }) => (
            <button key={id} type="button" aria-pressed={profile === id} aria-label={label} onClick={() => setProfile(id)} title={`${label}: ${tip}`}><Icon size={18} aria-hidden="true" /></button>
          ))}
        </div>
        <div className="seg three" role="group" aria-label="Kind of route">
          <button type="button" aria-pressed={kind === 'direct'} onClick={() => setKind('direct')} title="A to B: the best routes from a start (A) to an end (B)">A to B</button>
          <button type="button" aria-pressed={loop} onClick={() => setKind('loop')} title="Loop: a circular route of about the length you choose, starting and ending at one point">Loop</button>
          <button type="button" aria-pressed={detour} onClick={() => setKind('detour')} title="Longer route: from A to B, but a route of about the length you choose (longer than the direct way), for a longer walk, ride or drive between the same two places">Longer route</button>
        </div>
        {kind === 'direct' && (
          <button type="button" className="add-stop" onClick={startAddStop} disabled={!from || !to || vias.length >= MAX_STOPS || busy} aria-pressed={addingStop} data-testid="add-stop"
            title={vias.length >= MAX_STOPS ? `A route can pass through up to ${MAX_STOPS} stops` : !from || !to ? 'Set A and B first, then add stops to pass through on the way' : 'Pass through another place on the way from A to B: press this, then tap the map where the stop should be'}>
            <Plus size={16} aria-hidden="true" /> {addingStop ? 'Tap the map for the stop…' : 'Add a stop'}
          </button>
        )}
        {hasLength && (
          <Field className="plan-length" label={<>{loop ? 'Length' : 'Length you want'} ({unit})</>}>{(id) => (
            <span className="vwrap">
              <input
                id={id}
                type="number" inputMode="decimal" min={minU} max={maxU} step="0.5" value={text} aria-invalid={!lengthOk} placeholder={detour ? 'longer than direct' : undefined}
                onChange={(e) => onLength(e.target.value)} onBlur={() => { typing.current = false; setText(shown(detour ? detourKm : lengthKm)); }}
                title={loop
                  ? `How long the loop should be, from ${minU} to ${maxU} ${unit}. The planner treats it as a target: each loop shows how far it is from what you asked for.`
                  : `How long the whole route from A to B should be, from ${minU} to ${maxU} ${unit}. It must be longer than the direct route, which is shown once A and B are set. Each option shows how far it is from what you asked for.`}
              />
              <Mic label="Say the length" onDone={(t) => { const n = parseSpokenNumber(t); if (n === null || !Number.isFinite(n)) return `Heard "${t}", which is not a number. Try again.`; onLength(String(n)); return undefined; }} />
            </span>
          )}</Field>
        )}
      </div>
      <div className="side-body">
        {hasLength && !lengthOk && <p className="plan-error" role="alert">Choose a length between {minU} and {maxU} {unit}.</p>}
        {step && <p className="hint plan-step" data-testid="plan-step">{step}</p>}
        {error && <p className="plan-error" role="alert" data-testid="plan-error">{error}</p>}
        {routes.length > 0 && (
          <>
            <h3 className="plan-sub">Choose your {word}</h3>
            <ul className="plan-routes" aria-label={loop ? 'Loops found' : 'Routes found'}>
              {order.map((i, pos) => { const r = routes[i]; return (
                <li key={i}>
                  <button
                    type="button" className="route-card" aria-pressed={i === selected} onClick={() => select(i)} data-testid="plan-route"
                    title={`Show this ${word} on the map. You can also tap its line on the map.`}
                  >
                    <span className="rc-top"><span className="dot" style={{ background: PLAN_COLORS[i % PLAN_COLORS.length] }} /><span className="plan-name">{name(i, pos)}</span>{i === 0 && routes.length > 1 && !hasLength ? <span className="rc-tag">Suggested</span> : null}</span>
                    <span className="plan-meta">{formatDistance(r.distanceM / 1000, units)}{hasLength && !directOnly ? offText(r.offPct) : ''}{r.durationS ? ` · ${formatDuration(r.durationS)}` : ''}</span>
                  </button>
                </li>
              ); })}
            </ul>
            {routes[selected]?.steps?.length ? <DirectionsList cues={routes[selected].steps as Cue[]} map={map} units={units} /> : null}
          </>
        )}
        {hasLength && <button type="button" onClick={moreLoops} disabled={!from || (detour && (!to || directOnly)) || !lengthOk || busy || round >= 9} title={loop ? 'Ask for different loops of the same length, heading in other directions' : 'Ask for different routes of the same length, bending the other way or at another point'} data-testid="more-loops">{different}</button>}
        <p className="hint plan-credit">Routes © <a href="https://openrouteservice.org" target="_blank" rel="noopener noreferrer" title="openrouteservice.org">openrouteservice.org</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" title="OpenStreetMap copyright and licence">OpenStreetMap contributors</a></p>
        {attribution ? <span className="sr-only">{attribution}</span> : null}
      </div>
      <div className="side-foot">
        <button type="button" className="primary wide" onClick={chooseRoute} disabled={!routes.length} title={`Open the chosen ${word} in the drawing tools, where you can adjust its points, see its elevation and save it as a track`}>Use selected {word} <ArrowRight size={18} aria-hidden="true" /></button>
        <div className="link-row">
          <button type="button" className="link" onClick={reset} disabled={!from && !to} title="Clear the points and start again">Reset</button>
          <button type="button" className="link" onClick={cancel} title="Stop planning without keeping anything">Cancel</button>
        </div>
      </div>
    </section>
  );
}
