// three.js wrapper for the generated textures (see textureData.ts). DataTexture, so it needs no canvas and works in Node tests too.
import * as THREE from 'three';
import { generateArt, type ArtKind } from './artData';
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
  for (const t of artCache.values()) t.dispose();
  artCache.clear();
}

const artCache = new Map<string, THREE.DataTexture>();

/** The (shared, cached) texture of a built-in artwork at a size. Colour, clamped (no tiling). */
export function artTexture(kind: ArtKind, width: number, height: number): THREE.DataTexture {
  const key = `${kind}|${width}|${height}`;
  let t = artCache.get(key);
  if (!t) {
    const raw = generateArt(kind, width, height);
    t = new THREE.DataTexture(raw.data, raw.width, raw.height, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    artCache.set(key, t);
  }
  return t;
}
