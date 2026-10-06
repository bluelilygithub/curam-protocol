import { DEFAULT_RULES } from './defaults';
import { runExtent, splitRun } from './layout';
import { SCHEMA_VERSION, type CabinetBay, type CellarProject } from './types';

/**
 * Golden Test Case #01: a worked example, NOT a validation against a real job (that is still pending, see spec-v1.md section 11).
 * A straight 2450 mm wall in a 2400 mm room, two room-wall ends, three equal bays 360 deep and 2200 tall, each a 400 mm label-forward display
 * above a scalloped base (both Bordeaux). Expected: 128 bottles a bay, 384 in all.
 */
export function goldenCase01(): CellarProject {
  const r = DEFAULT_RULES;
  const wallLengthMm = 2450;
  const ext = runExtent(wallLengthMm, 'ROOM_WALL', 'ROOM_WALL', 0, 0, r);
  const split = splitRun(ext.usableMm, 3);
  const bays: CabinetBay[] = [0, 1, 2].map((i) => ({
    id: `bay-${i + 1}`,
    xMm: ext.startOffsetMm + split.startExtraMm + i * split.bayWidthMm,
    widthMm: split.bayWidthMm,
    outerDepthMm: 360,
    outerHeightMm: 2200,
    modules: [
      { id: `bay-${i + 1}-base`, storageStyle: 'SCALLOPED_CRADLE', bottleProfile: 'BORDEAUX' },
      { id: `bay-${i + 1}-display`, storageStyle: 'LABEL_FORWARD', bottleProfile: 'BORDEAUX', heightMm: 400 },
    ],
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'golden-01',
    name: 'Golden Test Case #01',
    locale: 'en-AU',
    cornerOwnershipMode: 'LONGEST_WALL_FIRST',
    rules: { ...r },
    room: {
      heightMm: 2400,
      walls: [{ id: 'wall-north', start: [0, 0], end: [wallLengthMm, 0], startTermination: 'ROOM_WALL', endTermination: 'ROOM_WALL', bays }],
      doors: [], windows: [], obstructions: [],
    },
  };
}
