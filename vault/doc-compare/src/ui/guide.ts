// What Vault's guide chat can point at inside DocCompare, and how each "Open" button works.
//
// The guide chat lives in Vault's page around this app (client/src/pages/DocComparePage.jsx, the shared TutorChat). It cannot touch this app's
// screen, so it sends a message and the app does the opening here. The ids are GUIDE_TOOLS in client/src/pages/docCompare/docCompareTools.mjs,
// which the server's CATALOG must match (node server/services/docCompareTutor.test.js). Messages, same origin only, none when not embedded:
//   Vault -> app   { type: OPEN_TYPE, id }              show that part (switching to its tool first)
//   Vault -> app   { type: VIEW_TYPE, view, filter? }   switch tool (the tool list or a job step)
//   app -> Vault   { type: CONTEXT_TYPE, tool, view, results, pdf, cause }
// An Open button only ever SHOWS something (a tool, a part of it, the page viewer). It never picks files or compares.
import { DOC_COMPARE_TOOLS, GUIDE_TOOLS } from '@vault-client/pages/docCompare/docCompareTools.mjs';
import type { ViewId } from './Results';

export const VIEWS = DOC_COMPARE_TOOLS.map((t) => t.id) as ViewId[];
export const isView = (v: unknown): v is ViewId => typeof v === 'string' && (VIEWS as string[]).includes(v);

export interface GuideHooks {
  openInfo(): void;
  setView(view: ViewId): void;
  /** Runs after the new view has rendered. */
  later(fn: () => void): void;
  /** False when there is nothing to view (no compared PDFs, or the page check is not finished). */
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
  const target = GUIDE_TOOLS.find((t) => t.id === id);
  if (!target || !isView(target.tool)) return false;
  if (id === 'info') { h.openInfo(); return true; }
  h.setView(target.tool);
  h.later(() => {
    switch (id) {
      case 'files':
      case 'check-label':
      case 'word-limit':
      case 'required-headings':
      case 'compare-button': h.show(id); break;
      case 'word-counts':
        if (!h.hasResults()) h.toast(RESULTS_FIRST); else h.show(id);
        break;
      case 'author-report':
        if (!h.hasResults()) h.toast(RESULTS_FIRST); else h.show(id);
        break;
      case 'file-check':
        if (!h.show(id)) { h.show('compare-button'); h.toast('The file type check runs when you press Compare. A red box appears here only when the two files cannot be compared.'); }
        break;
      case 'same-document':
        if (!h.show(id)) { h.show(h.hasResults() ? 'summary' : 'compare-button'); h.toast(h.hasResults() ? 'These files passed the same-document check; its score is shown under the summary.' : 'The same-document check runs when you press Compare. An amber box appears here only when the files look unrelated.'); }
        break;
      case 'summary':
      case 'filters':
        if (!h.hasResults()) h.toast(RESULTS_FIRST); else h.show(id);
        break;
      case 'trivial':
        if (!h.hasResults()) h.toast(RESULTS_FIRST);
        else if (!h.show(id)) { h.show('summary'); h.toast('This comparison has no trivial changes.'); }
        break;
      case 'save-project':
        if (!h.show(id)) { h.show('files'); h.toast('Choose the original file first: "Save this as your original?" appears under the two file boxes. (Inside an open project you add the latest version instead.)'); }
        break;
      case 'versions-mode':
        if (!h.show(id)) h.toast('Close the open project first (Close project in Compare documents): intentionally different versions are a one-off comparison, not a project round.');
        break;
      case 'add-round':
      case 'new-original':
      case 'compact':
      case 'round-summary':
        if (!h.show(id)) h.toast('Open a project first (in Projects), or start one in Compare documents with "Save this as your original?" ticked.');
        break;
      case 'resolved':
        if (!h.show(id)) h.toast('Resolved lists the items fixed or accepted in a project round. It appears once a project round has some.');
        break;
      case 'page-viewer':
        if (!h.hasResults()) h.toast(RESULTS_FIRST);
        else if (!h.isPdf()) h.toast('The page viewer is for two PDF files only.');
        else if (!h.openViewer()) h.toast('The page viewer opens once the page check has finished.');
        break;
      default: break; // a tool id: switching to it is the whole job (an empty tool explains itself)
    }
  });
  return true;
}

/** The part the person is on right now, for the guide's "you are in ...". */
export function currentGuideTool(s: { info: boolean; viewer: boolean; gate2: boolean; error: boolean; view: ViewId }): string {
  if (s.info) return 'info';
  if (s.viewer) return 'page-viewer';
  if (s.view === 'compare' && s.gate2) return 'same-document';
  if (s.view === 'compare' && s.error) return 'file-check';
  return s.view;
}
