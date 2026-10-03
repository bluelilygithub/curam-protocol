// Turns 3D pointer input into the same world-space events the 2D editor uses (D40), so dragging, snapping, ghost placement,
// feedback and commits all run through the one `Interaction` state machine. Plain numbers in, no DOM: tests drive it directly.
import * as THREE from 'three';
import type { Interaction, PointerEv } from '../interaction/interaction';
import type { UiStore } from '../state/uiStore';
import type { Scene3D } from './Scene3D';

export interface ControllerPorts {
  scene: Scene3D;
  interaction: Interaction;
  ui: UiStore;
  camera: () => THREE.Camera;
  /** Pixel size of the canvas. */
  size: () => { w: number; h: number };
  /** Suspend or resume the orbit controls (they must not move the camera while an object is being dragged). */
  setOrbitEnabled: (on: boolean) => void;
}

export interface Mods { shift: boolean; alt: boolean; ctrl: boolean; button?: number }

export class Controller3D {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private planeY = 0;
  private lastWorld = { x: 0, y: 0 };
  private active = false;

  constructor(private readonly p: ControllerPorts) {}

  private aim(x: number, y: number): void {
    const { w, h } = this.p.size();
    const cam = this.p.camera();
    cam.updateMatrixWorld();
    this.ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, cam);
  }

  /** Point under the pointer on the horizontal plane at `planeY` (plan coordinates). Falls back to the last point near the horizon. */
  private worldAt(): { x: number; y: number } {
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.planeY), new THREE.Vector3());
    if (hit) this.lastWorld = { x: hit.x, y: hit.z };
    return this.lastWorld;
  }

  /** Metres per screen pixel at the pointer, for the interaction's tolerances. */
  private mpp(): number {
    const { h } = this.p.size();
    const cam = this.p.camera();
    if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
      const o = cam as THREE.OrthographicCamera;
      return (o.top - o.bottom) / o.zoom / h;
    }
    const pc = cam as THREE.PerspectiveCamera;
    const d = Math.max(0.1, pc.position.distanceTo(new THREE.Vector3(this.lastWorld.x, this.planeY, this.lastWorld.y)));
    return (2 * d * Math.tan((pc.fov * Math.PI) / 360)) / h;
  }

  private event(x: number, y: number, m: Mods, hits?: PointerEv['hits']): PointerEv {
    return { world: this.worldAt(), screen: { x, y }, shift: m.shift, alt: m.alt, ctrl: m.ctrl, mpp: this.mpp(), button: m.button ?? 0, view3d: true, ...(hits ? { hits } : {}) };
  }

  /** Returns true if the editor took the gesture (the host should keep the camera still). */
  down(x: number, y: number, m: Mods): boolean {
    this.aim(x, y);
    const detailed = this.p.scene.pickDetailed(this.raycaster);
    const wasPlacing = !!this.p.ui.getState().placing;
    // Grab an object at the height where it was clicked, so it follows the pointer instead of sliding under it.
    const furnitureHit = wasPlacing ? undefined : detailed.find((h) => h.ref.kind === 'furniture');
    this.planeY = furnitureHit ? furnitureHit.point.y : 0;
    this.p.interaction.pointerDown(this.event(x, y, m, detailed.map((h) => h.ref)));
    this.active = true;
    const capture = wasPlacing || this.p.interaction.capturesPointer;
    this.p.setOrbitEnabled(!capture);
    if (!capture) this.planeY = 0;
    return capture;
  }

  move(x: number, y: number, m: Mods): void {
    this.aim(x, y);
    this.p.interaction.pointerMove(this.event(x, y, m));
  }

  up(x: number, y: number, m: Mods): void {
    if (!this.active) return;
    this.aim(x, y);
    this.active = false;
    this.p.interaction.pointerUp(this.event(x, y, m));
    this.planeY = 0;
    this.p.setOrbitEnabled(true);
  }

  /** Pointer cancelled or a second finger arrived: abandon the gesture (B7) and give the camera back. */
  cancel(): void {
    this.active = false;
    this.planeY = 0;
    this.p.interaction.cancel();
    this.p.setOrbitEnabled(true);
  }
}
