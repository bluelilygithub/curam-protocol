// The 3D view: a plain three.js scene rebuilt from the project when it (or the growth stage / month) changes. Plan (x, y) maps to three
// (x, up, -y), so north (+y on the plan) points away from the default camera and the view is not mirrored.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { App } from '../createApp';
import { pathSegments, sampleShape } from '../domain/shapes';
import { FENCE_HEIGHT, type GardenProject, type Structure, type Vec2 } from '../domain/types';
import { plantById } from '../plants/plants';
import { plantParts, type Part } from './plantParts';
import { MID_MONTH_DAY, solarPosition, sunDirectionOnPlan } from '../sun/solar';
import { placeFor } from '../sun/timezone';
import { MIN_SUN_ALTITUDE } from '../sun/shadows';
import type { View } from '@planner-core/adapters/canvas';
import { chooseZoom, metresPerPixel, TILE, visibleTiles, type LatLng } from '../map/mercator';
import type { Tour } from '@planner-core/render3d/tour';
import { buildGardenTour, buildTourWorld, countedIndex, countedStops, samplePose, TOUR_FOV } from '../walk/gardenTour';
import { buildWalkWorld, NO_INPUT, nearestWalkable, stepWalk, TURN_RATE, walkPose, walkStart, type WalkInput, type WalkState, type WalkWorld } from '../walk/walk';
import { FENCE_COLOUR, GRASS_COLOUR, MULCH_COLOUR, PATH_COLOUR, STRUCTURE_COLOUR } from '../render2d/theme';

const GROUND = '#9aa57a';
const SKY = '#cfe3ee';

/** Walk mode: how wide the view is (wider than the orbit camera, like standing in the garden), how far a drag turns, and the keys it listens to. */
export const WALK_FOV = 70;
const LOOK_RAD_PER_PX = 0.004;
const WALK_KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
const clampUnit = (n: number): number => Math.max(-1, Math.min(1, n));

const sphereG = new THREE.SphereGeometry(0.5, 14, 10);
const cylG = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
const coneG = new THREE.ConeGeometry(0.5, 1, 10);
const boxG = new THREE.BoxGeometry(1, 1, 1);
const GEO: Record<Part['shape'], THREE.BufferGeometry> = { sphere: sphereG, cylinder: cylG, cone: coneG, box: boxG };

const mat = (colour: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9, metalness: 0, ...o });

/** plan point to three xz */
const xz = (p: Vec2): [number, number] => [p.x, -p.y];

function shapeMesh(points: Vec2[], colour: string, y: number, depth = 0): THREE.Mesh {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, p.y)));
  const geo = depth > 0 ? new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
  // shape lies in the xy plane with z = extrusion; rotate so plan y becomes -z and extrusion becomes up
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat(colour, { side: THREE.DoubleSide }));
  m.position.y = y;
  m.receiveShadow = true;
  m.castShadow = depth > 0;
  return m;
}

export class Garden3D {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
  private controls: OrbitControls | null = null;
  /** Where the test hooks (data-sun-alt, data-map-tiles) go: the canvas when there is one, a scratch object when there is not. */
  private scratchDs: DOMStringMap = {};
  private sunAlt = 0;
  private sunAz = 0;
  private mapProgress: { drawn: number; total: number } | null = null;
  private content = new THREE.Group();
  private sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  private hemi = new THREE.HemisphereLight('#dbeafe', '#8a9a6a', 0.9);
  private offs: Array<() => void> = [];
  private raf = 0;
  private dirty = true;
  private framed = false;
  /** The satellite map as a texture on the ground: painted from the tile cache, repainted as tiles arrive. Kept across rebuilds. */
  private mapTex: THREE.CanvasTexture | null = null;
  private mapJob: { anchor: LatLng; north: number; view: View; z: number; size: number; pxPerM: number } | null = null;
  private mapPaintQueued = false;
  /** Walk mode: first person at eye height, with collision (see src/walk/walk.ts). Null when not walking. */
  /** The fly-through: the camera follows `tour` at time `t` while `playing`. */
  private tourRun: { tour: Tour; t: number; last: number; saved: { position: THREE.Vector3; target: THREE.Vector3; fov: number; near: number }; target: [number, number, number] } | null = null;
  /** A short glide to a saved view. */
  private glide: { from: THREE.Vector3; fromT: THREE.Vector3; to: THREE.Vector3; toT: THREE.Vector3; t0: number } | null = null;
  private walk: { state: WalkState; world: WalkWorld; saved: { position: THREE.Vector3; target: THREE.Vector3; fov: number; near: number }; keys: Set<string>; lookX: number; lookY: number; drag: number | null; last: number; off: Array<() => void> } | null = null;

