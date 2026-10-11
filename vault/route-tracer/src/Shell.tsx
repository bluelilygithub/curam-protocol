import { Compass, CircleHelp, Layers, LocateFixed, Minus, Plus, Route as RouteIcon, Search, Settings } from 'lucide-react';
import type maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { api, type GeocodeResult } from './api';
import { fromLines } from './drawing';
import { bboxOf, formatDistance, totalKm } from './geo';
import { fitToLimit, MAX_FILE_BYTES, parseGpx } from './gpx';
import { startTour } from './help/tour';
import { fitTo } from './Panels';
import { usePlan } from './Plan';
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

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await api.geocode(q.trim());
      setResults(r.results);
      if (!r.results.length) toast('error', 'No places found.');
    } catch (err) { toast('error', err instanceof Error ? err.message : 'Search failed.'); } finally { setBusy(false); }
  }
  const go = (r: GeocodeResult) => { map?.flyTo({ center: [r.lng, r.lat], zoom: 14 }); setResults([]); };

  return (
    <header className="app-header">
      <div className="brand" title="Route Tracer"><RouteIcon size={22} aria-hidden="true" /><span>Route Tracer</span></div>
      <form ref={box} className="header-search" onSubmit={search} role="search" data-tour="rt-search">
        <Search size={16} className="search-icon" aria-hidden="true" />
        <input
          aria-label="Search a place" placeholder="Search a place or address" value={q} onChange={(e) => setQ(e.target.value)}
          title="Type a suburb, address or landmark and press Enter. The map flies to the one you pick."
        />
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

/** The gear: units, distance markers, GPX import and the tour. */
function SettingsMenu({ map }: { map: maplibregl.Map | null }) {
  const { units, setUnits, markersOn, setMarkersOn, drawing } = useStore();
  const planningNow = usePlan((s) => s.active);
  const toast = useStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useDismiss(open, () => setOpen(false), wrap);
  const idle = !drawing && !planningNow;

  /** Open a GPX file in the drawing tools (Edit points mode, so a stray touch cannot draw): see it, measure it, fix it, Finish to save. */
  async function importGpx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be chosen again
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
