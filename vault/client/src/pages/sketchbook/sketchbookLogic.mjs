// Sketchbook: small pure helpers for the list and the editor (plus the browser-only picture export). Tested by sketchbookLogic.test.mjs.

/** Narrow the list to sketches whose name or description has every word typed (any case). */
export function filterSketches(items, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((s) => {
    const hay = `${s.title || ''} ${s.description || ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** "today 3:05 pm", "yesterday", "3 days ago", or a date. */
export function when(iso, now = Date.now()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((now - d.getTime()) / 86400000);
  if (days <= 0) return `today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}

/** A safe file name from a title: letters, numbers and dashes, never empty. */
export function fileBase(title) {
  const t = String(title || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return t || 'sketch';
}

/** The formats the page can save a picture as without the server. (More are reached through Graphics: SVG trace, PDF, print files.) */
export const EXPORT_FORMATS = [
  { id: 'png', label: 'PNG', mime: 'image/png', ext: 'png', tip: 'Sharp, no quality loss. Best for keeping or editing further.' },
  { id: 'jpg', label: 'JPG', mime: 'image/jpeg', ext: 'jpg', tip: 'Smaller file. Best for email and documents.' },
  { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', tip: 'Smallest file. Best for websites.' },
];

/** What the page says about an earlier picture in the history list. */
export function versionLabel(v) {
  const note = String(v && v.note ? v.note : '').trim();
  if (!note) return 'Earlier picture';
  return `Before: ${note.length > 70 ? `${note.slice(0, 67)}...` : note}`;
}

/** The name shown for a look, with the pen colour for pen. */
export function lookLabel(style, penColor, options) {
  const s = (options?.styles || []).find((x) => x.id === style);
  const base = s ? s.label : style;
  if (style !== 'pen') return base;
  const c = (options?.penColors || []).find((x) => x.id === penColor);
  return c ? `${base} (${c.label.toLowerCase()})` : base;
}

/** The one-line price note above a button: "About $0.03, or $4.50 of today's $5.00 limit left". */
export function costText(cost) {
  if (!cost) return '';
  if (cost.local) return 'Free: drawn on this computer.';
  const price = Number.isFinite(cost.usd) ? `About $${cost.usd.toFixed(3).replace(/0$/, '')} for this picture` : 'Price not known in advance';
  if (cost.remainingUsd == null || cost.capUsd == null) return `${price}.`;
  if (cost.remainingUsd <= 0) return `${price}. Today's limit for AI pictures ($${cost.capUsd.toFixed(2)}) is used up.`;
  return `${price}. $${cost.remainingUsd.toFixed(2)} of today's $${cost.capUsd.toFixed(2)} limit left.`;
}

/** Browser only: the picture re-encoded as another format and returned as a Blob. JPG gets a white background. */
export function convertPicture(dataUrl, format, quality = 0.92) {
  return new Promise((resolve, reject) => {
    const f = EXPORT_FORMATS.find((x) => x.id === format);
    if (!f) { reject(new Error('That format is not available.')); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be saved in that format.'))), f.mime, quality);
    };
    img.onerror = () => reject(new Error('The picture could not be read.'));
    img.src = dataUrl;
  });
}

/** Browser only: save a Blob to the person's computer. */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
