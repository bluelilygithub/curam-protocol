import Konva from 'konva';
import { paint } from './CellarView';
import type { Scene } from './cellarScene';
import type { FinishKey } from './finishes';

// A small picture of the Inside view as a JPEG data address, drawn off screen. The page around the planner shows it in its phone bar while the real
// picture is scrolled out of sight, so the visitor still sees what their changes do. About 5 to 10 KB.

export const THUMB_W = 180, THUMB_H = 112;

export function makeThumb(scene: Scene, finish?: FinishKey): string {
  const holder = document.createElement('div');
  const stage = new Konva.Stage({ container: holder, width: THUMB_W, height: THUMB_H });
  try {
    const layer = new Konva.Layer();
    stage.add(layer);
    paint(layer, scene, THUMB_W, THUMB_H, { pad: 6, labels: false, finish });
    return stage.toDataURL({ mimeType: 'image/jpeg', quality: 0.62, pixelRatio: 1 });
  } finally {
    stage.destroy();
  }
}

// A large picture of the Inside view for printing: the drawing package and the customer quote. Same scene, drawn off screen, with the measurements.
export const IMAGE_W = 1200, IMAGE_H = 760;

export function makeSceneImage(scene: Scene, finish?: FinishKey): string {
  const holder = document.createElement('div');
  const stage = new Konva.Stage({ container: holder, width: IMAGE_W, height: IMAGE_H });
  try {
    const layer = new Konva.Layer();
    stage.add(layer);
    paint(layer, scene, IMAGE_W, IMAGE_H, { pad: 46, labels: true, finish });
    return stage.toDataURL({ mimeType: 'image/jpeg', quality: 0.88, pixelRatio: 1 });
  } finally {
    stage.destroy();
  }
}

/** The bytes of a `data:image/jpeg;base64,...` address, or null when it is not one. */
export function dataUrlBytes(url: string): Uint8Array | null {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!m) return null;
  try {
    const bin = atob(m[1] as string);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
