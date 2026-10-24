import type maplibregl from 'maplibre-gl';
import { useState } from 'react';
import type { Cue } from './api';
import { formatDistance, type Units } from './geo';

/**
 * Turn-by-turn directions for a route: a list that can be opened and closed. Tapping a step flies the map to the place where it happens.
 * Used by Plan route (the route being chosen) and by a saved track that came from a planned route.
 */
export function DirectionsList({ cues, map, units, startOpen = false }: { cues: Cue[]; map: maplibregl.Map | null; units: Units; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  if (!cues.length) return null;
  let sofar = 0;
  const rows = cues.map((c) => { const at = sofar; sofar += c.distanceM; return { c, at }; });
  return (
    <section className="directions" aria-label="Directions" data-testid="directions">
      <button type="button" className="directions-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        title="Turn-by-turn directions for this route. Open the list, then tap a step to see where it happens on the map.">
        Directions · {cues.length} {cues.length === 1 ? 'step' : 'steps'}
      </button>
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
