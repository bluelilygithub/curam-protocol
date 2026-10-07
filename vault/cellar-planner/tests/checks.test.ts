import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES as R, checkBay, checkWall, placeholderCode, type BayModule, type CabinetBay, type Wall } from '../src/engine';

const mod = (over: Partial<BayModule> = {}, id = 'm'): BayModule => ({ id, storageStyle: 'SCALLOPED_CRADLE', bottleProfile: 'BORDEAUX', ...over });
const bay = (over: Partial<CabinetBay> = {}): CabinetBay => ({ id: 'b1', xMm: 50, widthMm: 797, outerDepthMm: 350, outerHeightMm: 2200, modules: [mod()], ...over });
const codes = (b: CabinetBay, roomHeight = 2400) => checkBay(b, roomHeight, R).map((i) => i.code);

describe('depth checks', () => {
  it('Bordeaux passes in 350 mm; Champagne fails and is told 360 mm', () => {
    expect(codes(bay())).not.toContain('DEPTH_TOO_SHALLOW');
    const issues = checkBay(bay({ modules: [mod({ bottleProfile: 'CHAMPAGNE' })] }), 2400, R);
    const d = issues.find((i) => i.code === 'DEPTH_TOO_SHALLOW');
    expect(d).toMatchObject({ severity: 'error' });
    expect(d?.message).toMatch(/335 mm needed inside, 328 mm available/);
    expect(d?.fix).toMatch(/360 mm/);
  });
  it('Magnum in 350 mm fails and is told 410 mm (not 400: 400 would leave 378 inside for a 385 mm need)', () => {
    const d = checkBay(bay({ modules: [mod({ bottleProfile: 'MAGNUM' })] }), 2400, R).find((i) => i.code === 'DEPTH_TOO_SHALLOW');
    expect(d?.fix).toMatch(/410 mm/);
  });
  it('an inclined display needs about 330 mm inside: 340 outer fails, 360 outer passes', () => {
    const disp = [mod(), mod({ storageStyle: 'LABEL_FORWARD', heightMm: 400 }, 'd')];
    expect(codes(bay({ outerDepthMm: 340, modules: disp }))).toContain('DISPLAY_DEPTH_TOO_SHALLOW');
    expect(codes(bay({ outerDepthMm: 360, modules: disp }))).not.toContain('DISPLAY_DEPTH_TOO_SHALLOW');
  });
});

describe('stack and module checks', () => {
  it('the bottom module must not have a stored height; upper modules must have one', () => {
    expect(codes(bay({ modules: [mod({ heightMm: 1600 })] }))).toContain('BASE_HEIGHT_STORED');
    expect(codes(bay({ modules: [mod(), mod({}, 'u')] }))).toContain('UPPER_HEIGHT_MISSING');
  });
  it('upper modules taller than the stack overflow it, with a fix', () => {
    const issues = checkBay(bay({ modules: [mod(), mod({ heightMm: 2100 }, 'u')] }), 2400, R);
    const o = issues.find((i) => i.code === 'STACK_OVERFLOW');
    expect(o?.severity).toBe('error');
    expect(o?.fix).toMatch(/83 mm shorter/);
  });
  it('a module too short for one row is an error with the height it needs', () => {
    const issues = checkBay(bay({ modules: [mod(), mod({ heightMm: 100 }, 'u')] }), 2400, R);
    expect(issues.find((i) => i.code === 'MODULE_TOO_SHORT')?.where).toBe('u');
  });
  it('a bay taller than the room is an error', () => {
    expect(codes(bay({ outerHeightMm: 2500 }))).toContain('BAY_TOO_TALL');
  });
  it('an excessive row height is information, not an error: a short, tall-gap module', () => {
    // a 2018 stack split so the base has 1 row's worth of room only: net 160 -> 1 row of 160 clear (> 100 + 40)
    const issues = checkBay(bay({ modules: [mod(), mod({ heightMm: 2018 - 160 }, 'u')] }), 2400, R);
    const e = issues.find((i) => i.code === 'ROW_HEIGHT_EXCESSIVE');
    expect(e?.severity).toBe('info');
    expect(e?.fix).toMatch(/adding another shelf row/);
  });
  it('a bay too narrow for one bottle is an error', () => {
    expect(codes(bay({ widthMm: 100 }))).toContain('BAY_TOO_NARROW');
  });
  it('wasted width is information with the widths that fix it', () => {
    const w = checkBay(bay({ widthMm: 783 }), 2400, R).find((i) => i.code === 'WIDTH_WASTE');
    expect(w?.severity).toBe('info');
    expect(w?.fix).toMatch(/712 mm wide wastes none/);
    expect(w?.fix).toMatch(/797 mm wide holds one more/);
    expect(codes(bay({ widthMm: 797 }))).not.toContain('WIDTH_WASTE');
  });
  it('case drawers are noted as not counted, never as errors', () => {
    const issues = checkBay(bay({ modules: [mod({ storageStyle: 'CASE_DRAWER' })] }), 2400, R);
    expect(issues.map((i) => i.code)).toContain('CASE_DRAWER_NOT_COUNTED');
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('an empty bay is a warning', () => {
    expect(codes(bay({ modules: [] }))).toContain('BAY_EMPTY');
  });
});

describe('wall checks', () => {
  const wall = (bays: CabinetBay[]): Wall => ({ id: 'w', start: [0, 0], end: [2450, 0], startTermination: 'ROOM_WALL', endTermination: 'ROOM_WALL', bays });
  const run = (bays: CabinetBay[]) => { const w = wall(bays); return checkWall(w, [w], R).map((i) => i.code); };
  it('bays inside the usable run are fine', () => expect(run([bay({ xMm: 50, widthMm: 800 }), bay({ id: 'b2', xMm: 850, widthMm: 800 })])).toEqual([]));
  it('overlapping bays are reported', () => expect(run([bay({ xMm: 50, widthMm: 800 }), bay({ id: 'b2', xMm: 800, widthMm: 800 })])).toContain('BAY_OVERLAP'));
  it('a bay in the scribe, or past the far scribe, overflows the run', () => {
    expect(run([bay({ xMm: 20 })])).toContain('RUN_OVERFLOW');
    expect(run([bay({ xMm: 1700, widthMm: 800 })])).toContain('RUN_OVERFLOW');
  });
});

describe('placeholder codes', () => {
  it('are built from the style and the sizes, never stored', () => {
    expect(placeholderCode('SCALLOPED_CRADLE', 800, 1618)).toBe('CUSTOM-PORT-800-1618');
    expect(placeholderCode('LABEL_FORWARD', 783, 400)).toBe('CUSTOM-DISP-783-400');
    expect(placeholderCode('CASE_DRAWER', 600, 300)).toBe('CUSTOM-CASE-600-300');
  });
});
