import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ADVISORY_PREFIX, advisories, analyseEnclosure, checkEnclosure, doorLayout, doorSwing, glassFraction, goldenCase02, internalSize, wallLengthMm } from '../src/enclosure';
import type { Enclosure } from '../src/enclosure';

// Golden Test Case #02 is a READING of the Carter Noir sample drawings (A101 to A103), unverified. It proves the code matches the rules, not
// that the drawing was read right.
describe('Golden Test Case #02 (sample A101 to A103, as read)', () => {
  const e = goldenCase02();
  const a = analyseEnclosure(e);

  it('2850 x 1665 to the outer faces of 50 mm panels is 2750 x 1565 inside', () => {
    expect(a.internal).toEqual({ widthMm: 2750, depthMm: 1565, heightMm: 2150 });
  });
  it('the door wall splits 940 | 970 | 940, as drawn', () => {
    expect(a.door).toEqual({ wallLengthMm: 2850, beforeMm: 940, doorMm: 970, afterMm: 940 });
  });
  it('has no errors', () => {
    expect(a.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('an outward-swinging door sweeps a 970 mm quarter circle outside', () => {
    expect(doorSwing(e)).toEqual({ radiusMm: 970, side: 'OUTSIDE', hinge: 'RIGHT', wall: 'SOUTH' });
  });
  it('the header parts are symmetric about the centre of the front', () => {
    const left = e.header.find((c) => c.id === 'vent-left')!, right = e.header.find((c) => c.id === 'vent-right')!, motor = e.header.find((c) => c.id === 'conditioner')!;
    expect(left.xMm + left.widthMm / 2 + (right.xMm + right.widthMm / 2)).toBe(e.outerWidthMm);
    expect(motor.xMm * 2 + motor.widthMm).toBe(e.outerWidthMm);
  });
  it('a glazed door in four panel walls is about 6% glass: no glass advisory', () => {
    expect(glassFraction(e)).toBeCloseTo((970 * 2120) / (2 * (2850 + 1665) * 2200), 6);
    expect(a.advisories.map((x) => x.code)).not.toContain('GLASS_AREA');
  });
});

describe('internal size', () => {
  it('each wall can have its own build-up (a 100 mm stud wall on one side)', () => {
    const e = goldenCase02();
    e.walls.WEST = { kind: 'STUD', buildUpMm: 100 };
    expect(internalSize(e).widthMm).toBe(2850 - 100 - 50);
  });
  it('wall length follows the compass: north and south run along the width', () => {
    const e = goldenCase02();
    expect(wallLengthMm(e, 'NORTH')).toBe(2850);
    expect(wallLengthMm(e, 'EAST')).toBe(1665);
  });
  it('property: inside is always outside minus the two build-ups', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 200 }), fc.integer({ min: 1500, max: 6000 }), (w, n, size) => {
      const e = { ...goldenCase02(), outerWidthMm: size };
      e.walls.WEST = { kind: 'PANEL', buildUpMm: w };
      e.walls.EAST = { kind: 'PANEL', buildUpMm: n };
      return internalSize(e).widthMm === size - w - n;
    }));
  });
});

describe('the door', () => {
  it('is centred by default, with an odd millimetre going after it', () => {
    const e = goldenCase02();
    e.door.widthMm = 971;
    expect(doorLayout(e)).toMatchObject({ beforeMm: 939, afterMm: 940 });
  });
  it('can be offset along the wall', () => {
    const e = goldenCase02();
    e.door.offsetMm = 200;
    expect(doorLayout(e)).toMatchObject({ beforeMm: 200, afterMm: 2850 - 200 - 970 });
  });
  it('a door too wide for its wall, or off the end of it, is an error', () => {
    const wide = goldenCase02();
    wide.door.widthMm = 2800;
    expect(checkEnclosure(wide).map((i) => i.code)).toContain('DOOR_TOO_WIDE');
    const off = goldenCase02();
    off.door.offsetMm = 2500;
    expect(checkEnclosure(off).map((i) => i.code)).toContain('DOOR_OFF_WALL');
  });
  it('a door taller than the inside is an error; one that swings in is information', () => {
    const e = goldenCase02();
    e.door.heightMm = 2200;
    e.door.swing = 'IN';
    const codes = checkEnclosure(e).map((i) => i.code);
    expect(codes).toContain('DOOR_TOO_TALL');
    expect(checkEnclosure(e).find((i) => i.code === 'DOOR_SWINGS_IN')?.severity).toBe('info');
    expect(doorSwing(e).side).toBe('INSIDE');
  });
  it('a door on the east wall uses the depth as its wall length', () => {
    const e = goldenCase02();
    e.door.wall = 'EAST';
    expect(doorLayout(e).wallLengthMm).toBe(1665);
  });
});

describe('the header', () => {
  const codes = (e: Enclosure) => checkEnclosure(e).map((i) => i.code);
  it('a part outside the header is an error', () => {
    const e = goldenCase02();
    e.header[0].heightMm = 600;
    expect(codes(e)).toContain('HEADER_COMPONENT_OUTSIDE');
    const e2 = goldenCase02();
    e2.header[1].xMm = -5;
    expect(codes(e2)).toContain('HEADER_COMPONENT_OUTSIDE');
  });
  it('overlapping parts are an error', () => {
    const e = goldenCase02();
    e.header[1].xMm = 900;
    expect(codes(e)).toContain('HEADER_OVERLAP');
  });
  it('no conditioner is a warning', () => {
    const e = goldenCase02();
    e.header = e.header.filter((c) => c.kind !== 'CONDITIONER');
    expect(checkEnclosure(e).find((i) => i.code === 'NO_CONDITIONER')?.severity).toBe('warning');
  });
});

describe('advisory guidance never blocks a design', () => {
  it('every advisory carries the sign-off wording', () => {
    const e = goldenCase02();
    e.walls.NORTH = { kind: 'GLASS', buildUpMm: 20 };
    e.walls.WEST = { kind: 'PANEL', buildUpMm: 30 };
    for (const a of advisories(e)) expect(a.text.startsWith(ADVISORY_PREFIX)).toBe(true);
    expect(advisories(e).length).toBeGreaterThan(2);
  });
  it('an all-glass enclosure gets the glass note and is still a valid design', () => {
    const e = goldenCase02();
    for (const s of ['NORTH', 'EAST', 'SOUTH', 'WEST'] as const) e.walls[s] = { kind: 'GLASS', buildUpMm: 50 };
    expect(glassFraction(e)).toBeCloseTo(1, 6);
    const a = analyseEnclosure(e);
    expect(a.advisories.map((x) => x.code)).toContain('GLASS_AREA');
    expect(a.advisories.find((x) => x.code === 'GLASS_AREA')?.text).toMatch(/100% of the wall area is glass/);
    expect(a.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('thin panels get an insulation note, not an error', () => {
    const e = goldenCase02();
    e.walls.EAST = { kind: 'PANEL', buildUpMm: 30 };
    expect(advisories(e).map((x) => x.code)).toContain('INSULATION_THIN');
    expect(checkEnclosure(e).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('an enclosure too small inside is an error', () => {
    const e = goldenCase02();
    e.outerDepthMm = 500;
    expect(checkEnclosure(e).map((i) => i.code)).toContain('INTERNAL_TOO_SMALL');
  });
});
