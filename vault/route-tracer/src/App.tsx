import type maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, type GeocodeResult, type Track } from './api';
import { displayLines, finish, hasWork, undo } from './drawing';
import { formatDistance, totalKm, type BBox } from './geo';
import MapView from './MapView';
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
    api.config()
      .then((c) => setBoot(c.maptilerKey ? { state: 'ready', key: c.maptilerKey } : DEV_KEY ? { state: 'ready', key: DEV_KEY } : { state: 'error', message: 'The map key is not set up on the server (ROUTE_TRACER_MAPTILER_KEY).' }))
      .catch((e: unknown) => {
        if (DEV_KEY && !(e instanceof ApiError && e.status === 403)) return setBoot({ state: 'ready', key: DEV_KEY });
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
  const onFinish = useCallback(() => {
    const { draw, toast, setSaving } = useStore.getState();
    if (!finish(draw).length) return toast('error', 'Draw at least two points first.');
    setSaving(true);
  }, []);
  useDrawing(map, onFinish);
  useSavedLayer(map);
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

  return (
    <>
      <TopBar map={map} />
      {drawing && !saving && <DrawToolbar onFinish={onFinish} />}
      {!drawing && <TracksPanel map={map} />}
      {saving && <SaveDialog onSaved={onSaved} />}
      <RecoveryBanner />
      <Toasts />
    </>
  );
}

function TopBar({ map }: { map: maplibregl.Map | null }) {
  const { drawing, styleId, setStyle, units, setUnits, startDrawing, panel, setPanel } = useStore();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);

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
      <form className="search" onSubmit={search} role="search">
        <input aria-label="Search a place" placeholder="Search a place or address" value={q} disabled={drawing} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" disabled={drawing || busy || !q.trim()}>{busy ? '…' : 'Go'}</button>
        {results.length > 0 && (
          <ul className="results" role="listbox">
            {results.map((r, i) => <li key={i}><button type="button" onClick={() => go(r)}>{r.label}</button></li>)}
          </ul>
        )}
      </form>
      <button type="button" onClick={locate} aria-label="Centre on my location" title="My location">◎</button>
      <select aria-label="Map style" value={styleId} onChange={(e) => setStyle(e.target.value as typeof styleId)}>
        {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <select aria-label="Units" value={units} onChange={(e) => setUnits(e.target.value as 'km' | 'mi')}>
        <option value="km">km</option>
        <option value="mi">mi</option>
      </select>
      {!drawing && <button type="button" onClick={() => setPanel(panel === 'closed' ? 'tracks' : 'closed')} aria-pressed={panel !== 'closed'}>Tracks</button>}
      {!drawing && <button type="button" className="primary" onClick={() => startDrawing()}>Draw</button>}
    </header>
  );
}

function DrawToolbar({ onFinish }: { onFinish: () => void }) {
  const { draw, mode, setMode, apply, units, stopDrawing, selectedVertex, setSelectedVertex, deleteSelectedVertex, extendingId, setPanel } = useStore();
  const km = useMemo(() => totalKm(displayLines(draw)), [draw]);
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
      <div className="readout" aria-live="polite" data-testid="distance">{formatDistance(km, units)}</div>
      <div className="seg three" role="group" aria-label="Draw mode">
        <button type="button" aria-pressed={mode === 'freehand'} onClick={() => setMode('freehand')}>Freehand</button>
        <button type="button" aria-pressed={mode === 'click'} onClick={() => setMode('click')}>Click</button>
        <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')} disabled={!work}>Edit points</button>
      </div>
      {mode === 'edit' && (
        <button type="button" className="danger" onClick={deleteSelectedVertex} disabled={!selectedVertex}>Delete selected point</button>
      )}
      <div className="row">
        <button type="button" onClick={() => { setSelectedVertex(null); apply(undo); }} disabled={!draw.history.length && !draw.active}>Undo</button>
        {confirmClear ? (
          <>
            <span>Clear all?</span>
            <button type="button" onClick={() => { apply((s) => ({ ...s, lines: [], history: [], active: null })); setConfirmClear(false); }}>Yes</button>
            <button type="button" onClick={() => setConfirmClear(false)}>No</button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmClear(true)} disabled={!work}>Clear</button>
        )}
        <button type="button" className="primary" onClick={onFinish} disabled={!work}>Finish</button>
        <button type="button" onClick={cancel}>Cancel</button>
      </div>
      <p className="hint">{mode === 'freehand' ? 'Drag to draw. Two fingers (or Space + drag) to move the map.' : mode === 'click' ? 'Click to add points. Double-click to finish.' : 'Drag a point to move it. Drag a small dot to add a point. Tap a point, then Delete selected point.'}</p>
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
