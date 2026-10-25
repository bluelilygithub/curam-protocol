import type maplibregl from 'maplibre-gl';
import { useState } from 'react';
import type { Cue } from './api';
import { cuesToText, textFileName } from './cueText';
import { formatDistance, type Units } from './geo';
import { useStore } from './store';

/** Copy text to the clipboard: the modern way, and the old textarea way where a frame or an older browser refuses it. */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* try the old way */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/**
 * Turn-by-turn directions for a route: a list that can be opened and closed. Tapping a step flies the map to the place where it happens.
 * Copy puts them on the clipboard as numbered lines, Download .txt saves the same text as a file. Used by Plan route (the route being chosen)
 * and by a saved track that came from a planned route.
 */
export function DirectionsList({ cues, map, units, title = 'Route', startOpen = false }: { cues: Cue[]; map: maplibregl.Map | null; units: Units; title?: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const toast = useStore((s) => s.toast);
  if (!cues.length) return null;
  let sofar = 0;
  const rows = cues.map((c) => { const at = sofar; sofar += c.distanceM; return { c, at }; });

  async function copy(): Promise<void> {
    const ok = await copyText(cuesToText({ title, cues, units }));
    toast(ok ? 'ok' : 'error', ok ? 'Directions copied' : 'Could not copy here. Use Download .txt instead.');
  }
  function download(): void {
    const url = URL.createObjectURL(new Blob([cuesToText({ title, cues, units })], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = textFileName(title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return (
    <section className="directions" aria-label="Directions" data-testid="directions">
      <button type="button" className="directions-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        title="Turn-by-turn directions for this route. Open the list, then tap a step to see where it happens on the map.">
        Directions · {cues.length} {cues.length === 1 ? 'step' : 'steps'}
      </button>
      <div className="directions-actions">
        <button type="button" onClick={() => void copy()} title="Copy the directions to the clipboard as numbered lines, to paste into an email or notes">Copy</button>
        <button type="button" onClick={download} title="Save the directions as a plain text (.txt) file">Download .txt</button>
      </div>
      {open && (
        <ol className="directions-list">
          {rows.map(({ c, at }, i) => (
            <li key={i}>
              <button type="button" onClick={() => map?.flyTo({ center: c.pos, zoom: Math.max(map.getZoom(), 16), duration: 500 })} title="Show where this happens on the map">
                <span className="dn">{i + 1}</span>
                <span className="dt">{c.text}</span>
                <span className="dd">{c.distanceM > 0 ? formatDistance(c.distanceM / 1000, units) : ''}<small>{formatDistance(at / 1000, units)} in</small></span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
