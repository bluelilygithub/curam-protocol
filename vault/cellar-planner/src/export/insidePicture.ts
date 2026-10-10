import { analyseApp, fullRuns, type AppProject } from '../app/model';
import { buildScene } from '../lite/cellarScene';
import { makeSceneImage } from '../lite/thumbnail';

/** The 3D picture of the inside of this design, as a JPEG data address, for the drawing package and the quote. Needs a browser (it draws off screen). */
export async function insidePicture(p: AppProject): Promise<string> {
  const a = analyseApp(p);
  const iz = a.enclosure.internal;
  const scene = buildScene({ project: p, runs: fullRuns(p), analysis: a.racks, dims: { width: `${iz.widthMm} mm`, depth: `${iz.depthMm} mm`, height: `${iz.heightMm} mm` }, yawDeg: 0 });
  return makeSceneImage(scene, p.finish ?? 'OAK');
}
