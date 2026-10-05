// Render photo for the garden: the three.js half. A path tracer (three-gpu-pathtracer, MIT) draws the same scene as the 3D view (ground, the
// satellite photo if the map is on, house, fences, structures, plants) into its own off-screen canvas, with the sun where the time slider and
// month put it, so the live view is never touched. Lazy-loaded: this file is only imported when the Render photo panel starts a picture.
// The library's WebGLPathTracer is marked deprecated upstream in favour of a WebGPU one, which many laptops cannot run yet, so everything
// that touches it stays in this one file (the same decision as Room Planner's).
import * as THREE from 'three';
import { GradientEquirectTexture, WebGLPathTracer } from 'three-gpu-pathtracer';
import { captionLayout, photoUnsupportedReason, type PhotoLighting, type Tracer } from '@planner-core/render3d/photo';
import type { App } from '../createApp';
import { Garden3D } from './Garden3D';
import { gardenLighting, SUN_DOWN_MESSAGE } from './photoLighting';

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

export interface Pose { position: [number, number, number]; target: [number, number, number] }
export interface PhotoSetup {
  app: App;
  camera: Pose;
  width: number;
  height: number;
  lighting: PhotoLighting;
  /** Vertical field of view in degrees. */
  fov?: number;
}

/** A perspective camera for the picture. */
export function photoCamera(c: Pose, width: number, height: number, fov = 50): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(fov, width / height, 0.1, 800);
  cam.position.set(...c.position);
  cam.lookAt(new THREE.Vector3(...c.target));
  cam.updateMatrixWorld(true);
  return cam;
}

export class GardenPathTracer implements Tracer {
  private readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private tracer: WebGLPathTracer | null = null;
  private garden: Garden3D | null = null;
  private sky: GradientEquirectTexture | null = null;
  private disposed = false;
  private phaseText = 'Starting…';
  private usedMap = false;

  constructor(private readonly setup: PhotoSetup) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = setup.width;
    this.canvas.height = setup.height;
  }

  get previewCanvas(): HTMLCanvasElement { return this.canvas; }
  get phase(): string { return this.phaseText; }
  /** True when the satellite photo is on the ground of this picture (its credit must then be printed on it). */
  get usesMap(): boolean { return this.usedMap; }

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

    await this.yieldToPaint('Building the garden…');
    // the garden as it is right now: a frozen copy, so editing while it renders cannot change the picture
    const garden = new Garden3D(null, Garden3D.snapshotApp(setup.app), true);
    this.garden = garden;
    this.usedMap = !!setup.app.project.getState().project?.map?.on;
    if (this.usedMap) {
      await this.yieldToPaint('Loading the satellite map…');
      await garden.ready();
    }
    if (this.disposed) return;

    const { scene, sun, hemi } = garden.photo;
    const light = gardenLighting(setup.lighting, garden.sunPosition().altitude);
    if (!light.sunUp) throw new Error(SUN_DOWN_MESSAGE);
    scene.fog = null; // the path tracer has no fog
    hemi.intensity = 0; // the sky lights the garden now
    sun.intensity = light.sunIntensity;
    sun.color.set(light.sunColour);
    const sky = new GradientEquirectTexture(256);
    sky.topColor.set(light.skyTop);
    sky.bottomColor.set(light.skyHorizon);
    sky.exponent = 1.2;
    sky.update();
    this.sky = sky;
    scene.background = sky;
    scene.environment = sky;
    scene.environmentIntensity = light.skyLight;
    scene.backgroundIntensity = 1;
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();

    const camera = photoCamera(setup.camera, setup.width, setup.height, setup.fov);
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

  step(): number {
    const t = this.tracer;
    if (!t) throw new Error('The picture has not been set up yet.');
    t.renderSample();
    this.phaseText = (t as unknown as { isCompiling?: boolean }).isCompiling ? 'Getting your graphics card ready (up to a minute the first time)…' : 'Rendering';
    return Math.floor(t.samples);
  }

  /**
   * The picture so far as a PNG. `caption` adds a thin strip under it (garden, place, date). `credit` is the map provider's credit, drawn
   * in the corner of the picture itself whenever the satellite photo is part of it: it must travel with the image.
   */
  async toBlob(opts: { caption?: { project: string; place: string; date: Date }; credit?: string } = {}): Promise<Blob> {
    const src = this.canvas;
    const L = opts.caption ? captionLayout(src.width, opts.caption.project, opts.caption.place, opts.caption.date) : null;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height + (L?.stripHeight ?? 0);
    const g = out.getContext('2d');
    if (!g) throw new Error('Could not draw the picture.');
    g.drawImage(src, 0, 0);
    if (opts.credit && this.usedMap) {
      const px = Math.max(11, Math.round(src.width / 90));
      g.font = `${px}px "Segoe UI", system-ui, sans-serif`;
      const w = g.measureText(opts.credit).width + px;
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillRect(src.width - w, src.height - px * 1.7, w, px * 1.7);
      g.fillStyle = '#333333';
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.fillText(opts.credit, src.width - px * 0.5, src.height - px * 0.85);
    }
    if (L && opts.caption) {
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
    this.garden?.destroy();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.tracer = null;
    this.garden = null;
    this.renderer = null;
  }
}
