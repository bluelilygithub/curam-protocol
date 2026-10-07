import type { Enclosure } from './types';

/**
 * Golden Test Case #02: the Carter Noir sample, project M0103 sheets A101 to A103, as READ from the drawings. A worked example, UNVERIFIED:
 * every number is the reading of a 1:20 drawing and must be confirmed by the owner. 2850 x 1665 to the outer faces of 50 mm panels,
 * a 970 mm door centred on the south wall swinging out and hinged on the left as seen from outside (A101's open leaf is at the west jamb; the handle on A102 is on the right), a 500 mm header carrying a ceiling conditioner (about 902 x 317) and two 400 x 100 vents.
 */
export function goldenCase02(): Enclosure {
  const panel = { kind: 'PANEL' as const, buildUpMm: 50 };
  return {
    outerWidthMm: 2850, outerDepthMm: 1665, heightMm: 2200, ceilingBuildUpMm: 50, floorBuildUpMm: 0,
    walls: { NORTH: { ...panel }, EAST: { ...panel }, SOUTH: { ...panel }, WEST: { ...panel } },
    door: { wall: 'SOUTH', widthMm: 970, heightMm: 2120, swing: 'OUT', hinge: 'LEFT', glazed: true },
    headerHeightMm: 500,
    header: [
      { id: 'conditioner', kind: 'CONDITIONER', xMm: 974, yMm: 0, widthMm: 902, heightMm: 317 },
      { id: 'vent-left', kind: 'VENT', xMm: 271, yMm: 100, widthMm: 400, heightMm: 100 },
      { id: 'vent-right', kind: 'VENT', xMm: 2179, yMm: 100, widthMm: 400, heightMm: 100 },
    ],
  };
}
