/** Lazily loads a Google Font's actual face (via a <link> stylesheet) so a
 * font name can be rendered in its own typeface in the picker dropdown —
 * preview only, entirely separate from the real fetch/freeze/customize
 * pipeline. Dedups by family so repeated renders don't re-inject. */
const loaded = new Set();

export function loadGoogleFontPreview(family) {
  if (!family || loaded.has(family)) return;
  loaded.add(family);
  const id = `font-preview-${family.replace(/\s+/g, '-')}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700&display=swap`;
  document.head.appendChild(link);
}
