// Render photo for the public planner: the three.js half. The design (photoGeometry.ts) becomes a scene of real shapes and a path tracer
// (three-gpu-pathtracer, MIT) draws it in the visitor's own browser, into its own off-screen canvas, so nothing is sent anywhere and the page's
// pictures are never touched. Lazy-loaded: this file (and three.js, about a megabyte) is only fetched when the visitor presses Render photo.
// The library's WebGLPathTracer is marked deprecated upstream in favour of a WebGPU one that many laptops cannot run yet, so everything that
// touches it stays in this one file (the same decision as Room Planner's and Garden Planner's).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GradientEquirectTexture, WebGLPathTracer } from 'three-gpu-pathtracer';
import { captionLayout, photoUnsupportedReason, type Tracer } from '@planner-core/render3d/photo';
import { FINISH_LOOK } from './finishes';
import { photoPose, type PhotoGeometry, type PhotoView } from './photoGeometry';

/** Whether this browser can path-trace: a WebGL2 context with float render targets. Null = yes. */
export function checkPhotoSupport(width: number, height: number): string | null {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const reason = photoUnsupportedReason(gl as unknown as Parameters<typeof photoUnsupportedReason>[0], width, height);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return reason;
  } catch {
    return photoUnsupportedReason(null);
  }
}

const M = 1 / 1000; // millimetres to metres
const rgb = (c: [number, number, number]): THREE.Color => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255).convertSRGBToLinear();

