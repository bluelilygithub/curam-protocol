import type maplibregl from 'maplibre-gl';
import { TooltipHost } from '@planner-core/help/TooltipHost';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type GeocodeResult, type Track } from './api';
import { fitToLimit, MAX_FILE_BYTES, parseGpx } from './gpx';
import { displayLines, finish, fromLines, hasWork, undo } from './drawing';
import { ElevationChart } from './ElevationChart';
import { bboxOf, formatDistance, totalKm, type BBox } from './geo';
import { INFO_KEY, startTour } from './help/tour';
import { InfoModal } from './InfoModal';
import MapView from './MapView';
import { useDistanceMarkers } from './Markers';
import { PlanBar, usePlan, usePlanning } from './Plan';
import { ProbeReadout, useDistanceProbe } from './Probe';
import { clearDraft, fitTo, RecoveryBanner, SaveDialog, TracksPanel, useAutosave, useSavedLayer } from './Panels';
import { STYLES, useStore } from './store';
import { useDrawing } from './useDrawing';

const DEV_KEY = (import.meta.env.VITE_MAPTILER_KEY as string | undefined) || null;

type Boot = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; key: string };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const onMap = useCallback((m: maplibregl.Map) => setMap(m), []);

  useEffect(() => {
    const ready = (key: string) => { useStore.getState().setMapKey(key); setBoot({ state: 'ready', key }); };
    api.config()
      .then((c) => { useStore.getState().setRoutePlanning(!!c.routePlanning); return c; })
      .then((c) => (c.maptilerKey ? ready(c.maptilerKey) : DEV_KEY ? ready(DEV_KEY) : setBoot({ state: 'error', message: 'The map key is not set up on the server (ROUTE_TRACER_MAPTILER_KEY).' })))
      .catch((e: unknown) => {
        if (DEV_KEY && !(e instanceof ApiError && e.status === 403)) return ready(DEV_KEY);
        setBoot({ state: 'error', message: e instanceof Error ? e.message : 'Could not start.' });
      });
  }, []);

  if (boot.state === 'loading') return <div className="center">Loading…</div>;
  if (boot.state === 'error') return <div className="center" role="alert">{boot.message}</div>;
  return (
    <div className="app">
      <MapView mapKey={boot.key} onMap={onMap} />
      <Overlays map={map} />
    </div>
  );
}

