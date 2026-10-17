// What Vault's guide chat can point at inside the staff planner, and how each "Open" button works.
//
// The guide chat lives in Vault's page around the planner (client/src/pages/CellarPlannerPage.jsx, the shared TutorChat). It cannot touch the
// planner's screen, so it sends the planner a message and the planner does the opening here. The ids are the guide's tool ids: the server's
// CATALOG (server/services/cellarTutor.js) lists exactly these, and a test keeps the two in step.
//
// Messages (same origin only; nothing is sent when the planner is not embedded):
//   Vault -> planner   { type: 'cellar-planner:open', id }          open that tool
//   planner -> Vault   { type: 'cellar-planner:context', tool }     the tool the person is looking at now (so the guide can say "you are in ...")

import type { UiState, UiStore } from './uiStore';

export type GuideToolKind = 'section' | 'tab' | 'dialog' | 'action';
export interface GuideTool { id: string; label: string; kind: GuideToolKind; /** section: the panel title; tab: the drawing tab; dialog: the ui flag */ target?: string }

export const GUIDE_TOOLS: GuideTool[] = [
  { id: 'enclosure', label: 'Enclosure', kind: 'section', target: 'Enclosure' },
  { id: 'walls', label: 'Walls', kind: 'section', target: 'Walls' },
  { id: 'door', label: 'Door', kind: 'section', target: 'Door' },
  { id: 'header', label: 'Header: conditioner and vents', kind: 'section', target: 'Header: conditioner and vents' },
  { id: 'rack', label: 'Rack specification', kind: 'section', target: 'Rack specification' },
  { id: 'runs', label: 'Rack runs', kind: 'section', target: 'Rack runs' },
  { id: 'features', label: 'Features', kind: 'section', target: 'Features' },
  { id: 'price', label: 'Price', kind: 'section', target: 'Price' },
  { id: 'cooling', label: 'Cooling', kind: 'section', target: 'Cooling' },
  { id: 'plan', label: 'Plan', kind: 'tab', target: 'plan' },
  { id: 'elevation', label: 'Elevation', kind: 'tab', target: 'elevation' },
  { id: 'racks', label: 'Racks', kind: 'tab', target: 'racks' },
  { id: 'inside', label: '3D', kind: 'tab', target: 'inside' },
  { id: 'checks', label: 'Checks', kind: 'section' },
  { id: 'designs', label: 'Jobs', kind: 'dialog', target: 'designsOpen' },
  { id: 'leads', label: 'Enquiries', kind: 'dialog', target: 'leadsOpen' },
  { id: 'package', label: 'Drawing package', kind: 'dialog', target: 'packageOpen' },
  { id: 'quote', label: 'Quote', kind: 'dialog', target: 'quoteOpen' },
  { id: 'code', label: 'From design code', kind: 'dialog', target: 'codeOpen' },
  { id: 'calc', label: 'How the numbers are calculated', kind: 'dialog', target: 'calcOpen' },
  { id: 'info', label: 'How this works', kind: 'dialog', target: 'infoOpen' },
  { id: 'tour', label: 'Guided tour', kind: 'action' },
];

export const OPEN_TYPE = 'cellar-planner:open';
export const CONTEXT_TYPE = 'cellar-planner:context';
const DIALOG_FLAGS = ['designsOpen', 'leadsOpen', 'packageOpen', 'quoteOpen', 'codeOpen', 'calcOpen', 'infoOpen'] as const;
type DialogFlag = typeof DIALOG_FLAGS[number];

export interface GuideHooks {
  /** Make sure the controls panel (left) / the bottles and checks panel (right) can be seen. */
  showLeft(): void;
  showRight(): void;
  startTour(): void;
}

/** Open a tool by its guide id. Returns false for an id this planner does not know (nothing happens). */
export function openGuideTool(ui: UiStore, id: string, hooks: GuideHooks): boolean {
  const tool = GUIDE_TOOLS.find((t) => t.id === id);
  if (!tool) return false;
  const s = ui.getState();
  if (tool.kind === 'section') {
    if (id === 'checks') { hooks.showRight(); s.set({ pane: 'checks' }); return true; }
    hooks.showLeft();
    s.set({ pane: 'controls', openSection: { title: tool.target!, nonce: (s.openSection?.nonce ?? 0) + 1 } });
    return true;
  }
  if (tool.kind === 'tab') { s.set({ tab: tool.target as UiState['tab'], pane: 'drawing' }); return true; }
  if (tool.kind === 'dialog') {
    const patch: Partial<Record<DialogFlag, boolean>> = {};
    DIALOG_FLAGS.forEach((f) => { patch[f] = f === tool.target; }); // one dialog at a time
    s.set(patch);
    return true;
  }
  hooks.startTour(); // 'tour'
  return true;
}

/** The tool the person is in right now: an open dialog, else the controls section they last opened, else the drawing tab. */
export function currentGuideTool(s: Pick<UiState, DialogFlag | 'tab' | 'activeSection' | 'pane'>): string {
  const dialog = GUIDE_TOOLS.find((t) => t.kind === 'dialog' && s[t.target as DialogFlag]);
  if (dialog) return dialog.id;
  if (s.pane === 'checks') return 'checks';
  if (s.pane === 'controls' && s.activeSection) return GUIDE_TOOLS.find((t) => t.kind === 'section' && t.target === s.activeSection)?.id ?? s.tab;
  return s.tab;
}
