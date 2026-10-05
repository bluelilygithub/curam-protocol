import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createApp } from './createApp';
import { AppContext, useApp, useProject, useUi } from './ui/AppContext';
import { EmptyState } from './ui/EmptyState';
import { Hud } from './ui/Hud';
import { Inspector } from './ui/Inspector';
import { LibraryBanner } from './ui/LibraryBanner';
import { ProjectsPanel } from './ui/ProjectsPanel';
import { SchedulePanel } from './ui/SchedulePanel';
import { RecentreChip } from './ui/RecentreChip';
import { RoomBar } from './ui/RoomBar';
import { LibraryPanel } from './ui/LibraryPanel';
import { Stage2D } from './ui/Stage2D';
import { StatusBar } from './ui/StatusBar';
import { Toolbar } from './ui/Toolbar';
import { InfoModal } from './help/InfoModal';
import { INFO_SEEN_KEY, TOUR_KEY, safeGet, safeRemove } from './help/helpKeys';
import { TooltipHost } from './help/TooltipHost';

const Viewport3D = lazy(() => import('./render3d/Viewport3D'));
const PhotoPanel = lazy(() => import('./render3d/PhotoPanel'));

function Shell() {
  const app = useApp();
  // First visit: show How This Works once. Vault's Settings page opens the planner with ?tour=1 to retake the tour instead.
  useEffect(() => {
    const wantsTour = new URLSearchParams(window.location.search).has('tour');
    if (wantsTour) {
      safeRemove(TOUR_KEY);
      const t = window.setTimeout(() => void app.startTour(), 600);
      return () => window.clearTimeout(t);
    }
    if (!safeGet(INFO_SEEN_KEY)) app.ui.getState().setInfoOpen(true);
    return undefined;
  }, [app]);
  const hasRoom = useProject((s) => !!s.project?.rooms.length);
  const viewMode = useUi((s) => s.viewMode);
  const immersive = useUi((s) => s.immersive);
  // The 3D chunk (three.js) loads the first time 3D is asked for, then stays mounted so its camera and GPU state persist.
  const [load3d, setLoad3d] = useState(false);
  useEffect(() => { if (viewMode === '3d') setLoad3d(true); }, [viewMode]);
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const photoOpen = useUi((s) => s.photoOpen);
  return (
    <div className={`app ${leftOpen ? 'left-open' : ''} ${rightOpen ? 'right-open' : ''} ${immersive ? 'immersive' : ''}`}>
      <Toolbar />
      {leftOpen && <LibraryPanel />}
      <main className="viewport" data-tour="rp-stage">
        <div className={`stage-slot ${viewMode === '2d' ? '' : 'inactive'}`}><Stage2D /></div>
        {load3d && (
          <Suspense fallback={<div className="loading3d">Loading 3D view…</div>}>
            <Viewport3D />
          </Suspense>
        )}
        {hasRoom ? (viewMode === '2d' ? <Hud /> : null) : <EmptyState />}
        <RoomBar />
        <RecentreChip />
        <LibraryBanner />
      </main>
      {rightOpen && <Inspector />}
      <StatusBar />
      <ProjectsPanel />
      <SchedulePanel />
      <InfoModal />
      <TooltipHost />
      {photoOpen && <Suspense fallback={null}><PhotoPanel /></Suspense>}
    </div>
  );
}

export default function App() {
  const app = useMemo(() => createApp(window.localStorage), []);
  useEffect(() => app.start(), [app]); // autosave on; the returned cleanup flushes and stops it
  // exposed for hands-on debugging and the browser walkthrough; harmless in production
  useEffect(() => { (window as unknown as { roomPlanner?: unknown }).roomPlanner = app; }, [app]);
  return (
    <AppContext.Provider value={app}>
      <Shell />
    </AppContext.Provider>
  );
}
