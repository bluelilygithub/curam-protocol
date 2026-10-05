// Real 3D models: every one has a library item, files on disk, a credit, a plan glyph and a block stand-in.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FINISHES, FURNITURE_LIBRARY } from '../../src/data/furnitureLibrary';
import { isRealModel, MODEL_LICENCE, REAL_MODELS } from '../../src/data/realModels';
import { glyphFor } from '../../src/render2d/glyphs';
import { furnitureParts, hasFurnitureRecipe, partsBounds } from '../../src/render3d/furnitureParts';

const root = join(__dirname, '..', '..', 'public', 'models');

describe('real 3D models', () => {
  const entries = Object.entries(REAL_MODELS);

  it('has six curated models, each a library item', () => {
    expect(entries.length).toBe(6);
    for (const [id] of entries) expect(FURNITURE_LIBRARY.some((d) => d.id === id), id).toBe(true);
    expect(FURNITURE_LIBRARY.filter((d) => isRealModel(d.id)).length).toBe(entries.length);
  });

  it('every model has its files and a CC0 source record naming the author', () => {
    for (const [id, m] of entries) {
      const dir = join(root, m.folder);
      expect(existsSync(join(dir, `${m.folder}_1k.gltf`)), `${id} gltf`).toBe(true);
      expect(existsSync(join(dir, `${m.folder}.bin`)), `${id} bin`).toBe(true);
      const src = JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8')) as { authors: string[]; licence: string; url: string };
      expect(src.licence, id).toBe('CC0');
      expect(src.authors, id).toContain(m.author);
      expect(src.url, id).toBe(`https://polyhaven.com/a/${m.folder}`);
      expect(m.title.length, id).toBeGreaterThan(2);
    }
    expect(MODEL_LICENCE.name).toMatch(/CC0/);
  });

  it('every gltf only references files that exist (no remote URLs)', () => {
    for (const [, m] of entries) {
      const dir = join(root, m.folder);
      const g = JSON.parse(readFileSync(join(dir, `${m.folder}_1k.gltf`), 'utf8')) as { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> };
      for (const f of [...(g.buffers ?? []), ...(g.images ?? [])]) {
        expect(f.uri, m.folder).toBeDefined();
        expect(/^https?:/i.test(f.uri!), `${m.folder} ${f.uri}`).toBe(false);
        expect(existsSync(join(dir, decodeURIComponent(f.uri!))), `${m.folder} ${f.uri}`).toBe(true);
      }
    }
  });

  it('keeps a block stand-in that fills the piece, a plan glyph and default finishes', () => {
    for (const [id, m] of entries) {
      const d = FURNITURE_LIBRARY.find((x) => x.id === id)!;
      expect(hasFurnitureRecipe(id), id).toBe(true);
      const b = partsBounds(furnitureParts(id, d.defaultWidth, d.defaultLength, d.defaultHeight));
      expect(b.max[1] - b.min[1], id).toBeCloseTo(d.defaultHeight, 2);
      expect(glyphFor(id, d.defaultWidth, d.defaultLength).shapes.length, id).toBe(glyphFor(m.blockAs, d.defaultWidth, d.defaultLength).shapes.length);
      expect(DEFAULT_FINISHES[id], id).toBeDefined();
    }
  });

  it('library sizes match the models, so nothing is stretched on first placement', () => {
    for (const [id, m] of entries) {
      const d = FURNITURE_LIBRARY.find((x) => x.id === id)!;
      const g = JSON.parse(readFileSync(join(root, m.folder, `${m.folder}_1k.gltf`), 'utf8')) as { accessors: Array<{ min?: number[]; max?: number[] }>; meshes: Array<{ primitives: Array<{ attributes: { POSITION: number } }> }> };
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const mesh of g.meshes) for (const p of mesh.primitives) {
        const a = g.accessors[p.attributes.POSITION];
        for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], a.min![i]); hi[i] = Math.max(hi[i], a.max![i]); }
      }
      const [sx, sy, sz] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      const swap = m.turn === 90 || m.turn === 270;
      expect(d.defaultWidth, id).toBeCloseTo(swap ? sz : sx, 1);
      expect(d.defaultLength, id).toBeCloseTo(swap ? sx : sz, 1);
      expect(d.defaultHeight, id).toBeCloseTo(sy, 1);
    }
  });
});
