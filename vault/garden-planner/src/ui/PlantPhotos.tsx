import { useEffect, useState } from 'react';
import type { PlantRecord } from '../plants/types';
import type { PhotoAnswer, PlantPhoto } from '../state/plantPhotos';
import { useApp } from './AppContext';
import { PlantSwatch } from './PlantLibrary';
import { plantLabel } from '../plants/plants';

/**
 * Real photos of a plant, one at a time with arrows, and under each one the credit line with links to the licence and the source. Photos load
 * in the background; until one arrives (or if none exist, or the server cannot be reached) the card keeps the colour swatch, so a missing
 * photo is never an error. Photos are shown from the source's own servers and are never edited.
 */
export function PlantPhotos({ p }: { p: PlantRecord }) {
  const app = useApp();
  const [answer, setAnswer] = useState<PhotoAnswer | undefined>(() => app.plantPhotos.peek(p.id));
  const [i, setI] = useState(0);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    setI(0); setBroken(new Set());
    setAnswer(app.plantPhotos.peek(p.id));
    void app.plantPhotos.get(p.id, (a) => { if (live) setAnswer(a); }).then((a) => { if (live) setAnswer(a); });
    return () => { live = false; };
  }, [app, p.id]);

  const photos = (answer?.images ?? []).filter((x) => !broken.has(x.id));
  const cur: PlantPhoto | undefined = photos[Math.min(i, photos.length - 1)];
  if (!cur) {
    return (
      <div className="photo-empty" data-testid="plant-photo-empty">
        <PlantSwatch p={p} size={56} />
        <span className="note">{answer?.status === 'pending' || !answer ? 'Looking for photos…' : 'No open-licence photo found for this plant yet.'}</span>
      </div>
    );
  }
  const idx = photos.indexOf(cur);
  const go = (d: number): void => setI((idx + d + photos.length) % photos.length);
  return (
    <figure className="photo" data-testid="plant-photo">
      <div className="photo-frame">
        <img src={cur.thumbUrl} alt={`${plantLabel(p)}${cur.role === 'flower' ? ', flowers' : cur.role === 'foliage' ? ', leaves' : ''}`} loading="lazy" referrerPolicy="no-referrer"
          onError={() => setBroken((b) => new Set(b).add(cur.id))} />
        {photos.length > 1 && (
          <>
            <button type="button" className="photo-nav prev" aria-label="Previous photo" onClick={() => go(-1)}>‹</button>
            <button type="button" className="photo-nav next" aria-label="Next photo" onClick={() => go(1)}>›</button>
            <span className="photo-count" aria-live="polite">{idx + 1} / {photos.length}</span>
          </>
        )}
      </div>
      <figcaption className="photo-credit" data-testid="plant-photo-credit">
        Photo: {cur.creator}, {cur.licenceUrl ? <a href={cur.licenceUrl} target="_blank" rel="noopener noreferrer">{cur.licenceCode}</a> : cur.licenceCode} via <a href={cur.sourceUrl} target="_blank" rel="noopener noreferrer">{cur.sourceLabel}</a>
      </figcaption>
    </figure>
  );
}
