import { useEffect, useMemo } from 'react';
import { createApp } from './createApp';
import { AppContext, useProject, useUi } from './ui/AppContext';
import { EmptyState } from './ui/EmptyState';
import { Hud } from './ui/Hud';
import { Inspector } from './ui/Inspector';
import { LibraryPanel } from './ui/LibraryPanel';
import { Stage2D } from './ui/Stage2D';
import { StatusBar } from './ui/StatusBar';
import { Toolbar } from './ui/Toolbar';

function Shell() {
  const hasRoom = useProject((s) => !!s.project?.rooms.length);
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  return (
    <div className={`app ${leftOpen ? 'left-open' : ''} ${rightOpen ? 'right-open' : ''}`}>
      <Toolbar />
      {leftOpen && <LibraryPanel />}
      <main className="viewport">
        <Stage2D />
        {hasRoom ? <Hud /> : <EmptyState />}
      </main>
      {rightOpen && <Inspector />}
      <StatusBar />
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