function Overlays({ map }: { map: maplibregl.Map | null }) {
  const drawing = useStore((s) => s.drawing);
  const saving = useStore((s) => s.saving);
  const planning = usePlan((s) => s.active);
  const onFinish = useCallback(() => {
    const { draw, toast, setSaving } = useStore.getState();
    if (!finish(draw).length) return toast('error', 'Draw at least two points first.');
    setSaving(true);
  }, []);
  useDrawing(map, onFinish);
  useSavedLayer(map);
  useDistanceMarkers(map);
  useDistanceProbe(map);
  usePlanning(map);
  useAutosave();

  const onSaved = useCallback((t: Track) => {
    const { stopDrawing, select } = useStore.getState();
    clearDraft();
    stopDrawing();
    select(t);
    if (map) fitTo(map, t.bbox);
  }, [map]);

  useEffect(() => {
    const onFit = (e: Event) => { if (map) fitTo(map, (e as CustomEvent<BBox>).detail); };
    window.addEventListener('route-tracer:fit', onFit);
    return () => window.removeEventListener('route-tracer:fit', onFit);
  }, [map]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (hasWork(useStore.getState().draw)) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  // First visit: the guide opens once. Vault's Settings page opens the app with ?tour=1 to run the tour instead.
  useEffect(() => {
    if (!map) return;
    if (new URLSearchParams(window.location.search).has('tour')) { setTimeout(() => startTour(), 400); return; }
    try { if (!localStorage.getItem(INFO_KEY)) useStore.getState().setInfoOpen(true); } catch { /* the guide is one click away */ }
  }, [map]);

  return (
    <>
      <TopBar map={map} />
      {drawing && !saving && <DrawToolbar onFinish={onFinish} />}
      {!drawing && !planning && <TracksPanel map={map} />}
      <PlanBar map={map} />
      {saving && <SaveDialog onSaved={onSaved} />}
      <RecoveryBanner />
      <ProbeReadout />
      <Toasts />
      <InfoModal />
      <TooltipHost />
    </>
  );
}

function TopBar({ map }: { map: maplibregl.Map | null }) {
  const { drawing, styleId, setStyle, units, setUnits, startDrawing, panel, setPanel, markersOn, setMarkersOn, setInfoOpen, routePlanning } = useStore();
  const planning = usePlan((s) => s.active);
  const idle = !drawing && !planning;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const fileInput = useRef<HTMLInputElement>(null);

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

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || drawing) return;
    setBusy(true);
    try {
      const r = await api.geocode(q.trim());
      setResults(r.results);
      if (!r.results.length) toast('error', 'No places found.');
    } catch (err) { toast('error', err instanceof Error ? err.message : 'Search failed.'); } finally { setBusy(false); }
  }
  const go = (r: GeocodeResult) => { map?.flyTo({ center: [r.lng, r.lat], zoom: 14 }); setResults([]); };
  function locate() {
    if (!navigator.geolocation) return toast('error', 'This device cannot share its location.');
    navigator.geolocation.getCurrentPosition(
      (p) => map?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 15 }),
      () => toast('error', 'Could not get your location. Check the browser permission.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <header className="topbar">
      <form className="search" onSubmit={search} role="search" data-tour="rt-search">
        <input
          aria-label="Search a place" placeholder="Search a place or address" value={q} disabled={drawing} onChange={(e) => setQ(e.target.value)}
          title={drawing ? 'Search is off while you draw. Finish or cancel the drawing first.' : 'Type a suburb, address or landmark, then press Go (or Enter). The map flies to the one you pick.'}
        />
        <button type="submit" disabled={drawing || busy || !q.trim()} title="Search for this place">{busy ? '…' : 'Go'}</button>
        {results.length > 0 && (
          <ul className="results" role="listbox">
            {results.map((r, i) => <li key={i}><button type="button" title="Fly the map to this place" onClick={() => go(r)}>{r.label}</button></li>)}
          </ul>
        )}
      </form>
      <button type="button" onClick={locate} aria-label="Centre on my location" title="Centre the map on where you are (your browser asks permission the first time)" data-tour="rt-locate">◎</button>
      <div className="group" data-tour="rt-view">
        <select aria-label="Map style" value={styleId} onChange={(e) => setStyle(e.target.value as typeof styleId)} title="Map style: Streets for roads and addresses, Outdoor for trails and contours, Satellite for the aerial photo">
          {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select aria-label="Units" value={units} onChange={(e) => setUnits(e.target.value as 'km' | 'mi')} title="Show distances in kilometres or miles. Markers follow: every 1 km or every 1 mi. Remembered on this device.">
          <option value="km">km</option>
          <option value="mi">mi</option>
        </select>
        <button type="button" onClick={() => setMarkersOn(!markersOn)} aria-pressed={markersOn} title={`Show or hide the numbered distance markers along the line (every 1 ${units}; zoomed out they thin to every 5th, 10th and so on)`}>Markers</button>
      </div>
      {idle && <button type="button" onClick={() => fileInput.current?.click()} title="Open a GPX file from Strava, Garmin or a friend, see it on the map and save it as a track" data-tour="rt-import">Import GPX</button>}
      <input ref={fileInput} type="file" accept=".gpx,.xml,application/gpx+xml,text/xml" hidden aria-label="GPX file" title="Choose a GPX file to import" onChange={(e) => void importGpx(e)} />
      {idle && <button type="button" onClick={() => setPanel(panel === 'closed' ? 'tracks' : 'closed')} aria-pressed={panel !== 'closed'} title="Your saved tracks: search, open, select and delete" data-tour="rt-tracks">Tracks</button>}
      {idle && <button type="button" className="primary" onClick={() => startDrawing()} title="Start tracing a new route on the map" data-tour="rt-draw">Draw</button>}
      {idle && <button type="button" onClick={() => { setPanel('closed'); usePlan.getState().start(); }} disabled={!routePlanning} title={routePlanning ? 'Plan a route: tap a start and an end and get up to three routes along real roads and paths, for walking, hiking, cycling or driving' : 'Route planning is not set up on this server yet (it needs an OpenRouteService key, ORS_API_KEY)'} data-tour="rt-plan">Plan route</button>}
      <div className="group" data-tour="rt-help">
        <button type="button" onClick={() => setInfoOpen(true)} aria-label="How this works" title="How Route Tracer works: a plain guide to every feature">ⓘ</button>
        <button type="button" onClick={() => startTour()} aria-label="Take the guided tour" title="Take the guided tour (about two minutes)">Tour</button>
      </div>
    </header>
  );
}

