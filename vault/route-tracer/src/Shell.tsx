import { Compass, CircleHelp, Layers, LocateFixed, Minus, Plus, Search, Settings } from 'lucide-react';
import type maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { api, type GeocodeResult } from './api';
import { looksLikeRequest, planFromIntent } from './ask';
import { fromLines } from './drawing';
import { bboxOf, formatDistance, totalKm } from './geo';
import { fitToLimit, MAX_FILE_BYTES, parseGpx } from './gpx';
import { startTour } from './help/tour';
import { Mic } from './Mic';
import { PlacesButton } from './Places';
import { fitTo } from './Panels';
import { fitPadding } from './layout';
import { usePlan } from './Plan';
import { suggestPlaces } from './placeSearch';
import { tidySpoken } from './voice';
import { STYLES, useStore } from './store';

/** Close a popover on a press outside it or on Escape. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return undefined;
    const down = (e: PointerEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key); };
  }, [open, close, ref]);
}

/** The top bar: the app's name, place search, and the settings and help buttons. */
export function Header({ map }: { map: maplibregl.Map | null }) {
  const { setInfoOpen } = useStore();
  const toast = useStore((s) => s.toast);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLFormElement>(null);
  useDismiss(results.length > 0, () => setResults([]), box);

  async function placeSearch(text: string) {
    setBusy(true);
    try {
      const r = await api.geocode(text);
      setResults(r.results);
      if (!r.results.length) toast('error', 'No places found.');
    } catch (err) { toast('error', err instanceof Error ? err.message : 'Search failed.'); } finally { setBusy(false); }
  }

  /** A plain-English request: the server works out what is wanted, the places are found, and Plan route is set up as if filled in by hand. Returns false if it was not a route request after all. */
  async function askRoute(text: string): Promise<boolean> {
    const st = useStore.getState();
    if (!st.routePlanning) { toast('error', 'Route planning is not set up on this server yet, so I can only look for places.'); return false; }
    if (st.drawing) { toast('error', 'Finish or discard your drawing first, then ask for a route.'); return true; }
    setBusy(true);
    try {
      const { intent } = await api.ask(text);
      if (intent.kind === 'none') return false;
      const c = map?.getCenter();
      const find = async (name: string): Promise<GeocodeResult | null> => { // nearest to where the map is looking; MapTiler first, Vault's own search if it cannot answer
        try { const r = await suggestPlaces(name, st.mapKey, c ? [c.lng, c.lat] : null); if (r[0]) return r[0]; } catch { /* fall back */ }
        try { return (await api.geocode(name)).results[0] ?? null; } catch { return null; }
      };
      const done = await planFromIntent(intent, find, usePlan.getState());
      if (!done.ok) { toast('error', done.message); return true; }
      toast('ok', done.summary);
      if (map) {
        if (done.points.length > 1) map.fitBounds([done.points[0], done.points[1]], { padding: fitPadding(), maxZoom: 15, duration: 600 });
        else map.flyTo({ center: done.points[0], zoom: 14 });
      }
      return true;
    } catch (err) { toast('error', err instanceof Error ? err.message : 'That did not work.'); return true; } finally { setBusy(false); }
  }

  async function run(text: string) {
    const t = text.trim();
    if (!t) return;
    setResults([]);
    if (looksLikeRequest(t) && (await askRoute(t))) return;
    await placeSearch(t);
  }
  function search(e: React.FormEvent) { e.preventDefault(); void run(q); }
  const go = (r: GeocodeResult) => { map?.flyTo({ center: [r.lng, r.lat], zoom: 14 }); setResults([]); };

  return (
    <header className="app-header">
      <form ref={box} className="header-search" onSubmit={search} role="search" data-tour="rt-search">
        <Search size={16} className="search-icon" aria-hidden="true" />
        <span className="vwrap">
          <input
            aria-label="Search a place or ask for a route" placeholder="Search a place, or ask: route from Morningside to Carindale" value={q} onChange={(e) => setQ(e.target.value)}
            title="Type a suburb, address or landmark and press Enter: the map flies to the one you pick. Or ask for a route in plain words, such as: route from Morningside to Carindale, a 10 km loop from Bulimba, or a cycle ride from Toowong to the city. Plan route is then set up for you to check and change."
          />
          <Mic label="Speak a place or a route request" onText={setQ} onDone={(t) => { const s = tidySpoken(t); setQ(s); void run(s); }} />
        </span>
        {busy && <span className="search-busy" aria-hidden="true">…</span>}
        {results.length > 0 && (
          <ul className="results" role="listbox">
            {results.map((r, i) => <li key={i}><button type="button" title="Fly the map to this place" onClick={() => go(r)}>{r.label}</button></li>)}
          </ul>
        )}
      </form>
      <div className="header-right">
        <SettingsMenu map={map} />
        <button type="button" className="icon-btn" onClick={() => setInfoOpen(true)} aria-label="How this works" title="How Route Tracer works: a plain guide to every feature"><CircleHelp size={20} /></button>
      </div>
    </header>
  );
}