  /**
   * `container` is where the live view draws. With `headless` (or no container) it builds the same scene without any screen, which is what
   * Render photo path-traces: see `snapshotApp` for feeding it a frozen copy of the garden.
   */
  constructor(private container: HTMLDivElement | null, private app: App, headless = false) {
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 120, 400);
    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004; // stops the striped 'shadow acne' on flat roofs
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.content);
    if (headless || !container) { this.rebuild(); return; }

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls = controls;
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.addEventListener('change', () => { this.dirty = true; });

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.offs.push(() => ro.disconnect());
    this.offs.push(this.app.project.subscribe(() => this.rebuild()));
    this.offs.push(this.app.ui.subscribe((s, p) => {
      if (s.stage !== p.stage || s.month !== p.month) this.rebuild();
      else if (s.hour !== p.hour) this.updateSun();
    }));
    this.app.view3d.current = this;
    this.resize();
    this.rebuild();
    this.loop();
  }

  /** A frozen copy of the garden and of the growth stage, month and time, for a headless scene: later edits do not touch a render in progress. */
  static snapshotApp(app: App): App {
    const frozen = <T,>(state: T) => ({ getState: () => state, subscribe: () => () => undefined });
    return { ...app, project: frozen({ ...app.project.getState() }), ui: frozen({ ...app.ui.getState() }) } as unknown as App;
  }

  private get ds(): DOMStringMap { return this.renderer?.domElement.dataset ?? this.scratchDs; }

  /** The camera as it is now (Render photo photographs from here). */
  cameraState(): { position: [number, number, number]; target: [number, number, number]; fov?: number } {
    if (this.walk) return { ...walkPose(this.walk.state), fov: WALK_FOV };
    if (this.tourRun) return { position: [this.camera.position.x, this.camera.position.y, this.camera.position.z], target: [...this.tourRun.target], fov: TOUR_FOV };
    const t = this.controls?.target ?? new THREE.Vector3();
    return { position: [this.camera.position.x, this.camera.position.y, this.camera.position.z], target: [t.x, t.y, t.z] };
  }

  // ---------------------------------------------------------------- fly-through
  get touring(): boolean { return this.tourRun !== null; }

  private buildTourNow(): Tour | null {
    const p = this.app.project.getState().project;
    const ov = this.presetPose('iso');
    if (!p || !ov) return null;
    const ui = this.app.ui.getState();
    return buildGardenTour(p, buildTourWorld(p, ui.stage), ov, ui.tourLoop);
  }

  /** Start the fly-through: the saved views when there are two or more, otherwise a tour chosen from the garden. False when there is nothing to fly through. */
  startTour(): boolean {
    if (this.tourRun || !this.renderer || !this.controls) return false;
    this.stopWalk();
    const tour = this.buildTourNow();
    if (!tour || countedStops(tour) < 2) return false;
    const saved = { position: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.camera.fov, near: this.camera.near };
    this.controls.enabled = false;
    this.glide = null;
    this.camera.fov = TOUR_FOV; this.camera.near = 0.05; this.camera.updateProjectionMatrix();
    this.tourRun = { tour, t: 0, last: performance.now(), saved, target: [0, 0, 0] };
    this.app.ui.getState().set({ tourState: 'playing', tourProgress: { stop: 0, total: countedStops(tour) } });
    this.applyTourPose();
    return true;
  }

  /** Play or pause the fly-through (the camera stays where it is while paused). */
  toggleTour(): void {
    const r = this.tourRun;
    if (!r) return;
    const ui = this.app.ui.getState();
    r.last = performance.now();
    ui.set({ tourState: ui.tourState === 'playing' ? 'paused' : 'playing' });
  }

  /** Back to the orbit camera exactly where it was. */
  stopTour(): void {
    const r = this.tourRun;
    if (!r) return;
    this.tourRun = null;
    if (this.controls) { this.controls.enabled = true; this.controls.target.copy(r.saved.target); }
    this.camera.position.copy(r.saved.position);
    this.camera.fov = r.saved.fov; this.camera.near = r.saved.near; this.camera.updateProjectionMatrix();
    this.camera.up.set(0, 1, 0);
    this.controls?.update();
    this.app.ui.getState().set({ tourState: 'off', tourProgress: null });
    this.dirty = true;
  }

  /** Looping or one pass: rebuild the path (the camera keeps its place in the tour). */
  refreshTour(): void {
    const r = this.tourRun;
    if (!r) return;
    const tour = this.buildTourNow();
    if (!tour || countedStops(tour) < 2) { this.stopTour(); return; }
    r.tour = tour;
    r.t = Math.min(r.t, tour.duration);
    this.app.ui.getState().set({ tourProgress: { stop: countedIndex(tour, r.t), total: countedStops(tour) } });
  }

  private applyTourPose(): void {
    const r = this.tourRun;
    if (!r) return;
    const pose = samplePose(r.tour, r.t);
    r.target = pose.target;
    this.camera.position.set(...pose.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(new THREE.Vector3(...pose.target));
    this.dirty = true;
    const ui = this.app.ui.getState();
    const stop = countedIndex(r.tour, r.t);
    if (ui.tourProgress?.stop !== stop) ui.set({ tourProgress: { stop, total: countedStops(r.tour) } });
    const ds = this.ds;
    ds.tourStop = String(stop); ds.tourT = r.t.toFixed(2); ds.tourY = pose.position[1].toFixed(2);
  }

  private tickTour(now: number): void {
    const r = this.tourRun;
    if (!r) return;
    const dt = Math.min(0.5, Math.max(0, (now - r.last) / 1000)); // a slow graphics card skips frames instead of slowing the tour
    r.last = now;
    if (this.app.ui.getState().tourState !== 'playing') return;
    r.t += dt;
    if (!r.tour.loop && r.t >= r.tour.duration) { r.t = r.tour.duration; this.applyTourPose(); this.stopTour(); return; }
    this.applyTourPose();
  }

  /** Move the camera to a saved view: a short glide, leaving walking or the tour first. */
  goTo(position: [number, number, number], target: [number, number, number]): void {
    this.stopTour(); this.stopWalk();
    if (!this.controls) return;
    this.glide = { from: this.camera.position.clone(), fromT: this.controls.target.clone(), to: new THREE.Vector3(...position), toT: new THREE.Vector3(...target), t0: performance.now() };
    this.dirty = true;
  }

  private tickGlide(now: number): void {
    const g = this.glide;
    if (!g || !this.controls) return;
    const u = Math.min(1, (now - g.t0) / 700);
    const e = u * u * (3 - 2 * u);
    this.camera.position.lerpVectors(g.from, g.to, e);
    this.controls.target.lerpVectors(g.fromT, g.toT, e);
    this.dirty = true;
    if (u >= 1) this.glide = null;
  }

  // ---------------------------------------------------------------- walk mode
  get walking(): boolean { return this.walk !== null; }

  /** Stand at the gate (or the middle of the plot) at eye height. False when there is nowhere free to stand. */
  startWalk(): boolean {
    const p = this.app.project.getState().project;
    if (!p || this.walk || !this.renderer || !this.controls) return false;
    this.stopTour();
    const world = buildWalkWorld(p, this.app.ui.getState().stage);
    const state = walkStart(world);
    if (!state) return false;
    const saved = { position: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.camera.fov, near: this.camera.near };
    const keys = new Set<string>();
    const off: Array<() => void> = [];
    const el = this.renderer.domElement;
    const typing = (t: EventTarget | null): boolean => { const n = (t as HTMLElement | null)?.tagName; return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || !!(t as HTMLElement | null)?.isContentEditable; };
    const down = (e: KeyboardEvent): void => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (WALK_KEYS.includes(k)) { keys.add(k); e.preventDefault(); }
    };
    const up = (e: KeyboardEvent): void => { keys.delete(e.key.toLowerCase()); };
    const blur = (): void => keys.clear();
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    off.push(() => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); });
    // drag on the picture to look around (a finger or the mouse); the walking pad is a separate control
    const w = { drag: null as number | null, x: 0, y: 0 };
    const pd = (e: PointerEvent): void => { w.drag = e.pointerId; w.x = e.clientX; w.y = e.clientY; el.setPointerCapture(e.pointerId); };
    const pm = (e: PointerEvent): void => { if (w.drag !== e.pointerId || !this.walk) return; this.walk.lookX += e.clientX - w.x; this.walk.lookY += e.clientY - w.y; w.x = e.clientX; w.y = e.clientY; };
    const pu = (e: PointerEvent): void => { if (w.drag === e.pointerId) w.drag = null; };
    el.addEventListener('pointerdown', pd); el.addEventListener('pointermove', pm); el.addEventListener('pointerup', pu); el.addEventListener('pointercancel', pu);
    off.push(() => { el.removeEventListener('pointerdown', pd); el.removeEventListener('pointermove', pm); el.removeEventListener('pointerup', pu); el.removeEventListener('pointercancel', pu); });

    this.controls.enabled = false;
    this.camera.fov = WALK_FOV; this.camera.near = 0.05; this.camera.updateProjectionMatrix();
    this.walk = { state, world, saved, keys, lookX: 0, lookY: 0, drag: null, last: performance.now(), off };
    this.app.ui.getState().set({ walking: true });
    this.applyWalkCamera();
    return true;
  }

  /** Back to the orbit camera exactly where it was. */
  stopWalk(): void {
    const w = this.walk;
    if (!w) return;
    w.off.forEach((f) => f());
    this.walk = null;
    if (this.controls) { this.controls.enabled = true; this.controls.target.copy(w.saved.target); }
    this.camera.position.copy(w.saved.position);
    this.camera.fov = w.saved.fov; this.camera.near = w.saved.near; this.camera.updateProjectionMatrix();
    this.camera.up.set(0, 1, 0);
    this.controls?.update();
    this.app.ui.getState().set({ walking: false });
    this.dirty = true;
  }

  private applyWalkCamera(): void {
    if (!this.walk) return;
    const pose = walkPose(this.walk.state);
    this.camera.position.set(...pose.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(new THREE.Vector3(...pose.target));
    this.dirty = true;
  }

  /** One frame of walking: read the keys, the pad and the drag, move with collision, point the camera. */
  private tickWalk(now: number): void {
    const w = this.walk;
    if (!w) return;
    const dt = Math.min(0.1, Math.max(0, (now - w.last) / 1000)); // a stalled tab does not teleport the walker
    w.last = now;
    const k = w.keys;
    const pad = this.app.walkInput;
    const input: WalkInput = {
      forward: clampUnit((k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) + pad.padY),
      strafe: clampUnit((k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0) + pad.padX),
      turn: ((k.has('arrowright') || k.has('e') ? 1 : 0) - (k.has('arrowleft') || k.has('q') ? 1 : 0)) * TURN_RATE,
      run: k.has('shift'),
      lookYaw: w.lookX * LOOK_RAD_PER_PX,
      lookPitch: -w.lookY * LOOK_RAD_PER_PX,
    };
    w.lookX = 0; w.lookY = 0;
    const moving = input.forward !== 0 || input.strafe !== 0 || input.turn !== 0 || input.lookYaw !== 0 || input.lookPitch !== 0;
    if (!moving) return;
    w.state = stepWalk(w.world, w.state, { ...NO_INPUT, ...input }, dt);
    this.applyWalkCamera();
    const ds = this.ds;
    ds.walkX = w.state.position.x.toFixed(2); ds.walkY = w.state.position.y.toFixed(2); ds.walkYaw = w.state.yaw.toFixed(3);
  }

  /** The garden changed (or grew) while walking: use the new obstacles, and step out of anything that has appeared under the walker. */
  private refreshWalkWorld(): void {
    const w = this.walk;
    const p = this.app.project.getState().project;
    if (!w || !p) return;
    w.world = buildWalkWorld(p, this.app.ui.getState().stage);
    const here = nearestWalkable(w.world, w.state.position);
    if (here) w.state = { ...w.state, position: here };
    this.applyWalkCamera();
  }

  /** The camera of the Iso, Front or Top buttons, without moving the live view. */
  presetPose(kind: 'iso' | 'front' | 'top'): { position: [number, number, number]; target: [number, number, number] } | null {
    const p = this.app.project.getState().project;
    if (!p) return null;
    const [dx, dy, dz] = kind === 'iso' ? [1, 0.8, 1] : kind === 'front' ? [0, 0.45, 1] : [0, 1, 0.001];
    const b = this.bounds(p);
    const d = b.r * 2.3, n = Math.hypot(dx, dy, dz);
    return { position: [b.cx + (dx / n) * d, (dy / n) * d, b.cz + (dz / n) * d], target: [b.cx, 0, b.cz] };
  }

  /** Where the sun is for the garden, month and time on show (degrees above the horizon, and the compass bearing). */
  sunPosition(): { altitude: number; azimuth: number } { return { altitude: this.sunAlt, azimuth: this.sunAz }; }

  /** What a path tracer needs: the scene (ground, house, plants, sun) and the sun light, ready for it to adopt. */
  get photo(): { scene: THREE.Scene; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight } { return { scene: this.scene, sun: this.sun, hemi: this.hemi }; }

  /** Wait (up to `timeoutMs`) until the satellite tiles the ground needs have arrived, repainting as they do. Resolves at once when the map is off. */
  async ready(timeoutMs = 20000): Promise<void> {
    const t0 = Date.now();
    while (this.mapJob && Date.now() - t0 < timeoutMs) {
      this.paintMap();
      const p = this.mapProgress;
      if (p && p.total > 0 && p.drawn >= p.total) return;
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  destroy(): void {
    this.stopWalk();
    this.stopTour();
    cancelAnimationFrame(this.raf);
    this.offs.forEach((f) => f());
    this.controls?.dispose();
    this.disposeContent();
    this.mapTex?.dispose();
    this.mapTex = null;
    if (this.app.view3d.current === this) this.app.view3d.current = null;
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }

  /** Camera presets. */
  iso(): void { this.frame(1, 0.8, 1); }
  top(): void { this.frame(0, 1, 0.001); }
  front(): void { this.frame(0, 0.45, 1); }

  private bounds(p: GardenProject): { cx: number; cz: number; r: number } {
    const pts: Vec2[] = [];
    if (p.boundary) pts.push(...p.boundary.vertices.map((v) => v.position));
    if (p.house) pts.push(...p.house.vertices.map((v) => v.position));
    for (const b of p.beds) pts.push(...sampleShape(b.shape));
    if (!pts.length) return { cx: 8, cz: -6, r: 12 };
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { cx: (x0 + x1) / 2, cz: -(y0 + y1) / 2, r: Math.max(6, Math.hypot(x1 - x0, y1 - y0) / 2) };
  }

  private frame(dx: number, dy: number, dz: number): void {
    const p = this.app.project.getState().project;
    if (!p) return;
    const b = this.bounds(p);
    const d = b.r * 2.3;
    const n = Math.hypot(dx, dy, dz);
    this.controls?.target.set(b.cx, 0, b.cz);
    this.camera.position.set(b.cx + (dx / n) * d, (dy / n) * d, b.cz + (dz / n) * d);
    this.camera.up.set(0, 1, 0);
    this.controls?.update();
    this.dirty = true;
    this.framed = true;
  }

  private resize(): void {
    if (!this.renderer || !this.container) return;
    const w = Math.max(100, this.container.clientWidth), h = Math.max(100, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.walk) this.tickWalk(performance.now()); else if (this.tourRun) this.tickTour(performance.now()); else { this.tickGlide(performance.now()); this.controls?.update(); }
    if (!this.dirty || !this.renderer) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * The satellite photo on the ground. A square canvas covering the plot and its surroundings is painted with the tiles (the same maths as
   * the 2D plan: anchored at plan (0, 0), turned by the north arrow, true to scale) and laid flat as a texture, so the sun's shadows land on it.
   * Returns whether the map is on and usable.
   */
  private addMap(p: GardenProject, c: THREE.Group): boolean {
    const ds = this.ds;
    const m = p.map;
    this.mapJob = null;
    if (!m?.on) { ds.mapTiles = 'off'; return false; }
    const tiles = this.app.mapTiles;
    const st = tiles.peekStatus();
    if (!st) { ds.mapTiles = 'pending'; void tiles.status().then(() => this.rebuild()); return false; }
    if (!st.enabled) { ds.mapTiles = 'unavailable'; return false; }
    const b = this.bounds(p);
    const centre = { x: b.cx, y: -b.cz };
    const S = Math.min(320, Math.max(60, b.r * 3));
    const anchor = { lat: m.lat, lng: m.lng };
    const pxPerM = Math.min(2048 / S, 1 / metresPerPixel(st.maxZoom, anchor.lat)); // never finer than the imagery
    const size = Math.max(64, Math.round(S * pxPerM));
    if (!this.mapTex || (this.mapTex.image as HTMLCanvasElement).width !== size) {
      this.mapTex?.dispose();
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      this.mapTex = new THREE.CanvasTexture(canvas);
      this.mapTex.colorSpace = THREE.SRGBColorSpace;
      this.mapTex.anisotropy = this.renderer?.capabilities.getMaxAnisotropy() ?? 4;
    }
    // plan -> canvas: x = offsetX + wx * scale, y = offsetY - wy * scale, with the canvas covering the square S x S around the plot centre
    const view = { scale: pxPerM, offsetX: -(centre.x - S / 2) * pxPerM, offsetY: (centre.y + S / 2) * pxPerM } as View;
    this.mapJob = { anchor, north: p.northDeg, view, z: chooseZoom(pxPerM, anchor.lat, st.maxZoom), size, pxPerM };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshStandardMaterial({ map: this.mapTex, roughness: 1, metalness: 0, transparent: m.opacity < 1, opacity: m.opacity }));
    mesh.rotation.x = -Math.PI / 2; // texture top = plan +y (north when the north arrow is up), as on the plan
    mesh.position.set(centre.x, 0.004, -centre.y);
    mesh.receiveShadow = true;
    c.add(mesh);
    this.paintMap();
    return true;
  }

  private paintMap(): void {
    const job = this.mapJob;
    const tex = this.mapTex;
    if (!job || !tex) return;
    const canvas = tex.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = GROUND; // where a tile has not arrived yet the ground colour shows
    ctx.fillRect(0, 0, job.size, job.size);
    const list = visibleTiles(job.anchor, job.north, job.view, job.size, job.size, job.z, 160);
    const s = metresPerPixel(job.z, job.anchor.lat) * job.pxPerM;
    ctx.setTransform(1, 0, 0, 1, job.view.offsetX, job.view.offsetY);
    ctx.rotate((job.north * Math.PI) / 180);
    ctx.scale(s, s);
    let drawn = 0;
    for (const q of list) {
      const img = this.app.mapTiles.tile(q.z, q.x, q.y, () => this.queueMapPaint());
      if (img) { ctx.drawImage(img, q.px, q.py, TILE + 0.6, TILE + 0.6); drawn += 1; }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    tex.needsUpdate = true;
    this.dirty = true;
    this.mapProgress = { drawn, total: list.length };
    this.ds.mapTiles = `${drawn}/${list.length}`;
  }

  private queueMapPaint(): void {
    if (this.mapPaintQueued) return;
    this.mapPaintQueued = true;
    requestAnimationFrame(() => { this.mapPaintQueued = false; this.paintMap(); });
  }

  private disposeContent(): void {
    this.content.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        if (!Object.values(GEO).includes(m.geometry)) m.geometry.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      }
    });
    this.content.clear();
  }

  // ---------------------------------------------------------------- building the scene
  private rebuild(): void {
    const p = this.app.project.getState().project;
    this.disposeContent();
    if (!p) { this.dirty = true; return; }
    const ui = this.app.ui.getState();
    const c = this.content;

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), mat(GROUND));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    c.add(ground);
    const mapOn = this.addMap(p, c);
    // with the aerial photo on, flat fills let it show through (the same as the 2D plan)
    const soft = (m: THREE.Mesh): THREE.Mesh => { if (mapOn) { const x = m.material as THREE.MeshStandardMaterial; x.transparent = true; x.opacity = 0.55; } return m; };

    for (const l of p.lawns) c.add(soft(shapeMesh(sampleShape(l.shape), GRASS_COLOUR[l.grass], 0.012)));
    for (const z of p.zones) void z; // zones are plan-only
    for (const b of p.beds) {
      const poly = sampleShape(b.shape);
      const bedMesh = shapeMesh(poly, MULCH_COLOUR[b.mulch], b.raised ? 0.35 : 0.02, b.raised ? 0.02 : 0);
      c.add(b.raised ? bedMesh : soft(bedMesh));
      if (b.raised) c.add(this.rim(poly, 0.35, '#8a6a44'));
    }
    for (const pa of p.paths) for (const q of pathSegments(pa.points, pa.width)) c.add(soft(shapeMesh(q, PATH_COLOUR[pa.material], 0.025)));
    if (p.house) {
      const m = shapeMesh(p.house.vertices.map((v) => v.position), '#e8e2d6', 0, p.house.height);
      c.add(m);
      const roof = shapeMesh(p.house.vertices.map((v) => v.position), '#8f8a80', p.house.height, 0.25);
      roof.castShadow = true;
      c.add(roof);
    }
    if (p.boundary) {
      const v = p.boundary.vertices;
      for (let i = 0; i < v.length; i++) c.add(this.fence(v[i].position, v[(i + 1) % v.length].position, p.boundary.segments[i]?.fence ?? 'open', p.boundary.segments[i]?.height));
    }
    for (const s of p.structures) c.add(this.structure(s));
    for (const inst of p.plants) {
      const rec = plantById(inst.plantId);
      if (!rec) continue;
      c.add(this.plant(plantParts(rec, ui.stage, ui.month, inst.id), inst.position, p.plants.length > 250));
    }

    this.updateSun();
    if (!this.framed) this.iso();
    this.refreshWalkWorld();
    this.refreshTour();
    this.dirty = true;
  }

  /**
   * Put the sun where it really is for the garden's latitude and longitude, the chosen month and time of day, and the plan's north arrow.
   * Southern hemisphere: in most of Australia it crosses the northern sky. Dims and warms toward the horizon and goes out at night.
   */
  updateSun(): void {
    const p = this.app.project.getState().project;
    if (!p) return;
    const ui = this.app.ui.getState();
    const sun = solarPosition(placeFor(p.location, ui.month), ui.month, MID_MONTH_DAY, ui.hour);
    const b = this.bounds(p);
    const alt = sun.altitude;
    const up = alt > 0;
    if (up) {
      const dir = sunDirectionOnPlan(sun.azimuth, p.northDeg);
      const altR = (alt * Math.PI) / 180;
      const R = 70;
      // plan (x, y) is three (x, -y)
      this.sun.position.set(b.cx + dir.x * Math.cos(altR) * R, Math.sin(altR) * R, b.cz - dir.y * Math.cos(altR) * R);
    } else {
      this.sun.position.set(b.cx, 40, b.cz);
    }
    this.sun.target.position.set(b.cx, 0, b.cz);
    const low = Math.max(0, Math.min(1, alt / 25)); // 0 at the horizon, 1 once the sun is well up
    this.sun.intensity = up ? 2.4 * Math.pow(Math.max(0, Math.sin((Math.max(alt, 0) * Math.PI) / 180)), 0.5) * (0.35 + 0.65 * low) : 0;
    this.sun.color.set(new THREE.Color('#ff9a50').lerp(new THREE.Color('#fff4e0'), low));
    this.sun.castShadow = alt > MIN_SUN_ALTITUDE;
    const r = Math.max(15, b.r * 1.4);
    const cam = this.sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 200;
    cam.updateProjectionMatrix();
    // sky and ambient light: bright by day, orange at the horizon, dark at night
    const day = new THREE.Color(SKY), dusk = new THREE.Color('#f0b890'), night = new THREE.Color('#141c33');
    const sky = alt >= 8 ? day : alt > 0 ? dusk.clone().lerp(day, alt / 8) : alt > -8 ? night.clone().lerp(dusk, (alt + 8) / 8) : night;
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.hemi.intensity = alt >= 15 ? 0.9 : alt > -8 ? 0.2 + 0.7 * ((alt + 8) / 23) : 0.2;
    // exposed for the browser tests: where the light is relative to the garden centre, and how bright
    this.sunAlt = alt; this.sunAz = sun.azimuth;
    const ds = this.ds;
    ds.sunAlt = alt.toFixed(1); ds.sunAz = sun.azimuth.toFixed(1); ds.sunIntensity = this.sun.intensity.toFixed(2);
    ds.sunDx = (this.sun.position.x - b.cx).toFixed(1); ds.sunDz = (this.sun.position.z - b.cz).toFixed(1);
    this.dirty = true;
  }

  private rim(poly: Vec2[], y: number, colour: string): THREE.Line {
    const pts = [...poly, poly[0]].map((q) => new THREE.Vector3(q.x, y + 0.01, -q.y));
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: colour }));
  }

  private fence(a: Vec2, b: Vec2, kind: keyof typeof FENCE_COLOUR, heightOverride?: number): THREE.Mesh {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 0.01;
    const h = heightOverride ?? FENCE_HEIGHT[kind];
    const thick = kind === 'hedge' ? 0.6 : 0.06;
    const hh = kind === 'open' ? 0.05 : Math.max(h, 0.05);
    const m = new THREE.Mesh(boxG, mat(FENCE_COLOUR[kind], kind === 'open' ? { transparent: true, opacity: 0.5 } : {}));
    m.scale.set(len, hh, thick);
    m.position.set((a.x + b.x) / 2, hh / 2, -(a.y + b.y) / 2);
    m.rotation.y = Math.atan2(b.y - a.y, b.x - a.x); // the plan angle: with z = -y a counter-clockwise plan turn is the same y rotation
    m.castShadow = kind !== 'open';
    m.receiveShadow = true;
    return m;
  }

  private structure(s: Structure): THREE.Object3D {
    const g = new THREE.Group();
    const col = STRUCTURE_COLOUR[s.kind];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, colour = col): void => {
      const m = new THREE.Mesh(boxG, mat(colour));
      m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m);
    };
    const hw = s.width / 2, hl = Math.max(s.length, 0.1) / 2;
    switch (s.kind) {
      case 'shed': box(s.width, s.height, s.length, 0, s.height / 2, 0); box(s.width + 0.2, 0.12, s.length + 0.2, 0, s.height + 0.06, 0, '#7a7a74'); break;
      case 'deck': box(s.width, Math.max(s.height, 0.1), s.length, 0, Math.max(s.height, 0.1) / 2, 0); break;
      case 'pergola':
        for (const [x, z] of [[-hw, -hl], [hw, -hl], [-hw, hl], [hw, hl]]) box(0.12, s.height, 0.12, x, s.height / 2, z);
        for (let i = 0; i <= 8; i++) box(0.06, 0.1, s.length + 0.3, -hw + (s.width * i) / 8, s.height + 0.05, 0);
        break;
      case 'raised_bed': box(s.width, s.height, s.length, 0, s.height / 2, 0); box(s.width - 0.15, 0.04, s.length - 0.15, 0, s.height + 0.01, 0, '#5a4630'); break;
      case 'water_tank': { const m = new THREE.Mesh(cylG, mat(col)); m.scale.set(s.width, s.height, s.width); m.position.y = s.height / 2; m.castShadow = true; g.add(m); break; }
      case 'clothesline':
        box(0.06, s.height, 0.06, 0, s.height / 2, 0, '#8a8a84');
        box(s.width, 0.02, 0.02, 0, s.height, 0, '#cfcfc8'); box(0.02, 0.02, s.length, 0, s.height, 0, '#cfcfc8');
        break;
      case 'pool': box(s.width, 0.04, s.length, 0, 0.02, 0, '#59b8dd'); box(s.width + 0.4, 0.08, s.length + 0.4, 0, 0.0, 0, '#d8d4c8'); break;
      case 'retaining_wall': box(s.width, s.height, Math.max(s.length, 0.2), 0, s.height / 2, 0); break;
      case 'trellis': box(s.width, s.height, 0.05, 0, s.height / 2, 0); break;
      case 'gate': box(s.width, s.height, 0.05, 0, s.height / 2, 0); break;
    }
    g.position.set(s.position.x, 0, -s.position.y);
    g.rotation.y = s.rotation;
    return g;
  }

  private plant(parts: Part[], at: Vec2, skipFlowers: boolean): THREE.Group {
    const g = new THREE.Group();
    for (const q of parts) {
      if (skipFlowers && q.role === 'flower') continue;
      const m = new THREE.Mesh(GEO[q.shape], mat(q.colour, { flatShading: true, roughness: 0.8 }));
      m.scale.set(...q.size);
      m.position.set(...q.position);
      if (q.rotationY !== undefined) {
        // radiate outwards from the plant centre and lean away from the axis
        m.rotation.order = 'YZX';
        m.rotation.y = q.rotationY;
        if (q.tilt) m.rotation.z = -q.tilt;
        if (q.shape === 'box') m.position.x += Math.cos(q.rotationY) * q.size[0] * 0.45, m.position.z -= Math.sin(q.rotationY) * q.size[0] * 0.45;
      }
      m.castShadow = q.role !== 'flower';
      m.receiveShadow = true;
      g.add(m);
    }
    const [x, z] = xz(at);
    g.position.set(x, 0, z);
    return g;
  }
}