/** The scene for a design. Plan coordinates (x east, y south, z up) become three.js ones (x east, y up, z south), in metres. */
export function buildPhotoScene(g: PhotoGeometry, view: PhotoView): { scene: THREE.Scene; lights: number } {
  const scene = new THREE.Scene();
  const fx = new Set(g.effects);
  const look = FINISH_LOOK[g.finish];
  const W = g.widthMm, D = g.depthMm, H = g.heightMm;
  const mat = (color: THREE.ColorRepresentation, roughness = 0.7, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
  const wallColour = fx.has('WALL_TIMBER') ? '#a9764a' : fx.has('WALL_STONE') ? '#8f8c84' : '#e9e5db';
  const wallMat = mat(wallColour, fx.has('WALL_STONE') ? 0.75 : 0.9);
  const floorMat = mat(fx.has('FLOOR_STONE') ? '#a39f96' : '#b98d5f', fx.has('FLOOR_STONE') ? 0.55 : 0.5);
  const ceilingMat = mat('#f2efe8', 0.95);
  const rackMat = mat(rgb(look.end), 0.55);
  const railMat = mat(rgb(look.top), 0.5);
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, metalness: 0, transmission: 1, ior: 1.5, thickness: 0.01, transparent: false });
  const bottleMat = new THREE.MeshPhysicalMaterial({ color: '#2f5e3d', roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
  const foilMat = new THREE.MeshStandardMaterial({ color: '#c9a24a', roughness: 0.35, metalness: 0.6 }); // the foil on the neck: it makes each bottle end easy to see
  const doorMat = mat('#8a5a34', 0.5);
  const glow = (strength: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: '#000000', emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: strength, roughness: 1 });

  /** A box between two plan corners (mm). */
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1e-4, (x1 - x0) * M), Math.max(1e-4, (z1 - z0) * M), Math.max(1e-4, (y1 - y0) * M)), m);
    mesh.position.set(((x0 + x1) / 2) * M, ((z0 + z1) / 2) * M, ((y0 + y1) / 2) * M);
    scene.add(mesh);
    return mesh;
  };

  // floor and (for the doorway view) ceiling
  box(-300, W + 300, -300, D + 300, -60, 0, floorMat);
  if (view === 'door') box(-300, W + 300, -300, D + 300, H, H + 60, ceilingMat);

  // walls: the door wall has its opening, and is left out of the overview (cut away, so there is nothing between the viewer and the room)
  const T = 100;
  const door = g.door;
  const wallBox = (side: 'NORTH' | 'SOUTH' | 'WEST' | 'EAST', s0: number, s1: number, z0: number, z1: number, m: THREE.Material): void => {
    if (s1 - s0 < 1 || z1 - z0 < 1) return;
    if (side === 'NORTH') box(s0, s1, -T, 0, z0, z1, m);
    else if (side === 'SOUTH') box(s0, s1, D, D + T, z0, z1, m);
    else if (side === 'WEST') box(-T, 0, s0, s1, z0, z1, m);
    else box(W, W + T, s0, s1, z0, z1, m);
  };
  for (const w of g.walls) {
    const len = w.side === 'NORTH' || w.side === 'SOUTH' ? W : D;
    const ext = T; // run the walls past the corners so they close
    const m = w.kind === 'GLASS' ? glassMat : wallMat;
    if (w.side === door.wall) {
      if (view === 'overview') continue;
      if (door.bMm > door.aMm) {
        wallBox(w.side, -ext, door.aMm, 0, H, m);
        wallBox(w.side, door.bMm, len + ext, 0, H, m);
        wallBox(w.side, door.aMm, door.bMm, door.heightMm, H, m);
        continue;
      }
    }
    wallBox(w.side, -ext, len + ext, 0, H, m);
  }
  // the doors themselves (glass or timber), where the door is, when the wall is cut away or a glass front is picked
  if (door.kind !== 'none' && door.bMm > door.aMm && (view === 'overview' || door.kind === 'glass')) {
    const leaves = door.leaves, gap = leaves === 2 ? 10 : 0, w = (door.bMm - door.aMm - gap) / leaves;
    for (let i = 0; i < leaves; i++) {
      const a = door.aMm + i * (w + gap);
      wallBox(door.wall, a, a + w, 0, door.heightMm, door.kind === 'glass' ? glassMat : doorMat);
    }
  }
  if (fx.has('GLASS_FRONT') && view === 'overview') wallBox(door.wall, -T, (door.wall === 'NORTH' || door.wall === 'SOUTH' ? W : D) + T, 0, H, glassMat);

  // racks: an open box (back, two ends, top and base) with a thin rail under every row, and the bottles lying in it
  const ledMat = fx.has('LIGHT_RACK_LED') ? glow(6) : null;
  for (const r of g.racks) {
    const t = 18;
    const alongX = r.open === 'N' || r.open === 'S';
    if (alongX) {
      const back = r.open === 'S' ? [r.y0, r.y0 + t] : [r.y1 - t, r.y1];
      box(r.x0, r.x1, back[0], back[1], 0, r.h, fx.has('LIGHT_BACKLIT') ? glow(2.2) : rackMat);
      box(r.x0, r.x0 + t, r.y0, r.y1, 0, r.h, rackMat);
      box(r.x1 - t, r.x1, r.y0, r.y1, 0, r.h, rackMat);
    } else {
      const back = r.open === 'E' ? [r.x0, r.x0 + t] : [r.x1 - t, r.x1];
      box(back[0], back[1], r.y0, r.y1, 0, r.h, fx.has('LIGHT_BACKLIT') ? glow(2.2) : rackMat);
      box(r.x0, r.x1, r.y0, r.y0 + t, 0, r.h, rackMat);
      box(r.x0, r.x1, r.y1 - t, r.y1, 0, r.h, rackMat);
    }
    box(r.x0, r.x1, r.y0, r.y1, r.h - t, r.h, railMat);
    box(r.x0, r.x1, r.y0, r.y1, 0, 40, rackMat);
    for (let j = 0; j <= r.rows; j++) {
      const z = 38 + j * r.pitch;
      const lip = 26;
      if (alongX) {
        const f = r.open === 'S' ? [r.y1 - lip, r.y1] : [r.y0, r.y0 + lip];
        box(r.x0, r.x1, f[0], f[1], z, z + 10, railMat);
        if (ledMat) box(r.x0 + t, r.x1 - t, r.open === 'S' ? r.y1 - 6 : r.y0, r.open === 'S' ? r.y1 : r.y0 + 6, z - 6, z - 2, ledMat);
      } else {
        const f = r.open === 'E' ? [r.x1 - lip, r.x1] : [r.x0, r.x0 + lip];
        box(f[0], f[1], r.y0, r.y1, z, z + 10, railMat);
        if (ledMat) box(r.open === 'E' ? r.x1 - 6 : r.x0, r.open === 'E' ? r.x1 : r.x0 + 6, r.y0 + t, r.y1 - t, z - 6, z - 2, ledMat);
      }
    }
  }

  // bottles: a body, a shoulder and a neck each, merged into just two meshes (glass, and foil on the neck). Real geometry rather than instancing, because
  // the path tracer builds its own acceleration structure from plain meshes.
  if (g.bottles.length) {
    const bodyG = new THREE.CylinderGeometry(1, 1, 1, 14), shoulderG = new THREE.CylinderGeometry(0.32, 1, 1, 14), neckG = new THREE.CylinderGeometry(0.34, 0.34, 1, 10);
    const up = new THREE.Vector3(0, 1, 0);
    const dirs: Record<string, THREE.Vector3> = { N: new THREE.Vector3(0, 0, -1), S: new THREE.Vector3(0, 0, 1), W: new THREE.Vector3(-1, 0, 0), E: new THREE.Vector3(1, 0, 0) };
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), mtx = new THREE.Matrix4();
    const glassParts: THREE.BufferGeometry[] = [], foilParts: THREE.BufferGeometry[] = [];
    for (const b of g.bottles) {
      const d = dirs[b.dir]!;
      q.setFromUnitVectors(up, d);
      const L = b.length * M, R = b.radius * M;
      const bodyL = L * 0.64, shL = L * 0.18, neckL = L * 0.18;
      const centre = new THREE.Vector3(b.x * M, b.z * M, b.y * M);
      // a part spanning `len` along the bottle's axis, starting `from` away from the bottle's middle (towards the neck is positive)
      const part = (geo: THREE.BufferGeometry, from: number, len: number): THREE.BufferGeometry => {
        p.copy(centre).addScaledVector(d, from + len / 2);
        s.set(R, len, R);
        mtx.compose(p, q, s);
        return geo.clone().applyMatrix4(mtx);
      };
      const o = -L / 2; // the bottle spans -L/2 .. +L/2 along its axis, the neck end towards the open front
      glassParts.push(part(bodyG, o, bodyL), part(shoulderG, o + bodyL, shL));
      foilParts.push(part(neckG, o + bodyL + shL, neckL));
    }
    const glassGeo = mergeGeometries(glassParts, false), foilGeo = mergeGeometries(foilParts, false);
    if (glassGeo) scene.add(new THREE.Mesh(glassGeo, bottleMat));
    if (foilGeo) scene.add(new THREE.Mesh(foilGeo, foilMat));
    for (const x of [...glassParts, ...foilParts, bodyG, shoulderG, neckG]) x.dispose();
  }

  // a bench or island in the middle (illustrative, as on screen)
  if (g.centrePiece) {
    const c = g.centrePiece;
    box(c.x0, c.x1, c.y0, c.y1, 0, c.h - 40, mat('#3a2a1e', 0.6));
    box(c.x0 - 20, c.x1 + 20, c.y0 - 20, c.y1 + 20, c.h - 40, c.h, mat(rgb(look.top), 0.45));
  }

  // light: ceiling panels (or the picked downlights) and a soft sky glow through any glass
  let lights = 0;
  const lightAt = (x: number, y: number, w: number, d: number, intensity: number): void => {
    const l = new THREE.RectAreaLight('#ffe9c8', intensity, w * M, d * M);
    l.position.set(x * M, (H - 30) * M, y * M);
    l.rotation.x = -Math.PI / 2; // facing down
    l.lookAt(x * M, 0, y * M);
    scene.add(l);
    lights++;
  };
  if (g.downlights.length) {
    for (const dl of g.downlights) lightAt(dl.x, dl.y, 160, 160, 26);
    // a little general light too, so the room is not a few bright pools
    lightAt(W / 2, D / 2, Math.min(W, 1400) * 0.6, Math.min(D, 1400) * 0.6, 6);
  } else {
    const n = Math.max(1, Math.min(6, Math.ceil((W * D) / 3.2e6)));
    for (let i = 0; i < n; i++) lightAt((W * (i + 0.5)) / n, D / 2, 700, 500, 14);
  }
  return { scene, lights };
}

