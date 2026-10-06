import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { botanicalLabel, plantById, plantLabel } from '../plants/plants';
import { plantSizeAt } from '../plants/growth';
import type { PhotoAnswer } from '../state/plantPhotos';
import { useApp, useProject, useUi } from './AppContext';
import { PlantSwatch } from './PlantLibrary';

const W = 248;
const SUN_TEXT: Record<string, string> = { full_sun: 'Full sun', part_shade: 'Part shade', shade: 'Shade' };

/**
 * What appears when the cursor rests on a plant in the 2D plan: its name, size at the growth stage on the slider, sun, and a photo with the
 * credit line (a photo is never shown without its credit). It ignores the mouse so it never gets in the way of dragging the plant. Until a
 * photo arrives, or if there is none, the colour swatch stands in.
 */
export function PlantHoverCard({ hover }: { hover: { id?: string; plantId?: string; x: number; y: number } }) {
  const app = useApp();
  const inst = useProject((s) => (hover.id ? s.project?.plants.find((x) => x.id === hover.id) : undefined));
  const stage = useUi((s) => s.stage);
  const rec = hover.plantId ? plantById(hover.plantId) : inst ? plantById(inst.plantId) : undefined;
  const [answer, setAnswer] = useState<PhotoAnswer | undefined>(() => (rec ? app.plantPhotos.peek(rec.id) : undefined));
  const [broken, setBroken] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 9999, h: 9999 });

  useEffect(() => {
    if (!rec) return undefined;
    let live = true;
    setBroken(false);
    setAnswer(app.plantPhotos.peek(rec.id));
    void app.plantPhotos.get(rec.id, (a) => { if (live) setAnswer(a); }).then((a) => { if (live) setAnswer(a); });
    return () => { live = false; };
  }, [app, rec?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const p = ref.current?.offsetParent as HTMLElement | null;
    if (p) setBox({ w: p.clientWidth, h: p.clientHeight });
  }, [hover.id, hover.plantId]);

  if (!rec) return null;
  const s = plantSizeAt(rec, stage);
  const photo = broken ? undefined : answer?.images?.[0];
  // beside the plant, flipped to the other side or up near the edges of the plan
  const left = hover.x + 16 + W > box.w ? Math.max(4, hover.x - 16 - W) : hover.x + 16;
  const top = Math.max(4, Math.min(hover.y - 24, box.h - 250));
  return (
    <div ref={ref} className="plant-hover" data-testid="plant-hover" style={{ left, top, width: W }} role="tooltip">
      <div className="plant-hover-photo">
        {photo
          ? <img src={photo.thumbUrl} alt={plantLabel(rec)} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
          : <PlantSwatch p={rec} size={56} />}
      </div>
      <strong>{plantLabel(rec)}</strong>
      <em>{botanicalLabel(rec)}</em>
      <dl>
        <div><dt>Now</dt><dd>{s.height.toFixed(1)} m high, {s.spread.toFixed(1)} m wide</dd></div>
        <div><dt>Mature</dt><dd>{rec.height[0]}–{rec.height[1]} m high, {rec.spread[0]}–{rec.spread[1]} m wide</dd></div>
        <div><dt>Sun</dt><dd>{rec.sun.map((x) => SUN_TEXT[x] ?? x).join(', ')}</dd></div>
      </dl>
      {photo && <small className="plant-hover-credit">Photo: {photo.creator}, {photo.licenceCode} via {photo.sourceLabel}</small>}
      <small className="plant-hover-note">Draft plant data, unverified.{hover.plantId ? ' Drop it on the ground to plant it.' : ' Click to select.'}</small>
    </div>
  );
}