function DrawToolbar({ onFinish }: { onFinish: () => void }) {
  const { draw, mode, setMode, apply, units, stopDrawing, selectedVertex, setSelectedVertex, deleteSelectedVertex, extendingId, setPanel, closeLoop, outAndBack, elevationOpen, setElevationOpen, drawColor, imported } = useStore();
  const lines = useMemo(() => displayLines(draw), [draw]);
  const km = useMemo(() => totalKm(lines), [lines]);
  const [confirmClear, setConfirmClear] = useState(false);
  const work = hasWork(draw);

  function cancel() {
    if (work && !window.confirm('Discard this drawing?')) return;
    clearDraft();
    stopDrawing();
    if (extendingId) setPanel('detail'); // back to the track that was being edited
  }
  return (
    <section className="drawbar" aria-label="Drawing tools">
      <div className="readout" aria-live="polite" data-testid="distance" title="Total distance of the route so far">{formatDistance(km, units)}</div>
      <div className="seg three" role="group" aria-label="Draw mode" data-tour="rt-modes">
        <button type="button" aria-pressed={mode === 'freehand'} onClick={() => setMode('freehand')} title="Freehand: press and drag to draw a line that follows your finger or mouse. Two fingers, or Space + drag, move the map.">Freehand</button>
        <button type="button" aria-pressed={mode === 'click'} onClick={() => setMode('click')} title="Click: each click or tap adds a point joined by a straight line. Best for following roads precisely. Drag a point to move it. Double-click to finish.">Click</button>
        <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')} disabled={!work} title="Edit points: drag a point to move it, drag a small dot to add a point, tap a point to pick it for deleting">Edit points</button>
      </div>
      {mode === 'edit' && (
        <button type="button" className="danger" onClick={deleteSelectedVertex} disabled={!selectedVertex} title="Delete the point you tapped (or press Delete). A stroke always keeps at least two points.">Delete selected point</button>
      )}
      <div className="row" role="group" aria-label="Route shape" data-tour="rt-shape">
        <button type="button" onClick={closeLoop} disabled={!work} title="Add a straight line from the end of the route back to its start, making a loop">Return to start</button>
        <button type="button" onClick={outAndBack} disabled={!work} title="Retrace the route in reverse so you finish where you began. The distance doubles.">Out and back</button>
        <button type="button" onClick={() => setElevationOpen(!elevationOpen)} aria-pressed={elevationOpen} disabled={!work} title="Show the elevation profile and total climb for this route, from terrain data" data-tour="rt-elev">Elevation</button>
      </div>
      {elevationOpen && work && <ElevationChart lines={lines} color={drawColor} name={imported?.name ?? 'Drawing'} />}
      <div className="row" data-tour="rt-actions">
        <button type="button" onClick={() => { setSelectedVertex(null); apply(undo); }} disabled={!draw.history.length && !draw.active} title="Undo the last stroke, point, move or route shape (one step at a time)">Undo</button>
        {confirmClear ? (
          <>
            <span>Clear all?</span>
            <button type="button" onClick={() => { apply((s) => ({ ...s, lines: [], history: [], active: null })); setConfirmClear(false); }} title="Yes, remove everything drawn">Yes</button>
            <button type="button" onClick={() => setConfirmClear(false)} title="No, keep the drawing">No</button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmClear(true)} disabled={!work} title="Remove everything you have drawn (asks first)">Clear</button>
        )}
        <button type="button" className="primary" onClick={onFinish} disabled={!work} title="Finish drawing and save it as a named track">Finish</button>
        <button type="button" onClick={cancel} title="Stop drawing and discard it (asks first)">Cancel</button>
      </div>
      <p className="hint">{mode === 'freehand' ? 'Drag to draw. Two fingers (or Space + drag) to move the map.' : mode === 'click' ? 'Click to add points. Drag a point to move it. Double-click to finish.' : 'Drag a point to move it. Drag a small dot to add a point. Tap a point, then Delete selected point.'}</p>
    </section>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}
