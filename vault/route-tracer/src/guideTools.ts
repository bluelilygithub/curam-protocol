// What Vault's guide chat can point at inside Route Tracer, and how each "Open" button works.
//
// The guide chat lives in Vault's page around the app (client/src/pages/RouteTracerPage.jsx, the shared TutorChat). It cannot touch the app's screen, so
// it sends a message and the app does the opening here. The ids are the guide's tool ids: the server's CATALOG (server/services/routeTutor.js) lists
// exactly these, and a test keeps the two in step. Messages (same origin only; nothing is sent when the app is not embedded):
//   Vault -> app   { type: 'route-tracer:open', id }        open that screen
//   app -> Vault   { type: 'route-tracer:context', tool }   the screen the person is on now, so the guide can say "you are in ..."
//
// An Open button only ever SHOWS a screen. It never draws, saves or deletes, and it never throws away a drawing or a plan in progress: when one is
// open it says to finish or cancel it first.

export interface GuideTool { id: string; label: string }

export const GUIDE_TOOLS: GuideTool[] = [
  { id: 'search', label: 'Search or ask for a route' },
  { id: 'tracks', label: 'Your tracks' },
  { id: 'draw', label: 'Draw a route' },
  { id: 'plan', label: 'Plan a route' },
  { id: 'places', label: 'Places near the route' },
  { id: 'mappdf', label: 'Map as PDF' },
  { id: 'layers', label: 'Map buttons and style' },
  { id: 'settings', label: 'Settings' },
  { id: 'import', label: 'Import a GPX file' },
  { id: 'info', label: 'How Route Tracer works' },
  { id: 'tour', label: 'Guided tour' },
];

export const OPEN_TYPE = 'route-tracer:open';
export const CONTEXT_TYPE = 'route-tracer:context';

export type Busy = 'drawing' | 'planning' | null;
export interface GuideHooks {
  busy(): Busy;
  showTracks(): void;
  startDrawing(): void;
  /** False when route planning is not set up on the server. */
  startPlan(): boolean;
  openPlaces(): void;
  openInfo(): void;
  startTour(): void;
  menu(name: 'settings' | 'layers'): void;
  focusSearch(): void;
  toast(kind: 'ok' | 'error', text: string): void;
}

/** Open a tool by its guide id. Returns false for an id this app does not know (nothing happens). */
export function openGuideTool(id: string, h: GuideHooks): boolean {
  if (!GUIDE_TOOLS.some((t) => t.id === id)) return false;
  const busy = h.busy();
  const finishFirst = (what: string): void => h.toast('error', `Finish or cancel your ${busy === 'drawing' ? 'drawing' : 'route plan'} first, then ${what}.`);
  switch (id) {
    case 'search': h.focusSearch(); break;
    case 'info': h.openInfo(); break;
    case 'tour': h.startTour(); break;
    case 'layers': h.menu('layers'); break;
    case 'settings': h.menu('settings'); break;
    case 'import':
      h.menu('settings');
      h.toast('ok', busy ? 'Import GPX is available once you have finished or cancelled what you are doing.' : 'Choose Import GPX in this menu.');
      break;
    case 'places': h.openPlaces(); break;
    case 'tracks':
      if (busy) finishFirst('open your tracks'); else h.showTracks();
      break;
    case 'mappdf':
      if (busy) { finishFirst('open a saved track'); break; }
      h.showTracks();
      h.toast('ok', 'Open a saved track, then press Map as PDF.');
      break;
    case 'draw':
      if (busy === 'drawing') h.toast('ok', 'You are already drawing a route.');
      else if (busy === 'planning') finishFirst('start drawing');
      else h.startDrawing();
      break;
    case 'plan':
      if (busy === 'planning') h.toast('ok', 'You are already planning a route.');
      else if (busy === 'drawing') finishFirst('plan a route');
      else if (!h.startPlan()) h.toast('error', 'Route planning is not set up on this server yet.');
      break;
    default: return false;
  }
  return true;
}

/** The screen the person is on right now: the guide, the plan, the drawing, the places panel, else their tracks. */
export function currentGuideTool(s: { info: boolean; planning: boolean; drawing: boolean; places: boolean; panel: string }): string {
  if (s.info) return 'info';
  if (s.planning) return 'plan';
  if (s.drawing) return 'draw';
  if (s.places) return 'places';
  return s.panel === 'detail' ? 'mappdf' : 'tracks';
}
