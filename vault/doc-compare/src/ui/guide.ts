// What Vault's guide chat can point at inside DocCompare, and how each "Open" button works.
//
// The guide chat lives in Vault's page around this app (client/src/pages/DocComparePage.jsx, the shared TutorChat). It cannot touch this app's
// screen, so it sends a message and the app does the opening here. The ids are GUIDE_TOOLS in client/src/pages/docCompare/docCompareTools.mjs,
// which the server's CATALOG must match (node server/services/docCompareTutor.test.js). Messages, same origin only, none when not embedded:
//   Vault -> app   { type: OPEN_TYPE, id }        show that part
//   app -> Vault   { type: CONTEXT_TYPE, tool }   the part the person is on now
// An Open button only ever SHOWS something (scrolls to it, opens Settings, the (i) box or the page viewer). It never picks files or compares.
import { GUIDE_TOOLS } from '@vault-client/pages/docCompare/docCompareTools.mjs';

export interface GuideHooks {
  openInfo(): void;
  openSettings(): void;
  /** False when there is nothing to view (no compared PDFs). */
  openViewer(): boolean;
  /** Scrolls to and highlights the element with data-guide="<id>"; false when it is not on screen. */
  show(id: string): boolean;
  toast(text: string): void;
  hasResults(): boolean;
  isPdf(): boolean;
}

const RESULTS_FIRST = 'Choose both files and press Compare first: this part appears with the results.';

/** Open a part by its guide id. Returns false for an id this app does not know (nothing happens). */
export function openGuideTool(id: string, h: GuideHooks): boolean {
  if (!GUIDE_TOOLS.some((t) => t.id === id)) return false;
  switch (id) {
    case 'info': h.openInfo(); break;
    case 'settings': h.openSettings(); break;
    case 'doc-compare': h.show('files'); break;
    case 'files':
    case 'compare': h.show(id); break;
    case 'file-check':
      if (!h.show(id)) { h.show('compare'); h.toast('The file type check runs when you press Compare. A red box appears here only when the two files cannot be compared.'); }
      break;
    case 'same-document':
      if (!h.show(id)) { h.show(h.hasResults() ? 'summary' : 'compare'); h.toast(h.hasResults() ? 'These files passed the same-document check; its score is shown under the summary.' : 'The same-document check runs when you press Compare. An amber box appears here only when the files look unrelated.'); }
      break;
    case 'layout':
    case 'page-viewer':
      if (!h.hasResults()) h.toast(RESULTS_FIRST);
      else if (!h.isPdf()) h.toast('The page layout check and the page viewer are for two PDF files only.');
      else if (id === 'layout') h.show(id);
      else if (!h.openViewer()) { h.show('layout'); h.toast('The page viewer opens once the page layout check has finished.'); }
      break;
    case 'trivial':
      if (!h.hasResults()) h.toast(RESULTS_FIRST);
      else if (!h.show(id)) { h.show('summary'); h.toast('This comparison has no trivial changes.'); }
      break;
    default:
      if (!h.hasResults()) h.toast(RESULTS_FIRST);
      else h.show(id);
  }
  return true;
}

/** The part the person is on right now, for the guide's "you are in ...". */
export function currentGuideTool(s: { info: boolean; settings: boolean; viewer: boolean; gate2: boolean; error: boolean; results: boolean }): string {
  if (s.info) return 'info';
  if (s.settings) return 'settings';
  if (s.viewer) return 'page-viewer';
  if (s.gate2) return 'same-document';
  if (s.error) return 'file-check';
  return s.results ? 'changes' : 'files';
}
