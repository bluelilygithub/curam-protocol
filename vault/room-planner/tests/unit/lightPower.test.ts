// Light power (M4.13): the maths, the "only power changed" test the 3D scene uses to retune lights in place, and the project edit.
import { describe, expect, it } from 'vitest';
import { FURNITURE_LIBRARY } from '../../src/data/furnitureLibrary';
import { clampPower, effectiveIntensity, GLOBAL_POWER_MAX, lightPowerOnly, percent, PIECE_POWER_MAX, withLightPower } from '../../src/render3d/lightPower';
import { withLibrary } from '../../src/state/projectStore';
import { makeInstance, makeProject, makeRoom } from '../helpers';

const lamp = (over = {}) => makeInstance({ id: 'l', definitionId: 'ceiling-light', position: { x: 2, y: 2.5 }, width: 0.45, length: 0.45, height: 0.1, elevation: 2.6, ...over });
const proj = (furniture = [lamp()]) => makeProject([makeRoom({ furniture })], FURNITURE_LIBRARY);

describe('the strength a light gets', () => {
  it('is its base strength x all-lights power x its own power', () => {
    expect(effectiveIntensity(40, 1, undefined)).toBe(40);
    expect(effectiveIntensity(40, 0.5, undefined)).toBe(20);
    expect(effectiveIntensity(40, 1, 2)).toBe(80);
    expect(effectiveIntensity(40, 0.5, 2)).toBe(40);
    expect(effectiveIntensity(40, 0, 3)).toBe(0);
  });
  it('is kept inside the allowed ranges and survives nonsense', () => {
    expect(effectiveIntensity(10, 99, 99)).toBe(10 * GLOBAL_POWER_MAX * PIECE_POWER_MAX);
    expect(effectiveIntensity(10, -1, undefined)).toBe(0);
    expect(clampPower(Number.NaN, 2)).toBe(1);
    expect(percent(1.3)).toBe('130 %');
    expect(percent(0)).toBe('0 %');
  });
});

describe('setting one light power', () => {
  it('stores a change, stores nothing for the standard 100 %, and leaves other pieces alone', () => {
    const p = proj([lamp(), lamp({ id: 'm', position: { x: 3, y: 2.5 } })]);
    const a = withLightPower(p, 'l', 1.5);
    expect(a.rooms[0].furniture.find((f) => f.id === 'l')!.lightPower).toBe(1.5);
    expect(a.rooms[0].furniture.find((f) => f.id === 'm')).toBe(p.rooms[0].furniture.find((f) => f.id === 'm'));
    const back = withLightPower(a, 'l', 1);
    expect('lightPower' in back.rooms[0].furniture.find((f) => f.id === 'l')!).toBe(false);
    expect(withLightPower(p, 'l', 99).rooms[0].furniture[0].lightPower).toBe(PIECE_POWER_MAX);
    expect(withLightPower(p, 'nope', 2).rooms[0]).toBe(p.rooms[0]);
  });
});

describe('only a light power changed', () => {
  it('is true for a power change, false for anything else', () => {
    const p = proj();
    expect(lightPowerOnly(p, withLightPower(p, 'l', 2))).toBe(true);
    expect(lightPowerOnly(p, p)).toBe(false);
    const moved = { ...p, rooms: [{ ...p.rooms[0], furniture: [{ ...p.rooms[0].furniture[0], position: { x: 3, y: 3 } }] }] };
    expect(lightPowerOnly(p, moved)).toBe(false);
    const renamed = { ...p, rooms: [{ ...p.rooms[0], name: 'Other' }] };
    expect(lightPowerOnly(p, renamed)).toBe(false);
    const added = { ...p, rooms: [{ ...p.rooms[0], furniture: [...p.rooms[0].furniture, lamp({ id: 'n' })] }] };
    expect(lightPowerOnly(p, added)).toBe(false);
    expect(lightPowerOnly(p, { ...p, name: 'Renamed project' })).toBe(false);
  });
  it('stays true across the library merge the store applies, so a slider drag does not rebuild the room', () => {
    const old = { ...proj(), furnitureDefinitions: FURNITURE_LIBRARY.slice(0, 12) };
    const a = withLibrary(old)!;
    const b = withLibrary(withLightPower(old, 'l', 2))!;
    expect(a.furnitureDefinitions).toBe(b.furnitureDefinitions);
    expect(lightPowerOnly(a, b)).toBe(true);
  });
});
