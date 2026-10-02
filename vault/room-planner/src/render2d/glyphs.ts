/**
 * Blueprint-style 2D furniture drawings (Spec §7): recognisable line drawings, not raw rectangles.
 * Pure data in the object's LOCAL frame (metres, origin at the centre, +X right, +Y front, back = −Y — C20), so they are
 * testable without a canvas and rendered identically by the React scene and the imperative overlay.
 */
export type Weight = 'outline' | 'detail' | 'faint';

export type GlyphShape =
  | { t: 'rect'; x: number; y: number; w: number; h: number; weight: Weight }
  | { t: 'line'; pts: number[]; weight: Weight }
  | { t: 'circle'; x: number; y: number; r: number; weight: Weight };

export interface Glyph {
  shapes: GlyphShape[];
  /** Small filled triangle just inside the front edge: shows which side is the front (C20). */
  frontMarker: { pts: number[] };
}

const rect = (x: number, y: number, w: number, h: number, weight: Weight = 'detail'): GlyphShape => ({ t: 'rect', x, y, w, h, weight });
const line = (pts: number[], weight: Weight = 'detail'): GlyphShape => ({ t: 'line', pts, weight });
const circle = (x: number, y: number, r: number, weight: Weight = 'detail'): GlyphShape => ({ t: 'circle', x, y, r, weight });

export function frontMarker(w: number, l: number): Glyph['frontMarker'] {
  const s = Math.min(0.1, Math.max(0.04, Math.min(w, l) * 0.12));
  const base = l / 2 - 1.8 * s;
  return { pts: [-s, base, s, base, 0, l / 2 - 0.25 * s] };
}

/** Which drawing a definition gets. Unknown ids fall back to a crossed box. */
export function glyphFor(definitionId: string, w: number, l: number): Glyph {
  const hw = w / 2;
  const hl = l / 2;
  const outline = rect(-hw, -hl, w, l, 'outline');
  const shapes: GlyphShape[] = [outline];
  const arm = Math.min(0.14, w * 0.1);
  const back = l * 0.26;

  switch (definitionId) {
    case 'sofa-3':
    case 'armchair': {
      const seats = definitionId === 'sofa-3' ? 3 : 1;
      shapes.push(line([-hw, -hl + back, hw, -hl + back])); // back rest
      shapes.push(line([-hw + arm, -hl + back, -hw + arm, hl])); // arms
      shapes.push(line([hw - arm, -hl + back, hw - arm, hl]));
      for (let i = 1; i < seats; i++) {
        const x = -hw + arm + ((w - 2 * arm) * i) / seats;
        shapes.push(line([x, -hl + back, x, hl - 0.02], 'faint'));
      }
      break;
    }
    case 'coffee-table': {
      const m = Math.min(0.06, Math.min(w, l) * 0.12);
      shapes.push(rect(-hw + m, -hl + m, w - 2 * m, l - 2 * m, 'faint'));
      break;
    }
    case 'dining-table': {
      const m = Math.min(0.1, Math.min(w, l) * 0.12);
      shapes.push(rect(-hw + m, -hl + m, w - 2 * m, l - 2 * m, 'faint'));
      break;
    }
    case 'side-table':
    case 'bedside-table':
      shapes.push(circle(0, 0, Math.min(w, l) * 0.3, 'faint'));
      if (definitionId === 'bedside-table') shapes.push(line([-hw * 0.7, hl * 0.35, hw * 0.7, hl * 0.35], 'faint'));
      break;
    case 'dining-chair':
      shapes.push(rect(-hw, -hl, w, l * 0.2, 'detail')); // back bar
      break;
    case 'bed-queen': {
      shapes.push(line([-hw, -hl + 0.09, hw, -hl + 0.09])); // headboard
      const pw = (w - 0.24) / 2;
      shapes.push(rect(-hw + 0.08, -hl + 0.14, pw, 0.4, 'detail')); // pillows
      shapes.push(rect(hw - 0.08 - pw, -hl + 0.14, pw, 0.4, 'detail'));
      shapes.push(line([-hw, 0.1, hw, 0.1], 'faint')); // folded cover
      break;
    }
    case 'wardrobe':
      shapes.push(line([0, -hl, 0, hl]));
      shapes.push(line([-0.06, hl - 0.05, -0.06, hl], 'detail')); // door handles at the front
      shapes.push(line([0.06, hl - 0.05, 0.06, hl], 'detail'));
      shapes.push(line([-hw + 0.04, -hl + 0.04, hw - 0.04, -hl + 0.04], 'faint')); // hanging rail
      break;
    case 'desk': {
      const dw = Math.min(0.45, w * 0.32);
      shapes.push(rect(hw - dw, -hl, dw, l, 'faint')); // drawer unit
      shapes.push(line([hw - dw, 0, hw, 0], 'faint'));
      break;
    }
    case 'bookshelf':
      for (let i = 1; i < 4; i++) shapes.push(line([-hw, -hl + (l * i) / 4, hw, -hl + (l * i) / 4], 'faint'));
      break;
    case 'tv-unit':
      for (let i = 1; i < 4; i++) shapes.push(line([-hw + (w * i) / 4, -hl, -hw + (w * i) / 4, hl], 'faint'));
      break;
    default:
      shapes.push(line([-hw, -hl, hw, hl], 'faint'), line([-hw, hl, hw, -hl], 'faint'));
  }
  return { shapes, frontMarker: frontMarker(w, l) };
}
