import type maplibregl from 'maplibre-gl';
import { TooltipHost } from '@planner-core/help/TooltipHost';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Track } from './api';
import { DrawPanel } from './DrawPanel';
import { finish, hasWork } from './drawing';
import type { BBox } from './geo';
import { INFO_KEY, startTour } from './help/tour';
import { InfoModal } from './InfoModal';
import MapView from './MapView';
import { useDistanceMarkers } from './Markers';
import { clearDraft, fitTo, RecoveryBanner, SaveDialog, TracksPanel, useAutosave, useSavedLayer } from './Panels';
import { PlanPanel, usePlan, usePlanning } from './Plan';
import { ProbeReadout, useDistanceProbe } from './Probe';
import { Header, MapControls } from './Shell';
import { useStore } from './store';
import { useDrawing } from './useDrawing';
import { useSnapRouting } from './snapRouting';

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
  return <Shell mapKey={boot.key} map={map} onMap={onMap} />;
}

/** The whole screen: a header, a sidebar that shows whatever you are doing (your tracks, planning, drawing), and the map with its buttons. */
function Shell({ mapKey, map, onMap }: { mapKey: string; map: maplibregl.Map | null; onMap: (m: maplibregl.Map) => void }) {
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
  useSnapRouting();
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
    <div className="shell">
      <Header map={map} />
      <div className="body">
        <div className="sidebar" data-testid="sidebar">
          {planning ? <PlanPanel map={map} /> : drawing ? <DrawPanel onFinish={onFinish} /> : <TracksPanel map={map} />}
        </div>
        <div className="mapwrap">
          <MapView mapKey={mapKey} onMap={onMap} />
          <MapControls map={map} />
          <RecoveryBanner />
          <ProbeReadout />
          <Toasts />
        </div>
      </div>
      {saving && <SaveDialog onSaved={onSaved} />}
      <InfoModal />
      <TooltipHost />
    </div>
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
