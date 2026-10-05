// Your own photos in a picture frame (wall art, stage 2). Pure rules; the browser side (reading and shrinking a file) is in pictureImport.ts.
// A photo is shrunk and stored inside the project (`Project.images`), so it travels with the file and the saved project. Several frames can
// share one photo; photos no frame uses any more are dropped when the next one is added.
import type { Command, FurnitureInstance, Project, ProjectImage } from '../engine/types';

/** Longest side of a stored photo, in pixels. Enough for a frame on a wall; small enough to keep the project light. */
export const MAX_IMAGE_SIDE = 640;
/** A stored photo (as a data URL) is at most this many characters, about 190 KB of image. */
export const MAX_DATA_URL = 260_000;
export const MAX_IMAGES = 8;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MIN_FRAME_SIDE = 0.15;

/** Width and height to shrink `w × h` to so the longer side is at most `max` (never enlarges). */
export function fitSize(w: number, h: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** A frame the shape of the photo, keeping the longer side of the frame as it was (in metres, to the millimetre). */
export function frameSizeFor(imageW: number, imageH: number, frameW: number, frameH: number): { width: number; height: number } {
  const long = Math.max(frameW, frameH);
  const ar = imageW / imageH;
  const width = ar >= 1 ? long : long * ar;
  const height = ar >= 1 ? long / ar : long;
  const q = (v: number): number => Math.round(Math.max(MIN_FRAME_SIDE, v) * 1000) / 1000;
  return { width: q(width), height: q(height) };
}

/** Pieces that show a picture a person can replace (paintings, prints, photos, the photo frame), not mirrors. */
export const holdsPicture = (definitionId: string): boolean => definitionId.startsWith('art-') || definitionId === 'photo-frame';

export function usedImageIds(project: Project): Set<string> {
  const used = new Set<string>();
  for (const room of project.rooms) for (const f of room.furniture) if (f.imageId) used.add(f.imageId);
  return used;
}

export type AddImageResult = { ok: true; project: Project } | { ok: false; message: string };

/** The project with `image` stored under `id`, and photos nothing uses dropped. Refuses when it would be too many or too big. */
export function addImage(project: Project, id: string, image: ProjectImage): AddImageResult {
  if (image.dataUrl.length > MAX_DATA_URL) return { ok: false, message: 'That photo is too detailed to keep in the project. Try a smaller picture.' };
  const keep = usedImageIds(project);
  const images: Record<string, ProjectImage> = {};
  for (const [k, v] of Object.entries(project.images ?? {})) if (keep.has(k)) images[k] = v;
  images[id] = image;
  if (Object.keys(images).length > MAX_IMAGES) return { ok: false, message: `A project can hold up to ${MAX_IMAGES} photos. Remove one from a frame first.` };
  return { ok: true, project: { ...project, images } };
}

/** The photo a piece shows, if it has one that is still in the project. */
export const imageOf = (project: Project | null | undefined, inst: Pick<FurnitureInstance, 'imageId'>): ProjectImage | undefined =>
  inst.imageId ? project?.images?.[inst.imageId] : undefined;

/**
 * Show photo `imageId` in a frame and reshape the frame to it: a resize (width) plus the photo and height, one undoable step.
 * (Width is changed by the resize command, as everywhere else; the photo id and height by an update.)
 */
export function pictureCommand(inst: FurnitureInstance, imageId: string | null, size?: { width: number; height: number }): Command {
  const update: Command = {
    type: 'UpdateFurniture', instanceId: inst.id,
    from: { imageId: inst.imageId ?? null, ...(size ? { height: inst.height } : {}) },
    to: { imageId, ...(size ? { height: size.height } : {}) },
  };
  if (!size) return update;
  return {
    type: 'Composite',
    commands: [
      { type: 'ResizeFurniture', instanceId: inst.id, from: { position: { ...inst.position }, width: inst.width, length: inst.length }, to: { position: { ...inst.position }, width: size.width, length: inst.length } },
      update,
    ],
  };
}
