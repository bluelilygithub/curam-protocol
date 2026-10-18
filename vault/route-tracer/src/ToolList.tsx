import type maplibregl from 'maplibre-gl';
import { CircleHelp, FileUp, Landmark, MapPinned, PencilLine, Route as RouteIcon, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { startTour } from './help/tour';
import { importGpxFile } from './Shell';
import { usePlaces } from './Places';
import { usePlan } from './Plan';
import { useStore } from './store';

// The left-hand list of things to do, laid out like Video Tools, Finance and Graphics: an icon and the name at the top, then groups you open and
// close (a small coloured heading with an arrow), each with a few items in plain words, and a hover tip on every one saying what it does.

const OPEN_KEY = 'route-tracer:groups:v1';
const readOpen = (): string[] => { try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? 'null') as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : ['make']; } catch { return ['make']; } };

export function ToolList({ map }: { map: maplibregl.Map | null }) {
  const { startDrawing, routePlanning, setInfoOpen, drawing } = useStore();
  const planning = usePlan((s) => s.active);
  const [open, setOpen] = useState<string[]>(readOpen);
  const file = useRef<HTMLInputElement>(null);
  const idle = !drawing && !planning;
  const toggle = (id: string): void => {
    const next = open.includes(id) ? open.filter((x) => x !== id) : [...open, id];
    setOpen(next);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* not remembered */ }
  };
  const planTip = routePlanning ? 'Directions along real roads and paths: set a start and an end and get up to three routes, or a loop of a length you choose, for walking, hiking, cycling or driving.' : 'Route planning is not set up on this server yet (it needs an OpenRouteService key, ORS_API_KEY).';
  type Item = { id: string; label: string; icon: typeof PencilLine; tip: string; go: () => void; disabled?: boolean; tour?: string };
  const groups: Array<{ id: string; label: string; tip: string; items: Item[] }> = [
    { id: 'make', label: 'Make a route', tip: 'Start a new route: trace it yourself, or let the map plan one for you.', items: [
      { id: 'draw', label: 'Draw a route', icon: PencilLine, tip: 'Trace a route yourself with a finger or mouse, or click point by point (optionally following real roads). The distance shows live, and you can edit points, undo and save it.', go: () => startDrawing(), tour: 'rt-draw' },
      { id: 'plan', label: 'Plan a route', icon: MapPinned, tip: planTip, go: () => usePlan.getState().start(), disabled: !routePlanning, tour: 'rt-plan' },
    ] },
    { id: 'bring', label: 'Bring in and explore', tip: 'Use a file you already have, or look around your route.', items: [
      { id: 'import', label: 'Import a GPX file', icon: FileUp, tip: idle ? 'Open a GPX file from Strava, Garmin or a friend. You can see it on the map, measure it, fix it and save it as a track. Nothing is uploaded until you save.' : 'Finish or cancel what you are doing first, then import a file.', go: () => file.current?.click(), disabled: !idle },
      { id: 'places', label: 'Places near the route', icon: Landmark, tip: 'Find notable buildings, landmarks and venues within a distance you choose of the route on screen. Opens the landmark panel on the map.', go: () => usePlaces.getState().setOpen(true) },
    ] },
    { id: 'help', label: 'Help', tip: 'Learn how Route Tracer works.', items: [
      { id: 'info', label: 'How Route Tracer works', icon: CircleHelp, tip: 'A plain guide to every feature.', go: () => setInfoOpen(true) },
      { id: 'tour', label: 'Take the tour', icon: Sparkles, tip: 'A short guided tour of the screen, about two minutes. Not sure what to do? Use the round guide button at the bottom right and ask in your own words.', go: () => startTour() },
    ] },
  ];
  return (
    <nav className="toollist" aria-label="Route Tracer tools" data-tour="rt-tools">
      <div className="toollist-title">
        <span className="toollist-tile" aria-hidden="true"><RouteIcon size={16} /></span>
        <h1>Route Tracer</h1>
        <button type="button" className="toollist-info" onClick={() => setInfoOpen(true)} aria-label="How Route Tracer works" title="How Route Tracer works: a plain guide to every feature"><CircleHelp size={13} aria-hidden="true" /></button>
      </div>
      {groups.map((g) => (
        <div key={g.id} className="toolgroup">
          <button type="button" className="toolgroup-head" aria-expanded={open.includes(g.id)} onClick={() => toggle(g.id)} title={g.tip}>{open.includes(g.id) ? '▼' : '▶'} {g.label}</button>
          {open.includes(g.id) && (
            <ul className="toolgroup-items">
              {g.items.map((t) => (
                <li key={t.id}>
                  <button type="button" className="toolitem" disabled={t.disabled} onClick={t.go} title={t.tip} {...(t.tour ? { 'data-tour': t.tour } : {})}>
                    <t.icon size={14} aria-hidden="true" /> {t.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <input ref={file} type="file" accept=".gpx,.xml,application/gpx+xml,text/xml" hidden aria-label="Import a GPX file" title="Choose a GPX file to import" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void importGpxFile(f, map); }} />
    </nav>
  );
}