export interface PhotoSetup { geometry: PhotoGeometry; view: PhotoView; width: number; height: number }

export class CellarPathTracer implements Tracer {
  private readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private tracer: WebGLPathTracer | null = null;
  private sky: GradientEquirectTexture | null = null;
  private scene: THREE.Scene | null = null;
  private disposed = false;
  private phaseText = 'Starting…';

  constructor(private readonly setup: PhotoSetup) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = setup.width;
    this.canvas.height = setup.height;
  }

  get previewCanvas(): HTMLCanvasElement { return this.canvas; }
  get phase(): string { return this.phaseText; }

  /** Let the browser paint the current message before the next heavy, blocking step. */
  private async yieldToPaint(text: string): Promise<void> {
    this.phaseText = text;
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  }

  async prepare(): Promise<void> {
    const { setup } = this;
    await this.yieldToPaint('Starting the picture engine…');
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, preserveDrawingBuffer: true, alpha: false });
    renderer.setPixelRatio(1);
    renderer.setSize(setup.width, setup.height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    this.renderer = renderer;

    await this.yieldToPaint('Building your cellar…');
    const { scene } = buildPhotoScene(setup.geometry, setup.view);
    this.scene = scene;
    const sky = new GradientEquirectTexture(256);
    sky.topColor.set('#9db4cf');
    sky.bottomColor.set('#e8e2d6');
    sky.exponent = 1.2;
    sky.update();
    this.sky = sky;
    scene.background = new THREE.Color('#d9d4c8');
    scene.environment = sky;
    scene.environmentIntensity = 0.35;
    if (this.disposed) return;

    const pose = photoPose(setup.geometry, setup.view);
    const camera = new THREE.PerspectiveCamera(pose.fov, setup.width / setup.height, 0.05, 80);
    camera.position.set(pose.position[0] * M, pose.position[2] * M, pose.position[1] * M);
    camera.lookAt(new THREE.Vector3(pose.target[0] * M, pose.target[2] * M, pose.target[1] * M));
    camera.updateMatrixWorld(true);

    const tracer = new WebGLPathTracer(renderer);
    tracer.tiles.set(2, 2);
    tracer.bounces = 5;
    tracer.transmissiveBounces = 4;
    tracer.filterGlossyFactor = 0.5;
    tracer.renderDelay = 0;
    tracer.minSamples = 1;
    tracer.fadeDuration = 0;
    tracer.rasterizeScene = false;
    tracer.dynamicLowRes = false;
    tracer.synchronizeRenderSize = true;
    this.tracer = tracer;
    await this.yieldToPaint('Preparing the light and surfaces (this can take a little while)…');
    tracer.setScene(scene, camera); // synchronous: the async path needs a BVH worker, which is one more moving part
    if (this.disposed) return;
    tracer.reset();
    this.phaseText = 'Getting your graphics card ready (up to a minute the first time)…';
  }

  step(): number {
    const t = this.tracer;
    if (!t) throw new Error('The picture has not been set up yet.');
    t.renderSample();
    this.phaseText = (t as unknown as { isCompiling?: boolean }).isCompiling ? 'Getting your graphics card ready (up to a minute the first time)…' : 'Rendering';
    return Math.floor(t.samples);
  }

  /** The picture so far as a PNG, with a thin caption strip under it (what it is, and the date). */
  async toBlob(opts: { title: string; note: string; date: Date }): Promise<Blob> {
    const src = this.canvas;
    const L = captionLayout(src.width, opts.title, opts.note, opts.date);
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height + L.stripHeight;
    const g = out.getContext('2d');
    if (!g) throw new Error('Could not draw the picture.');
    g.drawImage(src, 0, 0);
    g.fillStyle = '#ffffff';
    g.fillRect(0, src.height, out.width, L.stripHeight);
    g.fillStyle = '#1a1a1a';
    g.font = `${L.fontPx}px "Segoe UI", system-ui, sans-serif`;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillText(L.left, L.padding, src.height + L.baseline);
    g.textAlign = 'right';
    g.fillStyle = '#666666';
    g.fillText(L.right, out.width - L.padding, src.height + L.baseline);
    return new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture file.'))), 'image/png'));
  }

  dispose(): void {
    this.disposed = true;
    this.tracer?.dispose();
    this.sky?.dispose();
    this.scene?.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.tracer = null;
    this.scene = null;
    this.renderer = null;
  }
}
