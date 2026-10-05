// The 3D scene, built imperatively with three.js (D40) and mounted by R3F as one <primitive>. It is a pure renderer of the same
// project the 2D view draws: committed objects are rebuilt from the project on change (low frequency), while drag/ghost previews
// arrive over the feedback bus and move cached objects without touching any store (A12). No DOM, so the whole scene, picking
// and drag behaviour can be tested in Node.
import * as THREE from 'three';
import { deriveStatus } from '../engine/wallEdit';
import type { SelectionRef } from '../engine/selection';
import type { Fixture, FurnitureInstance, Project, Room, Vec2 } from '../engine/types';
import type { FeedbackBus, FeedbackState, PreviewObject } from '../state/feedbackBus';
import type { ProjectStore } from '../state/projectStore';
import type { UiStore } from '../state/uiStore';
import { roomBounds } from './cameraPresets';
import { fixtureModel } from './fixtureParts';
import { furnitureParts, type Part } from './furnitureParts';
import { partGeometry } from './partGeometry';
import { LIGHT_EMITTERS } from '../data/furnitureLibrary';
import { paletteOf, type Palette } from '../data/palettes';
import { lookOf, MaterialCache, realisticFixtureLook, realisticLookOf, TINT, type Tint } from './materials';
import { textureOf } from './textures';
import { instanceTransform } from './transforms';
import { wallsToFade } from './wallFade';
import { prism, skirtingPieces, wallPieces } from './wallPieces';

export interface Scene3DPorts {
  project: ProjectStore;
  ui: UiStore;
  bus: FeedbackBus;
  /** Ask the host to draw a frame (the canvas renders on demand). */
  invalidate: () => void;
  /** Called when an invalid-release animation has finished (the interaction then clears its preview). */
  onAnimationDone?: () => void;
  /** Length of the animate-back (A11). 0 finishes immediately. */
  animateMs?: number;
  schedule?: (fn: () => void) => void;
  now?: () => number;
}

export const FADED_WALL_OPACITY = 0.12;
const WALL_COLOUR = '#ddd6c8';
const FLOOR_COLOUR = '#e6dfd0';
/** Cinematic (clay) look, Spec Addition A1: one white matte material for everything, a slightly darker floor to separate the planes. */
export const CLAY_COLOUR = '#f3f1ec';
export const CLAY_FLOOR_COLOUR = '#d9d6cf';
/** Shadow-map size per Quality level. */
export const SHADOW_MAP_BY_QUALITY = { low: 1024, high: 2048 } as const;
export const CLAY_SUN = 2.6;
export const CLAY_AMBIENT = 0.35;
/** Realistic look (Spec Addition A2): warm daylight, a soft fill, painted plaster walls and oak boards. */
export const REAL_SUN = 3.4;
export const REAL_AMBIENT = 0.25;
export const REAL_WALL_COLOUR = '#efe9de';
export const REAL_FLOOR_COLOUR = '#c79a62';
export const REAL_SKIRTING_COLOUR = '#f3f0ea';

/** Everything is the same white matte clay; glass stays a pale translucent pane so openings still read. */
function clayLook(role: string): { colour: string; roughness: number; metalness: number; opacity: number } {
  return role === 'glass'
    ? { colour: '#ffffff', roughness: 0.2, metalness: 0, opacity: 0.3 }
    : { colour: CLAY_COLOUR, roughness: 1, metalness: 0, opacity: 1 };
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 32);

export interface PickHit { ref: SelectionRef; distance: number; point: THREE.Vector3 }

interface PreviewEntry { group: THREE.Group; sig: string }

function partMesh(part: Part, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(partGeometry(part), material);
  m.position.set(part.centre[0], part.centre[1], part.centre[2]);
  m.castShadow = part.role !== 'glass';
  m.receiveShadow = true;
  return m;
}

function pickBox(ref: SelectionRef, size: [number, number, number], centre: [number, number, number]): THREE.Mesh {
  const m = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial());
  m.scale.set(size[0], size[1], size[2]);
  m.position.set(centre[0], centre[1], centre[2]);
  m.visible = false; // never drawn, but still hit by the ray cast
  m.userData = { ref };
  return m;
}

