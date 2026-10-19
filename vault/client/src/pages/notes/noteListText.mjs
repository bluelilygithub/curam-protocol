// What the Notes list shows for a note. A note you started by just typing (or dictating) has no title, so every one would be
// listed as "Untitled"; show its first line instead, and the rest of the text as the preview. Display only: nothing is saved
// or renamed. Unit-tested: node client/src/pages/notes/noteListText.test.mjs

const TITLE_MAX = 60;
const PREVIEW_MAX = 60;

const isUntitled = (title) => !String(title || '').trim() || String(title).trim().toLowerCase() === 'untitled';

/** { title, preview } for one row of the list. `preview` is '' when there is nothing more to show. */
export function listText(note) {
  const body = String(note?.body || '');
  const title = String(note?.title || '').trim();
  if (isUntitled(title)) {
    const first = body.split('\n').map((l) => l.trim()).find(Boolean);
    if (first) {
      const at = body.indexOf(first);
      const rest = body.slice(at + first.length).replace(/\s+/g, ' ').trim();
      return { title: first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX).trimEnd()}…` : first, preview: rest.slice(0, PREVIEW_MAX) };
    }
    return { title: 'Untitled', preview: '' };
  }
  return { title, preview: body.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX) };
}
