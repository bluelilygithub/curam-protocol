import { useEffect, useMemo } from 'react';
import { TooltipHost } from '@planner-core/help/TooltipHost';
import { createApp } from './createApp';
import { AppContext } from './ui/AppContext';
import { GrowthBar } from './ui/GrowthBar';
import { InfoModal } from './ui/InfoModal';
import { CreditsModal } from './ui/CreditsModal';
import { Inspector } from './ui/Inspector';
import { PlantLibrary } from './ui/PlantLibrary';
import { ProjectsPanel } from './ui/ProjectsPanel';
import { Stage } from './ui/Stage';
import { StatusBar } from './ui/StatusBar';
import { Toolbar } from './ui/Toolbar';
import { Wizard } from './ui/Wizard';

export default function App() {
  const app = useMemo(() => createApp(window.localStorage), []);
  useEffect(() => {
    // test harness handle (same idea as Room Planner). Set here, not in useMemo: StrictMode builds the memo twice and keeps one.
    (window as unknown as { gardenPlanner?: unknown }).gardenPlanner = app;
    const stop = app.start();
    // first visit: show the guide once (never over the new-garden wizard)
    void app.whenReady().then(() => {
      try {
        if (!localStorage.getItem('garden-planner:info-seen:v1') && !app.ui.getState().wizardOpen) app.ui.getState().set({ infoOpen: true });
      } catch { /* storage blocked: skip the auto-open */ }
    });
    // Vault's Settings page opens the planner with ?tour=1 to retake the tour
    if (new URLSearchParams(window.location.search).has('tour')) window.setTimeout(() => void app.startTour(), 400);
    return stop;
  }, [app]);
  // phones and tablets start with the side panels closed so the plan has room
  useEffect(() => {
    if (window.matchMedia('(max-width: 900px)').matches) app.ui.getState().set({ libraryOpen: false, inspectorOpen: false });
  }, [app]);

  return (
    <AppContext.Provider value={app}>
      <div className="app">
        <Toolbar />
        <PlantLibrary />
        <Stage />
        <Inspector />
        <GrowthBar />
        <StatusBar />
      </div>
      <Wizard />
      <ProjectsPanel />
      <InfoModal />
      <CreditsModal />
      <TooltipHost />
    </AppContext.Provider>
  );
}