const sig = (o: unknown): string => JSON.stringify(o);

export class Scene3D {
  readonly root = new THREE.Group();
  /** Everything built from the project; offset by the floor elevation. */
  private readonly committed = new THREE.Group();
  private readonly previews = new THREE.Group();
  private readonly selectionLines = new THREE.Group();
  private readonly materials = new MaterialCache();
  /**
   * Spec §8 gives ambient ≈ 0.6 and directional ≈ 0.8, which are legacy three.js units; since r155 lights are physical and a
   * Lambert surface is albedo/π as bright, so the same look needs × π (D46).
   */
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0.6 * Math.PI);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 0.8 * Math.PI);

  private readonly furnitureObjects = new Map<string, THREE.Object3D>();
  private readonly fixtureObjects = new Map<string, THREE.Object3D>();
  private readonly wallMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly pickables: THREE.Object3D[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private previewEntries = new Map<string, PreviewEntry>();

  private faded = new Set<string>();
  private lastCamera: { plan: Vec2; polar: number } | null = null;
  private animating = false;
  private unsub: Array<() => void> = [];
  private lastProject: Project | null = null;
  private disposed = false;

  /** Rebuilds of the committed scene so far (tests: pointer moves must not cause any). */
  rebuildCount = 0;
  private lookKey = '';
  private readonly skirting = new Map<string, THREE.Mesh[]>();

  constructor(private readonly p: Scene3DPorts) {
    this.root.name = 'room-planner-3d';
    this.materials.onLoad = () => this.p.invalidate();
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.root.add(this.ambient, this.sun, this.sun.target, this.committed, this.previews, this.selectionLines);

    this.applyLighting();
    this.rebuild();
    this.applySelection();
    this.applyBus(p.bus.get());
    let lastSel = p.ui.getState().selection;
    this.unsub.push(
      p.project.subscribe((s) => {
        if (s.project !== this.lastProject) { this.rebuild(); this.applySelection(); this.applyBus(this.p.bus.get()); this.p.invalidate(); }
      }),
      p.ui.subscribe((s) => {
        if (s.selection !== lastSel) { lastSel = s.selection; this.applySelection(); this.p.invalidate(); }
        if (this.currentLookKey() !== this.lookKey) {
          this.applyLighting();
          this.rebuild();
          this.applySelection();
          this.applyBus(this.p.bus.get());
          this.p.invalidate();
        }
      }),
      p.bus.subscribe((b) => { this.applyBus(b); this.p.invalidate(); }),
    );
  }

  // ------------------------------------------------------------------ queries (tests, controller)

  furnitureObject(id: string): THREE.Object3D | undefined { return this.furnitureObjects.get(id); }
  fixtureObject(id: string): THREE.Object3D | undefined { return this.fixtureObjects.get(id); }
  wallMaterial(id: string): THREE.MeshStandardMaterial | undefined { return this.wallMaterials.get(id); }
  get fadedWalls(): string[] { return [...this.faded].sort(); }
  /** Number of selection boxes currently drawn. */
  get selectionOutlineCount(): number { return this.selectionLines.children.length; }
  /** The preview object currently shown for a dragged/ghost id. */
  previewObject(id: string): THREE.Object3D | undefined { return this.previewEntries.get(id)?.group; }
  get previewCount(): number { return this.previewEntries.size; }

  // ------------------------------------------------------------------ look (Cinematic)

  private get cinematic(): boolean { return this.p.ui.getState().cinematic; }
  /** Which materials the committed scene uses: the ordinary role colours, the clay model, or the realistic textured look. */
  private get mode(): 'ordinary' | 'clay' | 'realistic' { const u = this.p.ui.getState(); return u.cinematic ? u.look : 'ordinary'; }
  private currentLookKey(): string { const u = this.p.ui.getState(); return `${u.cinematic}|${u.quality}|${u.look}|${u.lightsOn}`; }
  /** The room's colour palette, unless the clay look is showing (clay is white by design). */
  private get palette(): Palette | undefined { return this.mode === 'clay' ? undefined : paletteOf(this.room?.palette); }

  /** Light levels and shadow-map size for the current look and Quality. The renderer sets the shadow type and the environment. */
  private applyLighting(): void {
    const u = this.p.ui.getState();
    this.lookKey = this.currentLookKey();
    const size = SHADOW_MAP_BY_QUALITY[u.quality];
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    const mode = this.mode;
    if (mode === 'realistic') {
      this.sun.intensity = REAL_SUN;
      this.sun.color.set('#ffe7c7');
      this.ambient.intensity = REAL_AMBIENT;
      this.sun.shadow.radius = 5;
      this.sun.shadow.blurSamples = 16;
    } else if (mode === 'clay') {
      this.sun.intensity = CLAY_SUN;
      this.sun.color.set('#ffffff');
      this.ambient.intensity = CLAY_AMBIENT;
      this.sun.shadow.radius = 8;
      this.sun.shadow.blurSamples = 16;
    } else {
      this.sun.intensity = 0.8 * Math.PI;
      this.sun.color.set('#ffffff');
      this.ambient.intensity = 0.6 * Math.PI;
      this.sun.shadow.radius = 1;
    }
  }

  /** Visibility of committed objects: hidden while previewed, and (cinematic) openings on cut-away walls are cut away with them. */
  private syncVisibility(): void {
    const hidden = new Set(this.p.bus.get().hiddenIds);
    const room = this.room;
    for (const [id, o] of this.furnitureObjects) o.visible = !hidden.has(id);
    for (const [id, o] of this.fixtureObjects) {
      const wall = room?.fixtures.find((f) => f.id === id)?.wallId;
      o.visible = !hidden.has(id) && !(this.cinematic && wall !== undefined && this.faded.has(wall));
    }
  }

  // ------------------------------------------------------------------ build

  private get room(): Room | undefined { return this.p.project.getState().project?.rooms[0]; }

  private clearCommitted(): void {
    this.committed.clear();
    this.furnitureObjects.clear();
    this.fixtureObjects.clear();
    this.wallMaterials.clear();
    this.skirting.clear();
    this.pickables.length = 0;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  private furnitureGroup(inst: FurnitureInstance, project: Project, tint: Tint, opacity = 1): THREE.Group {
    const g = new THREE.Group();
    for (const part of furnitureParts(inst.definitionId, inst.width, inst.length, inst.height)) {
      const mode = this.mode;
      const look = mode === 'clay'
        ? { ...clayLook(part.role), tint: null as Tint }
        : mode === 'realistic'
          ? { ...realisticLookOf(inst.definitionId, part, inst, project.materials, this.palette, this.p.ui.getState().lightsOn, part.role === 'picture' && inst.imageId && project.images?.[inst.imageId] ? { id: inst.imageId, dataUrl: project.images[inst.imageId].dataUrl } : undefined), tint: null as Tint }
          : { ...lookOf(part.role, inst, project.materials), tint };
      look.opacity = Math.min(look.opacity, opacity);
      g.add(partMesh(part, this.materials.get(look)));
    }
    // a lamp or ceiling light lights the room (Realistic look only; clay is lit by the studio light alone)
    const emitter = LIGHT_EMITTERS[inst.definitionId];
    if (emitter && opacity >= 1 && this.mode === 'realistic' && this.p.ui.getState().lightsOn) {
      const light = new THREE.PointLight(emitter.colour, emitter.intensity, 0, 2);
      light.position.set(0, inst.height * emitter.atFraction + (inst.definitionId === 'floor-lamp' ? 0 : 0.01), 0);
      light.castShadow = false;
      light.name = 'lamp-light';
      g.add(light);
    }
    const t = instanceTransform(inst);
    g.position.set(...t.position);
    g.rotation.y = t.rotationY;
    return g;
  }

  private fixtureGroup(room: Room, f: Fixture, tint: Tint, opacity = 1): THREE.Group | null {
    const model = fixtureModel(room, f);
    if (!model) return null;
    const g = new THREE.Group();
    for (const part of model.parts) {
      const mode = this.mode;
      const look = mode === 'clay'
        ? { ...clayLook(part.role), tint: null as Tint }
        : mode === 'realistic'
          ? { ...realisticFixtureLook(part.role, this.p.project.getState().project?.materials ?? [], this.palette), tint: null as Tint }
          : { ...lookOf(part.role, undefined, []), tint: part.role === 'glass' ? null : tint };
      look.opacity = Math.min(look.opacity, opacity);
      g.add(partMesh(part, this.materials.get(look)));
    }
    g.position.set(...model.position);
    g.rotation.y = model.rotationY;
    return g;
  }

  /** Resolves when every photo the scene shows has finished loading (a path-traced picture must not start with a blank frame). */
  ready(): Promise<void> { return this.materials.ready(); }

  rebuild(): void {
    this.rebuildCount++;
    this.clearCommitted();
    const project = this.p.project.getState().project;
    this.lastProject = project;
    const room = project?.rooms[0];
    if (!project || !room) return;
    this.committed.position.y = room.floorElevation;
    const status = deriveStatus(project);
    const tintOf = (id: string): Tint => { const s = status.get(id); return s === 'hard' ? 'hard' : s === 'soft' ? 'soft' : null; };

    // floor
    const floor = this.floorMesh(room);
    if (floor) this.committed.add(floor);

    // walls: one material per wall so a wall can fade on its own
    for (const w of room.walls) {
      const mode = this.mode;
      const mat = mode === 'realistic'
        ? new THREE.MeshStandardMaterial({ color: this.palette?.wall ?? REAL_WALL_COLOUR, roughness: 0.7, metalness: 0, map: textureOf('plaster'), bumpMap: textureOf('plaster'), bumpScale: 0.35 })
        : new THREE.MeshStandardMaterial({ color: mode === 'clay' ? CLAY_COLOUR : (this.palette?.wall ?? WALL_COLOUR), roughness: mode === 'clay' ? 1 : 0.9, metalness: 0 });
      this.wallMaterials.set(w.id, mat);
      this.disposables.push(mat);
    }
    for (const piece of wallPieces(room)) {
      const m = prism(piece.polygon, piece.y0, piece.y1);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(m.uvs, 2));
      geo.setIndex(m.indices);
      this.disposables.push(geo);
      const mesh = new THREE.Mesh(geo, this.wallMaterials.get(piece.wallId));
      mesh.castShadow = false; // the sun sits outside the room; walls that cast would darken the interior whenever it is behind them (D46)
      mesh.receiveShadow = true;
      mesh.userData = { ref: { kind: 'wall', id: piece.wallId } satisfies SelectionRef };
      this.committed.add(mesh);
      this.pickables.push(mesh);
    }

    // skirting boards (Realistic look): a low painted board along each wall, interrupted at doors
    if (this.mode === 'realistic') {
      const skirtMat = new THREE.MeshStandardMaterial({ color: this.palette?.trim ?? REAL_SKIRTING_COLOUR, roughness: 0.55, metalness: 0, map: textureOf('paint') });
      this.disposables.push(skirtMat);
      for (const piece of skirtingPieces(room)) {
        const m = prism(piece.polygon, piece.y0, piece.y1);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(m.uvs, 2));
        geo.setIndex(m.indices);
        this.disposables.push(geo);
        const mesh = new THREE.Mesh(geo, skirtMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = 'skirting';
        this.committed.add(mesh);
        const list = this.skirting.get(piece.wallId) ?? [];
        list.push(mesh);
        this.skirting.set(piece.wallId, list);
      }
    }

    // doors and windows
    for (const f of room.fixtures) {
      const g = this.fixtureGroup(room, f, tintOf(f.id));
      if (!g) continue;
      const wall = room.walls.find((w) => w.id === f.wallId);
      const t = wall?.thickness ?? 0.15;
      g.add(pickBox({ kind: 'fixture', id: f.id }, [f.width, f.height, t], [0, f.elevation + f.height / 2, -t / 2]));
      g.traverse((o) => { if (o.userData.ref) this.pickables.push(o); });
      this.committed.add(g);
      this.fixtureObjects.set(f.id, g);
    }

    // furniture
    for (const inst of room.furniture) {
      const g = this.furnitureGroup(inst, project, tintOf(inst.id));
      g.add(pickBox({ kind: 'furniture', id: inst.id }, [inst.width, inst.height, inst.length], [0, inst.height / 2, 0]));
      g.traverse((o) => { if (o.userData.ref) this.pickables.push(o); });
      this.committed.add(g);
      this.furnitureObjects.set(inst.id, g);
    }

    // lighting and shadow volume follow the room
    const b = roomBounds(room);
    const k = Math.max(1, b.radius / 6);
    this.sun.position.set(b.centre[0] + 5 * k, b.centre[1] + 10 * k, b.centre[2] + 5 * k);
    this.sun.target.position.set(b.centre[0], 0, b.centre[2]);
    const cam = this.sun.shadow.camera;
    const r = b.radius * 1.25;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 0.5; cam.far = 40 * k;
    cam.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();

    this.reapplyFade();
  }

  private floorMesh(room: Room): THREE.Mesh | null {
    const pts = room.vertices.map((v) => new THREE.Vector2(v.position.x, v.position.y));
    if (pts.length < 3) return null;
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    for (const t of tris) {
      let [a, b, c] = t.map((i) => pts[i]);
      // keep the face pointing up whatever the polygon's orientation
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross > 0) [b, c] = [c, b]; // plan CCW → three (x, z) is mirrored, so up-facing needs the reverse order
      for (const p of [a, b, c]) { positions.push(p.x, 0, p.y); normals.push(0, 1, 0); uvs.push(p.x, p.y); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.disposables.push(geo);
    const mode = this.mode;
    const mat = mode === 'realistic'
      ? new THREE.MeshStandardMaterial({ color: this.palette?.floor ?? REAL_FLOOR_COLOUR, roughness: 0.42, metalness: 0, map: textureOf('planks'), bumpMap: textureOf('planks'), bumpScale: 0.5 })
      : new THREE.MeshStandardMaterial({ color: mode === 'clay' ? CLAY_FLOOR_COLOUR : (this.palette?.floor ?? FLOOR_COLOUR), roughness: mode === 'clay' ? 1 : 0.9, metalness: 0 });
    this.disposables.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'floor';
    return mesh;
  }

  // ------------------------------------------------------------------ selection

  private applySelection(): void {
    for (const holder of [...this.selectionLines.children]) {
      this.selectionLines.remove(holder);
      holder.traverse((o) => {
        const l = o as THREE.LineSegments;
        if (l.isLineSegments) { l.geometry.dispose(); (l.material as THREE.Material).dispose(); }
      });
    }
    const room = this.room;
    const selection = this.p.ui.getState().selection;
    const wallSelected = new Set(selection.filter((s) => s.kind === 'wall').map((s) => s.id));
    for (const [id, m] of this.wallMaterials) {
      m.emissive.set(wallSelected.has(id) ? TINT.selected : '#000000');
      m.emissiveIntensity = wallSelected.has(id) ? 0.4 : 0;
    }
    if (!room) return;
    /** A selection box in an object's local frame, under a holder that copies the object's transform. */
    const outline = (at: THREE.Object3D, size: [number, number, number], centre: [number, number, number]): void => {
      const lines = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0], size[1], size[2])),
        new THREE.LineBasicMaterial({ color: TINT.selected, depthTest: false }),
      );
      lines.renderOrder = 10;
      lines.position.set(centre[0], centre[1], centre[2]);
      const holder = new THREE.Group();
      holder.position.copy(at.position);
      holder.position.y += this.committed.position.y;
      holder.rotation.copy(at.rotation);
      holder.add(lines);
      this.selectionLines.add(holder);
    };
    for (const s of selection) {
      if (s.kind === 'furniture') {
        const inst = room.furniture.find((f) => f.id === s.id);
        const obj = this.furnitureObjects.get(s.id);
        if (inst && obj) outline(obj, [inst.width, inst.height, inst.length], [0, inst.height / 2, 0]);
      } else if (s.kind === 'fixture') {
        const f = room.fixtures.find((x) => x.id === s.id);
        const obj = this.fixtureObjects.get(s.id);
        const t = room.walls.find((w) => w.id === f?.wallId)?.thickness ?? 0.15;
        if (f && obj) outline(obj, [f.width, f.height, t], [0, f.elevation + f.height / 2, -t / 2]); // opening, centred in the wall
      }
    }
  }

  // ------------------------------------------------------------------ feedback bus (drag / ghost previews)

  private applyBus(b: FeedbackState): void {
    // hide committed objects that are being previewed
    this.syncVisibility();
    this.selectionLines.visible = b.hiddenIds.length === 0;

    const project = this.p.project.getState().project;
    const room = project?.rooms[0];
    const wanted = new Set(b.previews.map((x) => x.id));
    for (const [id, e] of [...this.previewEntries]) {
      if (!wanted.has(id) && !(this.animating && b.animateBack)) { this.previews.remove(e.group); this.previewEntries.delete(id); }
    }
    if (!project || !room) return;

    for (const pv of b.previews) this.showPreview(pv, project, room);
    if (b.animateBack && !this.animating && this.previewEntries.size > 0) this.animateBack(room);
    else if (b.animateBack && !this.animating) this.p.onAnimationDone?.();
  }

  private showPreview(pv: PreviewObject, project: Project, room: Room): void {
    const tint: Tint = !pv.valid ? 'hard' : pv.violations.some((v) => v.severity === 'soft') ? 'soft' : null;
    const opacity = pv.ghost ? 0.6 : 1;
    const key = sig([pv.kind, pv.instance ? [pv.instance.definitionId, pv.instance.width, pv.instance.length, pv.instance.height] : null,
      pv.fixture ? [pv.fixture.type, pv.fixture.wallId, pv.fixture.offsetAlongWall, pv.fixture.hingeSide] : null, pv.freeAt ?? null, tint, pv.ghost]);
    let entry = this.previewEntries.get(pv.id);
    if (!entry || entry.sig !== key) {
      if (entry) this.previews.remove(entry.group);
      let group: THREE.Group | null = null;
      if (pv.kind === 'furniture' && pv.instance) group = this.furnitureGroup(pv.instance, project, tint, opacity);
      else if (pv.kind === 'fixture' && pv.fixture) group = this.fixtureGroup(room, pv.fixture, tint, opacity);
      else if (pv.kind === 'fixture' && pv.freeAt) {
        // not near a wall yet: a flat marker at the pointer ("move next to a wall")
        group = new THREE.Group();
        const disc = new THREE.Mesh(unitCylinder, this.materials.get({ colour: TINT.soft, roughness: 0.6, metalness: 0, opacity: 0.5, tint: null }));
        const r = (pv.freeWidth ?? 0.8) / 2;
        disc.scale.set(r, 0.02, r);
        group.add(disc);
        group.position.set(pv.freeAt.x, 0.01, pv.freeAt.y);
      }
      if (!group) return;
      group.position.y += this.committed.position.y;
      this.previews.add(group);
      entry = { group, sig: key };
      this.previewEntries.set(pv.id, entry);
    }
    if (pv.kind === 'furniture' && pv.instance) {
      const t = instanceTransform(pv.instance);
      entry.group.position.set(t.position[0], t.position[1] + this.committed.position.y, t.position[2]);
      entry.group.rotation.y = t.rotationY;
    }
  }

  private animateBack(room: Room): void {
    this.animating = true;
    const ms = this.p.animateMs ?? 160;
    const now = this.p.now ?? ((): number => performance.now());
    const schedule = this.p.schedule ?? ((fn: () => void): void => { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn); else setTimeout(fn, 16); });
    const finish = (): void => {
      this.animating = false;
      if (this.disposed) return;
      this.p.onAnimationDone?.();
    };
    const from = new Map<string, { x: number; y: number; z: number; r: number }>();
    const to = new Map<string, { x: number; y: number; z: number; r: number }>();
    for (const [id, e] of this.previewEntries) {
      const home = room.furniture.find((f) => f.id === id);
      if (!home) continue;
      const t = instanceTransform(home);
      from.set(id, { x: e.group.position.x, y: e.group.position.y, z: e.group.position.z, r: e.group.rotation.y });
      to.set(id, { x: t.position[0], y: t.position[1] + this.committed.position.y, z: t.position[2], r: t.rotationY });
    }
    if (ms <= 0 || from.size === 0) { finish(); return; }
    const t0 = now();
    const step = (): void => {
      if (this.disposed) return;
      const u = Math.min(1, (now() - t0) / ms);
      const e = u * u * (3 - 2 * u);
      for (const [id, a] of from) {
        const b = to.get(id)!;
        const g = this.previewEntries.get(id)?.group;
        if (!g) continue;
        g.position.set(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, a.z + (b.z - a.z) * e);
        let dr = b.r - a.r;
        dr = Math.atan2(Math.sin(dr), Math.cos(dr));
        g.rotation.y = a.r + dr * e;
      }
      this.p.invalidate();
      if (u < 1) schedule(step); else finish();
    };
    schedule(step);
  }

  // ------------------------------------------------------------------ wall fading (A7)

  /** Fade walls between the camera and the room. `polar` is the angle of the view direction from straight down. */
  updateFade(cameraPlan: Vec2, polar: number): void {
    this.lastCamera = { plan: cameraPlan, polar };
    this.reapplyFade();
  }

  private reapplyFade(): void {
    const room = this.room;
    const next = new Set(room && this.lastCamera ? wallsToFade(room, this.lastCamera.plan, this.lastCamera.polar) : []);
    const cut = this.cinematic; // cinematic cuts the walls away (like an architectural model); the ordinary view fades them
    for (const [id, m] of this.wallMaterials) {
      const fade = next.has(id);
      const transparent = fade && !cut;
      if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; }
      m.opacity = transparent ? FADED_WALL_OPACITY : 1;
      m.depthWrite = !transparent;
      m.visible = !(fade && cut);
      for (const sk of this.skirting.get(id) ?? []) sk.visible = !(fade && cut);
    }
    const changed = next.size !== this.faded.size || [...next].some((x) => !this.faded.has(x));
    this.faded = next;
    this.syncVisibility();
    if (changed) this.p.invalidate();
  }

  // ------------------------------------------------------------------ picking

  /**
   * Everything under the ray, nearest first. A faded wall is see-through, so it cannot be picked; a hidden (being dragged)
   * object is skipped. The same object is reported once, at its nearest hit.
   */
  pickDetailed(raycaster: THREE.Raycaster): PickHit[] {
    this.root.updateMatrixWorld(true);
    const hidden = new Set(this.p.bus.get().hiddenIds);
    const hits = raycaster.intersectObjects(this.pickables, false);
    const out: PickHit[] = [];
    const seen = new Set<string>();
    for (const h of hits) {
      const ref = h.object.userData.ref as SelectionRef | undefined;
      if (!ref) continue;
      if (ref.kind === 'wall' && this.faded.has(ref.id)) continue;
      if (hidden.has(ref.id)) continue;
      const key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ref, distance: h.distance, point: h.point.clone() });
    }
    return out;
  }

  pick(raycaster: THREE.Raycaster): SelectionRef[] { return this.pickDetailed(raycaster).map((h) => h.ref); }

  // ------------------------------------------------------------------ lifecycle

  dispose(): void {
    this.disposed = true;
    for (const u of this.unsub) u();
    this.unsub = [];
    this.clearCommitted();
    this.materials.dispose();
    this.previews.clear();
    this.previewEntries.clear();
    this.selectionLines.clear();
    this.sun.shadow.dispose();
  }
}

