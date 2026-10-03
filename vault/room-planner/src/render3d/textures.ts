// three.js wrapper for the generated textures (see textureData.ts). DataTexture, so it needs no canvas and works in Node tests too.
import * as THREE from 'three';
import { generateTexture, TEXTURE_SPECS, type TextureKind } from './textureData';

const cache = new Map<TextureKind, THREE.DataTexture>();

/** The (shared, cached) tiling texture of a kind. UVs are in metres, so `repeat` is 1 / metres-per-tile. */
export function textureOf(kind: TextureKind): THREE.DataTexture {
  let t = cache.get(kind);
  if (!t) {
    const raw = generateTexture(kind);
    t = new THREE.DataTexture(raw.data, raw.width, raw.height, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.repeat.set(1 / TEXTURE_SPECS[kind].tile, 1 / TEXTURE_SPECS[kind].tile);
    t.needsUpdate = true;
    cache.set(kind, t);
  }
  return t;
}

export function disposeTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
