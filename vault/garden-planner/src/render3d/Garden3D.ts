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
import { FENCE_COLOUR, GRASS_COLOUR, MULCH_COLOUR, PATH_COLOUR, STRUCTURE_COLOUR } from '../render2d/theme';

const GROUND = '#9aa57a';
const SKY = '#cfe3ee';

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
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
  private controls: OrbitControls;
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

  constructor(private container: HTMLDivElement, private app: App) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 120, 400);
    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004; // stops the striped 'shadow acne' on flat roofs
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.content);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.addEventListener('change', () => { this.dirty = true; });

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.offs.push(() => ro.disconnect());
    this.offs.push(app.project.subscribe(() => this.rebuild()));
    this.offs.push(app.ui.subscribe((s, p) => {
      if (s.stage !== p.stage || s.month !== p.month) this.rebuild();
      else if (s.hour !== p.hour) this.updateSun();
    }));
    this.resize();
    this.rebuild();
    this.loop();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.offs.forEach((f) => f());
    this.controls.dispose();
    this.disposeContent();
    this.mapTex?.dispose();
    this.mapTex = null;
    this.renderer.dispose();
    this.renderer.domElement.remove();
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
    this.controls.target.set(b.cx, 0, b.cz);
    this.camera.position.set(b.cx + (dx / n) * d, (dy / n) * d, b.cz + (dz / n) * d);
    this.camera.up.set(0, 1, 0);
    this.controls.update();
    this.dirty = true;
    this.framed = true;
  }

  private resize(): void {
    const w = Math.max(100, this.container.clientWidth), h = Math.max(100, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * The satellite photo on the ground. A square canvas covering the plot and its surroundings is painted with the tiles (the same maths as
   * the 2D plan: anchored at plan (0, 0), turned by the north arrow, true to scale) and laid flat as a texture, so the sun's shadows land on it.
   * Returns whether the map is on and usable.
   */
  private addMap(p: GardenProject, c: THREE.Group): boolean {
    const ds = this.renderer.domElement.dataset;
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
      this.mapTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
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
    this.renderer.domElement.dataset.mapTiles = `${drawn}/${list.length}`;
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
    const ds = this.renderer.domElement.dataset;
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
