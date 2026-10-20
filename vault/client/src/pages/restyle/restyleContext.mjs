// What the CSS page can do right now, and when it cannot, why in plain words. One place decides, so the menu, the buttons above the
// preview and the buttons inside the panels always agree. A button that cannot be used yet is dimmed and its tooltip says what to do
// first (components/ContextButton.jsx); it is never just silently dead. Test: node client/src/pages/restyle/restyleContext.test.mjs

const BUILD = 'Build the preview first: load a page, then press Build the preview.';
const CLICK = 'Click something in the preview first.';

/**
 * @param {{pageLoaded:boolean, previewBuilt:boolean, hasSelection:boolean, changeCount:number, canUndo:boolean, canRedo:boolean,
 *   saved:boolean, hasCss:boolean}} s
 * @returns {{[key:string]: string}} a reason for each thing that cannot be done now; a thing that can be done has no key
 */
export function contextReasons(s) {
  const r = {};
  if (!s.previewBuilt) {
    r.build = BUILD;
    r.preview = BUILD;
    r.selection = BUILD;
  } else if (!s.hasSelection) {
    r.selection = CLICK;
  }
  if (!s.pageLoaded) r.page = 'Load a page first (Your page).';
  if (!s.changeCount) {
    r.edits = 'No changes yet. Make a change first.';
    r.report = 'No changes yet, so there is nothing to report.';
  }
  if (!s.hasCss) r.css = 'No changes yet, so there is no CSS to take away. Make a change first.';
  if (!s.canUndo) r.undo = 'Nothing to undo yet. Make a change first.';
  if (!s.canRedo) r.redo = 'Nothing to put back: you have not undone anything.';
  if (!s.saved) r.saved = 'Save the page first (My saved pages).';
  return r;
}

/** A menu item's `needs` -> the reason it cannot be opened usefully yet, or undefined. */
export function toolReason(tool, reasons) {
  if (!tool || !tool.needs) return undefined;
  return reasons[tool.needs];
}