/** Open a GPX file in the drawing tools (Edit points mode, so a stray touch cannot draw): see it, measure it, fix it, Finish to save. */
export async function importGpxFile(file: File | undefined, map: maplibregl.Map | null): Promise<void> {
  const toast = useStore.getState().toast;
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) return toast('error', 'That file is larger than 15 MB.');
  let source: string;
  try { source = await file.text(); } catch { return toast('error', 'Could not read that file.'); }
  const parsed = parseGpx(source);
  if (!parsed.ok) return toast('error', parsed.error);
  const { gpx } = parsed;
  const fit = fitToLimit(gpx.lines);
  const s = useStore.getState();
  s.startDrawing(fromLines(fit.lines));
  s.setMode('edit');
  s.setImported({ name: gpx.name, notes: gpx.notes });
  const box = bboxOf(fit.lines);
  if (map && box) fitTo(map, box);
  const notes = [
    `Imported ${formatDistance(totalKm(fit.lines), s.units)}.`,
    fit.after < fit.before ? `Simplified from ${fit.before.toLocaleString()} to ${fit.after.toLocaleString()} points to fit.` : '',
    gpx.skipped ? `${gpx.skipped} points with bad coordinates were left out.` : '',
    'Press Finish to save it.',
  ].filter(Boolean);
  toast('ok', notes.join(' '), 7000);
}

/** The gear: units, distance markers, GPX import and the tour. */
function SettingsMenu({ map }: { map: maplibregl.Map | null }) {
  const { units, setUnits, markersOn, setMarkersOn, drawing } = useStore();
  const planningNow = usePlan((s) => s.active);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useDismiss(open, () => setOpen(false), wrap);
  const menuRequest = useStore((s) => s.menuRequest);
  useEffect(() => { if (menuRequest?.name === 'settings') setOpen(true); }, [menuRequest]);
  const idle = !drawing && !planningNow;

  async function importGpx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be chosen again
    await importGpxFile(file, map);
  }

  return (
    <div className="menu-wrap" ref={wrap}>
      <button type="button" className="icon-btn" aria-label="Settings" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)} title="Settings: units, distance markers, import a GPX file, take the tour" data-tour="rt-menu"><Settings size={20} /></button>
      {open && (
        <div className="menu" role="menu" aria-label="Settings">
          <label className="menu-row">Units
            <select aria-label="Units" value={units} onChange={(e) => setUnits(e.target.value as 'km' | 'mi')} title="Show distances in kilometres or miles. Markers follow: every 1 km or every 1 mi. Remembered on this device.">
              <option value="km">Kilometres</option>
              <option value="mi">Miles</option>
            </select>
          </label>
          <button type="button" role="menuitemcheckbox" aria-checked={markersOn} aria-pressed={markersOn} onClick={() => setMarkersOn(!markersOn)} title={`Show or hide the numbered distance markers along the line (every 1 ${units}; zoomed out they thin to every 5th, 10th and so on)`}>Distance markers</button>
          <button type="button" role="menuitem" disabled={!idle} onClick={() => { setOpen(false); fileInput.current?.click(); }} title={idle ? 'Open a GPX file from Strava, Garmin or a friend, see it on the map and save it as a track' : 'Finish or cancel what you are doing first'}>Import GPX</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); startTour(); }} aria-label="Take the guided tour" title="Take the guided tour (about two minutes)">Take the tour</button>
        </div>
      )}
      <input ref={fileInput} type="file" accept=".gpx,.xml,application/gpx+xml,text/xml" hidden aria-label="GPX file" title="Choose a GPX file to import" onChange={(e) => void importGpx(e)} />
    </div>
  );
}

/** The map buttons down the right edge: zoom, my location, north up, and the map style. */
export function MapControls({ map }: { map: maplibregl.Map | null }) {
  const { styleId, setStyle } = useStore();
  const toast = useStore((s) => s.toast);
  const [layers, setLayers] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useDismiss(layers, () => setLayers(false), wrap);
  const menuRequest = useStore((s) => s.menuRequest);
  useEffect(() => { if (menuRequest?.name === 'layers') setLayers(true); }, [menuRequest]);

  function locate() {
    if (!navigator.geolocation) return toast('error', 'This device cannot share its location.');
    navigator.geolocation.getCurrentPosition(
      (p) => map?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 15 }),
      () => toast('error', 'Could not get your location. Check the browser permission.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }
  return (
    <div className="mapctl" ref={wrap} data-tour="rt-view">
      <div className="mapctl-group">
        <button type="button" onClick={() => map?.zoomIn()} aria-label="Zoom in" title="Zoom in"><Plus size={20} /></button>
        <button type="button" onClick={() => map?.zoomOut()} aria-label="Zoom out" title="Zoom out"><Minus size={20} /></button>
      </div>
      <div className="mapctl-group">
        <button type="button" onClick={locate} aria-label="Centre on my location" title="Centre the map on where you are (your browser asks permission the first time)"><LocateFixed size={20} /></button>
      </div>
      <div className="mapctl-group">
        <button type="button" onClick={() => map?.easeTo({ bearing: 0, pitch: 0, duration: 300 })} aria-label="Point north" title="Turn the map so north is at the top"><Compass size={20} /></button>
      </div>
      <PlacesButton />
      <div className="mapctl-group layers-wrap">
        <button type="button" onClick={() => setLayers(!layers)} aria-label="Map style" aria-expanded={layers} aria-haspopup="true" title="Map style: Streets for roads and addresses, Outdoor for trails and contours, Satellite for the aerial photo"><Layers size={20} /></button>
        {layers && (
          <div className="layers-pop" role="group" aria-label="Map style">
            {STYLES.map((s) => (
              <button key={s.id} type="button" aria-pressed={styleId === s.id} onClick={() => { setStyle(s.id); setLayers(false); }} title={`Show the ${s.label} map`}>{s.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
