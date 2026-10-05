// Render photo (Spec Addition A2, M4.7): the three.js half. A path tracer (three-gpu-pathtracer, MIT) draws the same realistic scene
// into its own off-screen canvas, so the live 3D view is never touched. Lazy-loaded (this file is only imported when the Photo panel
// opens). The library's WebGLPathTracer is marked deprecated upstream in favour of a WebGPU one, which many laptops cannot run yet,
// so everything that touches it stays in this one file (D73).
import * as THREE from 'three';
import { GradientEquirectTexture, WebGLPathTracer } from 'three-gpu-pathtracer';
import { createFeedbackBus } from '../state/feedbackBus';
import type { ProjectStore } from '../state/projectStore';
import { createUiStore } from '../state/uiStore';
import { captionLayout, LIGHTING, photoUnsupportedReason, type LightingPreset, type PhotoLighting, type Tracer } from './photo';
import { type CameraState, polarFromVertical } from './cameraPresets';
import { Scene3D } from './Scene3D';
import { textureOf } from './textures';

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

export interface PhotoSetup {
  project: ProjectStore;
  camera: CameraState;
  width: number;
  height: number;
  lighting: PhotoLighting;
  /** Vertical field of view in degrees (wider for an eye-level view inside the room). */
  fov?: number;
  /** Whether lamps and ceiling lights are on (the live view's Lights switch). */
  lightsOn?: boolean;
}


/** A perspective camera for the picture, looking from the 3D view's position at its target (an orthographic view becomes a perspective one). */
export function photoCamera(c: CameraState, width: number, height: number, fov = 50): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(fov, width / height, 0.05, 200);
  cam.position.set(...c.position);
  cam.lookAt(new THREE.Vector3(...c.target));
  cam.updateMatrixWorld(true);
  return cam;
}

export class PathTracerTracer implements Tracer {
  private readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private tracer: WebGLPathTracer | null = null;
  private scene3d: Scene3D | null = null;
  private sky: GradientEquirectTexture | null = null;
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
    await this.yieldToPaint('Building the room and furniture…');

    // The scene: the Realistic look of this project, built by the same Scene3D as the live view but with its own private UI state
    const ui = createUiStore();
    ui.getState().setViewMode('3d');
    ui.getState().setCinematic(true);
    ui.getState().setLook('realistic');
    ui.getState().setQuality('high');
    ui.getState().setLightsOn(setup.lightsOn !== false);
    const scene3d = new Scene3D({ project: setup.project, ui, bus: createFeedbackBus(), invalidate: () => {}, animateMs: 0 });
    this.scene3d = scene3d;
    const scene = new THREE.Scene();
    scene.add(scene3d.root);

    await this.yieldToPaint('Loading your photos…');
    await scene3d.ready();
    const camera = photoCamera(setup.camera, setup.width, setup.height, setup.fov);
    scene3d.updateFade({ x: camera.position.x, y: camera.position.z }, polarFromVertical(setup.camera.position, setup.camera.target));

    // Bump maps (a rasteriser trick) show up as speckle in a path-traced picture; the colour maps already carry the detail
    scene3d.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) {
        if (x.bumpMap) { x.bumpMap = null; x.needsUpdate = true; }
        // plaster and paint are almost flat colours; their fine stipple is not mip-mapped by the tracer and aliases into dots
        if (x.map === textureOf('plaster') || x.map === textureOf('paint')) { x.map = null; x.needsUpdate = true; }
      }
    });
    // The path tracer reads object visibility, not material visibility, so a cut-away wall must be hidden on the mesh itself
    scene3d.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if ((o as THREE.Mesh).isMesh && m && m.visible === false) o.visible = false;
    });

    const preset = LIGHTING[setup.lighting];
    this.applyLighting(scene, scene3d, preset, camera);

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
    // a quick flat preview, so there is something to look at while the graphics card compiles the path tracer
    try { renderer.render(scene, camera); } catch { /* the preview is optional */ }
    this.phaseText = 'Getting your graphics card ready (up to a minute the first time)…';
  }

  private applyLighting(scene: THREE.Scene, scene3d: Scene3D, p: LightingPreset, camera: THREE.Camera): void {
    const sky = new GradientEquirectTexture(256);
    sky.topColor.set(p.skyTop);
    sky.bottomColor.set(p.skyHorizon);
    sky.exponent = 1.2;
    sky.update();
    this.sky = sky;
    scene.background = sky;
    scene.environment = sky;
    scene.environmentIntensity = p.skyLight;
    scene.backgroundIntensity = 1;
    scene3d.root.traverse((o) => {
      if ((o as THREE.AmbientLight).isAmbientLight) (o as THREE.AmbientLight).intensity = 0; // the sky lights the room now
      if ((o as THREE.DirectionalLight).isDirectionalLight) {
        const sun = o as THREE.DirectionalLight;
        sun.intensity = p.sun;
        sun.color.set(p.sunColour);
        const el = THREE.MathUtils.degToRad(p.sunElevationDeg);
        const dist = 12;
        // The walls between the camera and the room are cut away, so the sun comes in from the camera's side, turned 40 degrees so the
        // light has a direction. (A sun behind a standing wall would leave the room in shadow.)
        const toCam = new THREE.Vector2(camera.position.x - sun.target.position.x, camera.position.z - sun.target.position.z);
        if (toCam.lengthSq() < 1e-6) toCam.set(1, 1);
        toCam.normalize().rotateAround(new THREE.Vector2(), THREE.MathUtils.degToRad(40));
        const horiz = Math.cos(el) * dist;
        sun.position.set(sun.target.position.x + toCam.x * horiz, sun.target.position.y + Math.sin(el) * dist, sun.target.position.z + toCam.y * horiz);
        sun.target.updateMatrixWorld();
        sun.updateMatrixWorld();
      }
    });
  }

  step(): number {
    const t = this.tracer;
    if (!t) throw new Error('The picture has not been set up yet.');
    t.renderSample();
    this.phaseText = (t as unknown as { isCompiling?: boolean }).isCompiling ? 'Getting your graphics card ready (up to a minute the first time)…' : 'Rendering';
    return Math.floor(t.samples);
  }

  /** The picture so far as a PNG, with an optional caption strip under it. */
  async toBlob(caption?: { project: string; room: string; date: Date }): Promise<Blob> {
    const src = this.canvas;
    let out: HTMLCanvasElement = src;
    if (caption) {
      const L = captionLayout(src.width, caption.project, caption.room, caption.date);
      out = document.createElement('canvas');
      out.width = src.width;
      out.height = src.height + L.stripHeight;
      const g = out.getContext('2d');
      if (!g) throw new Error('Could not draw the caption.');
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
    }
    return new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture file.'))), 'image/png'));
  }

  dispose(): void {
    this.disposed = true;
    this.tracer?.dispose();
    this.sky?.dispose();
    this.scene3d?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.tracer = null;
    this.scene3d = null;
    this.renderer = null;
  }
}
