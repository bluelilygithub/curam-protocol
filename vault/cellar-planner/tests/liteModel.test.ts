import { describe, expect, it } from 'vitest';
import { doorLayout } from '../src/enclosure/enclosure';
import { analyseApp } from '../src/app/model';
import { BOTTLES, DOOR_POSITIONS, FINISHES, WALLS, decodeDesign, defaultLite, encodeDesign, liteResult, liteToProject, summaryLine, type LiteSettings } from '../src/lite/settings';

const b64 = (a: unknown[]): string => `CL1.${btoa(JSON.stringify(a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

describe('door position and rack finish in the design code', () => {
  it('the standard design keeps the exact code it always had (existing links and enquiries still open)', () => {
    expect(encodeDesign(defaultLite())).toBe('CL1.WzI3NTAsMTU2NSwyMTUwLDIsMCwwLDUwMCwwXQ');
  });
  it('codes made before these existed (7 or 8 values) still decode, with the standard door position and finish', () => {
    const old8 = decodeDesign('CL1.WzI3NTAsMTU2NSwyMTUwLDIsMCwwLDUwMCwwXQ')!;
    expect(old8.doorPos).toBe('CENTRE'); expect(old8.finish).toBe('OAK');
    const old7 = decodeDesign(b64([2750, 1565, 2150, 2, 0, 0, 500]))!;
    expect(old7.doorStyle).toBe('SINGLE'); expect(old7.doorPos).toBe('CENTRE');
  });
  it('the extra values are only written when they are not the standard ones', () => {
    const len = (s: LiteSettings): number => (JSON.parse(atob(encodeDesign(s).slice(4).replace(/-/g, '+').replace(/_/g, '/'))) as unknown[]).length;
    expect(len(defaultLite())).toBe(8);
    expect(len({ ...defaultLite(), doorPos: 'LEFT' })).toBe(9);
    expect(len({ ...defaultLite(), finish: 'WALNUT' })).toBe(10);
    expect(len({ ...defaultLite(), doorPos: 'RIGHT', finish: 'BLACK' })).toBe(10);
  });
  it('every combination round-trips', () => {
    for (const doorWall of WALLS) for (const doorPos of DOOR_POSITIONS) for (const finish of FINISHES) for (const bottle of BOTTLES) for (const doorStyle of ['SINGLE', 'DOUBLE'] as const) {
      const s: LiteSettings = { widthMm: 3100, depthMm: 2200, heightMm: 2400, doorWall, doorStyle, doorPos, finish, bottle, mode: 'FILL', target: 321 };
      expect(decodeDesign(encodeDesign(s)), JSON.stringify(s)).toEqual(s);
    }
  });
  it('unknown values fall back to the standard ones, never break', () => {
    const d = decodeDesign(b64([2750, 1565, 2150, 2, 0, 0, 500, 0, 9, 9]))!;
    expect(d.doorPos).toBe('CENTRE'); expect(d.finish).toBe('OAK');
    expect(decodeDesign(b64([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))).toBeNull();
  });
});

describe('where the door sits along its wall', () => {
  const layout = (doorWall: LiteSettings['doorWall'], doorPos: LiteSettings['doorPos']) => doorLayout(liteToProject({ ...defaultLite(), doorWall, doorPos }).enclosure);

  it('centre leaves equal panels either side', () => {
    for (const w of WALLS) { const l = layout(w, 'CENTRE'); expect(Math.abs(l.beforeMm - l.afterMm)).toBeLessThanOrEqual(1); }
  });
  it('left and right are as seen standing OUTSIDE facing the door (the wall measure starts at the west or north end)', () => {
    // south wall: left hand = west end = the start of the measure
    expect(layout('SOUTH', 'LEFT').beforeMm).toBe(100);
    expect(layout('SOUTH', 'RIGHT').afterMm).toBe(100);
    // north wall: left hand = east end = the far end
    expect(layout('NORTH', 'LEFT').afterMm).toBe(100);
    expect(layout('NORTH', 'RIGHT').beforeMm).toBe(100);
    // west wall: left hand = north end = the start
    expect(layout('WEST', 'LEFT').beforeMm).toBe(100);
    expect(layout('WEST', 'RIGHT').afterMm).toBe(100);
    // east wall: left hand = south end = the far end
    expect(layout('EAST', 'LEFT').afterMm).toBe(100);
    expect(layout('EAST', 'RIGHT').beforeMm).toBe(100);
  });
  it('the door always stays on its wall with a panel at each end, even in the narrowest room with a double door', () => {
    for (const doorWall of WALLS) for (const doorPos of DOOR_POSITIONS) for (const doorStyle of ['SINGLE', 'DOUBLE'] as const) for (const [widthMm, depthMm] of [[1000, 1000], [1200, 8000], [8000, 1000]]) {
      const l = doorLayout(liteToProject({ ...defaultLite(), doorWall, doorPos, doorStyle, widthMm, depthMm }).enclosure);
      expect(l.beforeMm, `${doorWall} ${doorPos} ${doorStyle}`).toBeGreaterThanOrEqual(0);
      expect(l.afterMm).toBeGreaterThanOrEqual(0);
      expect(l.beforeMm + l.doorMm + l.afterMm).toBe(l.wallLengthMm);
    }
  });
  it('every position of every door builds, with no rack in the door\'s way', () => {
    for (const doorWall of WALLS) for (const doorPos of DOOR_POSITIONS) for (const doorStyle of ['SINGLE', 'DOUBLE'] as const) for (const bottle of BOTTLES) {
      for (const [widthMm, depthMm] of [[1000, 1000], [2750, 1565], [4000, 3000]]) {
        const r = liteResult({ ...defaultLite(), doorWall, doorPos, doorStyle, bottle, widthMm, depthMm });
        expect(r.problems, `${doorWall} ${doorPos} ${doorStyle} ${bottle} ${widthMm}x${depthMm}`).toEqual([]);
        expect(analyseApp(r.project).issues.filter((i) => i.severity === 'error')).toEqual([]);
      }
    }
  });
  it('moving the door can change how many bottles fit (it takes different wall) but never to nothing', () => {
    const counts = DOOR_POSITIONS.map((doorPos) => liteResult({ ...defaultLite(), doorPos }).bottles);
    expect(counts.every((n) => n > 0)).toBe(true);
  });
});

describe('finish', () => {
  it('changes the look only: the bottle count is the same for every finish', () => {
    const base = liteResult(defaultLite()).bottles;
    for (const finish of FINISHES) expect(liteResult({ ...defaultLite(), finish }).bottles).toBe(base);
  });
});

describe('the enquiry line', () => {
  it('stays the same for the standard door position and finish, and says so when they are not', () => {
    expect(summaryLine(defaultLite(), 1120)).not.toMatch(/toward|racks,/);
    expect(summaryLine({ ...defaultLite(), doorPos: 'LEFT' }, 1120)).toContain('door on the south wall, toward the left,');
    expect(summaryLine({ ...defaultLite(), finish: 'WALNUT' }, 1120)).toContain('walnut racks,');
  });
});
