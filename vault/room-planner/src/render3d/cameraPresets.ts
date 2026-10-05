// Camera presets and fitting (D43). The maths lives in planner-core (shared with Garden Planner); this binds it to a Room.
import {
  boundsOfPoints, orthoZoomForBounds, presetCameraForBounds,
  type CameraPreset, type CameraState, type PresetOptions, type SceneBounds,
} from '@planner-core/render3d/camera';
import type { Room } from '../engine/types';

export * from '@planner-core/render3d/camera';
export type RoomBounds = SceneBounds;

/** Bounds of the room's corners plus its height. `radius` is half the diagonal of the bounding box (a sphere that holds the room). */
export function roomBounds(room: Room): RoomBounds {
  return boundsOfPoints(room.vertices.map((v) => v.position), room.wallHeight);
}

/** Orthographic zoom (pixels per metre) that fits the room's footprint in a viewport of the given pixel size. */
export function orthoZoomFor(room: Room, viewportW: number, viewportH: number): number {
  return orthoZoomForBounds(roomBounds(room), room.wallHeight, viewportW, viewportH);
}

export function presetCamera(room: Room, preset: CameraPreset, current: CameraState | null, opts: PresetOptions = {}): CameraState {
  return presetCameraForBounds(roomBounds(room), room.wallHeight, preset, current, opts);
}
