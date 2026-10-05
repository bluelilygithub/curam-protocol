// Real furniture models: loads each glTF once (shared by the live view and Render photo), and fits a copy to a piece's width × length × height.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { REAL_MODELS } from '../data/realModels';

/** Where the model files are served from: next to the app (`public/models`), whatever base path the app is mounted at. */
const modelUrl = (folder: string): string => `${import.meta.env.BASE_URL}models/${folder}/${folder}_1k.gltf`;

/** The model's own size after turning it, and the offset that puts its floor-centre at the origin. */
interface ModelFit { size: THREE.Vector3; offset: THREE.Vector3 }

export class ModelCache {
  private readonly templates = new Map<string, THREE.Object3D>();
  private readonly fits = new Map<string, ModelFit>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();
  /** Called each time a model has loaded, so a scene can swap its block stand-ins for the real thing. */
  readonly listeners = new Set<() => void>();

  /** Resolves when every model asked for so far has loaded (or failed). */
  ready(): Promise<void> { return Promise.all([...this.loading.values()]).then(() => undefined); }

  has(id: string): boolean { return this.templates.has(id); }

  private load(id: string): void {
    const def = REAL_MODELS[id];
    if (!def || this.loading.has(id) || this.failed.has(id) || typeof window === 'undefined') return; // no browser (tests)
    const p = new Promise<void>((resolve) => {
      new GLTFLoader().load(modelUrl(def.folder), (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const turned = new THREE.Group();
        root.rotation.y = (def.turn * Math.PI) / 180;
        turned.add(root);
        turned.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(turned);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        this.fits.set(id, { size, offset: new THREE.Vector3(-centre.x, -box.min.y, -centre.z) });
        this.templates.set(id, turned);
        resolve();
        this.listeners.forEach((l) => l());
      }, undefined, () => { this.failed.add(id); resolve(); });
    });
    this.loading.set(id, p);
  }

  /** A copy of the model stretched to the given size, standing on the floor with its centre at the origin; null until it has loaded (and starts loading it). */
  instance(id: string, width: number, length: number, height: number): THREE.Group | null {
    const t = this.templates.get(id);
    if (!t) { this.load(id); return null; }
    const fit = this.fits.get(id)!;
    const inner = t.clone(true); // geometry and materials are shared with the template
    inner.position.copy(fit.offset);
    const g = new THREE.Group();
    g.add(inner);
    g.scale.set(width / fit.size.x, height / fit.size.y, length / fit.size.z);
    g.name = `model:${id}`;
    return g;
  }
}

/** One cache for the whole app: the live view and the photo scene both use it, so a model is fetched once. */
export const modelCache = new ModelCache();
