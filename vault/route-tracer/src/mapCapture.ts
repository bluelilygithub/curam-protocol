import maplibregl from 'maplibre-gl';
import type { BBox, Pos } from './geo';
import { styleUrl } from './MapView';

export interface MapPicture { bytes: Uint8Array; type: 'jpg'; center: Pos; zoom: number }

const TIMEOUT_MS = 30000;
const PADDING_PX = 70; // CSS pixels of room round the route inside the picture

/**
 * A picture of the base map (no route on it: the PDF draws the route itself, as vector) fitted to `bbox`, at exactly `width` x `height` CSS
 * pixels and twice that in real pixels. It uses a second, hidden map so the one on screen does not jump about. Takes a moment: it waits for
 * the tiles to arrive. Rejects with a plain message if they never do.
 */
export async function captureMap(opts: { bbox: BBox; styleId: string; key: string; width: number; height: number }): Promise<MapPicture> {
  const { bbox, styleId, key, width, height } = opts;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-30000px;top:0;width:${width}px;height:${height}px;pointer-events:none`;
  document.body.appendChild(host);
  let map: maplibregl.Map | null = null;
  try {
    map = new maplibregl.Map({
      container: host,
      style: styleUrl(styleId, key),
      bounds: bbox,
      fitBoundsOptions: { padding: PADDING_PX, maxZoom: 17 },
      interactive: false,
      attributionControl: false,
      pixelRatio: 2,
      fadeDuration: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    const m = map;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('The map pictures did not arrive in time. Check your connection and try again.')), TIMEOUT_MS);
      const check = (): void => {
        if (m.isStyleLoaded() && m.areTilesLoaded() && !m.isMoving()) { window.clearTimeout(timer); resolve(); }
      };
      m.on('idle', check);
      m.on('error', (e) => { // a style or key problem is fatal; a single tile failing is not (the picture just has a gap)
        const status = (e as { error?: { status?: number } }).error?.status;
        if (status === 401 || status === 403) { window.clearTimeout(timer); reject(new Error('The map picture was refused. The map key may not allow this.')); }
      });
    });
    const blob = await new Promise<Blob | null>((res) => m.getCanvas().toBlob(res, 'image/jpeg', 0.9));
    if (!blob) throw new Error('The map picture could not be made.');
    const c = m.unproject([width / 2, height / 2]); // the middle of the PICTURE (getCenter() moves if the map has padding)
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'jpg', center: [c.lng, c.lat], zoom: m.getZoom() };
  } finally {
    map?.remove();
    host.remove();
  }
}
