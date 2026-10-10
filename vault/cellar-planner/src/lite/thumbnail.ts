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
