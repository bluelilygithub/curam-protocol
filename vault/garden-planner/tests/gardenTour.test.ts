import { describe, expect, it } from 'vitest';
import { sampleTour, tourFromStops, type TourStop } from '@planner-core/render3d/tour';
import { apply, setItem } from '../src/domain/commands';
import { boundaryFromPoints, newGardenProject, rectanglePoints } from '../src/domain/projectFactory';
import type { GardenProject, SavedView, Structure } from '../src/domain/types';
import { isWalkable } from '../src/walk/walk';
import {
  autoGardenStops, blockedBy, buildGardenTour, buildTourWorld, clearStops, countedIndex, countedStops, MIN_CAMERA_Y, openAbove, pathProblems, samplePose, SAVED_DWELL, stopsFor, TOUR_EYE,
} from '../src/walk/gardenTour';

let n = 0;
const sid = (): string => `s${++n}`;
const structure = (kind: Structure['kind'], x: number, y: number, w: number, l: number, h: number): Structure => ({ id: sid(), kind, name: kind, position: { x, y }, width: w, length: l, height: h, rotation: 0 } as Structure);
const put = (p: GardenProject, s: Structure): GardenProject => apply(setItem('structures', s.id, null, s), p);
const plant = (p: GardenProject, plantId: string, x: number, y: number): GardenProject => { const id = sid(); return apply(setItem('plants', id, null, { id, plantId, position: { x, y } }), p); };
const OVERVIEW = { position: [30, 22, 30] as [number, number, number], target: [12, 0, -10] as [number, number, number] };

const garden = (): GardenProject => {
  let p: GardenProject = { ...newGardenProject('g', { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, 'g1'), boundary: boundaryFromPoints(rectanglePoints(24, 20), 'colorbond') };
  p = { ...p, house: { id: 'h', vertices: rectanglePoints(10, 5, { x: 7, y: 13 }).map((position, i) => ({ id: `v${i}`, position })), height: 3.2, fixtures: [] } };
  p = put(p, structure('gate', 12, 0, 0.9, 0.1, 1.5));
  p = put(p, structure('shed', 3, 8, 2.4, 1.8, 2.2));
  p = plant(p, 'syzygium-smithii', 20, 8);
  p = plant(p, 'callistemon-little-john', 12, 7);
  return p;
};
const view = (id: string, x: number, y: number, z: number): SavedView => ({ id, name: `View ${id}`, cameraPosition: [x, y, z], target: [x + 5, 1, z - 5] });

describe('stops chosen from the garden', () => {
  it('an overview, the entrance just inside the gate, then eye-level views from the far corners, around the plot', () => {
    const p = garden();
    const w = buildTourWorld(p, 'mature');
    const stops = autoGardenStops(p, w, OVERVIEW);
    expect(stops[0].label).toBe('Overview');
    expect(stops[0].position).toEqual(OVERVIEW.position);
    expect(stops[1].label).toBe('Entrance');
    expect(stops.length).toBeGreaterThanOrEqual(4);
    expect(stops.slice(2).every((s) => s.label === 'Garden view')).toBe(true);
    // every eye-level stop is where a person could stand, at eye height, inside the plot
    for (const s of stops.slice(1)) {
      expect(s.position[1]).toBe(TOUR_EYE);
      expect(isWalkable(w.walk, { x: s.position[0], y: -s.position[2] }), s.label).toBe(true);
      expect(s.position[0]).toBeGreaterThan(-1); expect(s.position[0]).toBeLessThan(25);
    }
    const entrance = stops[1].position;
    expect(-entrance[2]).toBeLessThan(3); // just inside the gate at the front
    for (const s of stops.slice(2)) expect(Math.hypot(s.position[0] - entrance[0], s.position[2] - entrance[2])).toBeGreaterThanOrEqual(4);
  });

  it('every stop looks at something: the house when it is far enough, otherwise across the plot', () => {
    const p = garden();
    const stops = autoGardenStops(p, buildTourWorld(p, 'mature'), OVERVIEW);
    for (const s of stops.slice(1)) {
      const d = Math.hypot(s.target[0] - s.position[0], s.target[2] - s.position[2]);
      expect(d).toBeGreaterThan(1);
    }
  });

  it('an empty garden still has an overview and, with a plot, somewhere to stand; with nowhere to stand it is just the overview', () => {
    const empty = newGardenProject('e', { label: 'x', lat: -27, lng: 153, state: 'QLD' }, 'e');
    const stops = autoGardenStops(empty, buildTourWorld(empty, 'mature'), OVERVIEW);
    expect(stops[0].label).toBe('Overview');
    expect(stops.length).toBeGreaterThanOrEqual(1);
  });

  it('saved views are the stops when there are two or more; one view is followed by the automatic stops; none means automatic', () => {
    const p = garden();
    const w = buildTourWorld(p, 'mature');
    const two = stopsFor({ ...p, savedViews: [view('a', 5, 3, -5), view('b', 15, 3, -8)] }, w, OVERVIEW);
    expect(two.map((s) => s.label)).toEqual(['View a', 'View b']);
    expect(two.every((s) => s.source === 'saved' && s.dwell === SAVED_DWELL)).toBe(true);
    const one = stopsFor({ ...p, savedViews: [view('a', 5, 3, -5)] }, w, OVERVIEW);
    expect(one[0].label).toBe('View a');
    expect(one.length).toBeGreaterThan(2);
    expect(one.some((s) => s.label === 'Overview')).toBe(false);
    expect(stopsFor(p, w, OVERVIEW)[0].label).toBe('Overview');
  });
});

describe('never flying through anything solid', () => {
  it('blockedBy knows the house, a fence, a shed, a trunk, the leaves and a shrub, and not the open air above or beside them', () => {
    const p = garden();
    const w = buildTourWorld(p, 'mature');
    expect(blockedBy(w, [12, 1.6, -15])).toBe(3.2); // inside the house
    expect(blockedBy(w, [12, 3.4, -15])).toBe(3.2); // just above the roof is still too close
    expect(blockedBy(w, [12, 5, -15])).toBeNull(); // well over the roof
    expect(blockedBy(w, [6, 1, -0.02])).toBe(1.8); // in the fence line (not the gateway at x = 12)
    expect(blockedBy(w, [12, 1, -0.02])).toBeNull(); // the gateway is open
    expect(blockedBy(w, [3, 1, -8])).toBe(2.2); // the shed
    expect(blockedBy(w, [20, 1, -8])).not.toBeNull(); // the tree's trunk
    expect(blockedBy(w, [20, 1.6, -9.5])).toBeNull(); // standing under the leaves, off the trunk
    expect(blockedBy(w, [12, 0.5, -7])).not.toBeNull(); // the shrub
    expect(blockedBy(w, [5, 1.6, -4])).toBeNull(); // open lawn
  });

  it('a leg that would pass through the house gets a waypoint that lifts the camera over it', () => {
    const p = garden();
    const w = buildTourWorld(p, 'mature');
    // from the south side of the house to the north side, at eye height: straight through it
    const a: TourStop = { position: [12, 1.6, -9], target: [12, 1.2, -15], dwell: 2, label: 'south', source: 'auto' };
    const b: TourStop = { position: [12, 1.6, -19.5], target: [12, 1.2, -15], dwell: 2, label: 'north', source: 'auto' };
    const bad = pathProblems(tourFromStops([a, b], false), w);
    expect(bad.length).toBeGreaterThan(0);
    const fixed = clearStops([a, b], false, w);
    expect(fixed.length).toBeGreaterThanOrEqual(4); // up from the first stop, over, and down onto the second (more if a lift brings a new problem)
    expect(fixed[0]).toBe(a); expect(fixed[fixed.length - 1]).toBe(b);
    const lifts = fixed.filter((s) => s.via);
    expect(lifts.length).toBeGreaterThanOrEqual(1);
    expect(lifts.every((s) => s.dwell === 0)).toBe(true);
    expect(Math.max(...lifts.map((s) => s.position[1]))).toBeGreaterThan(3.2 + 0.35);
    expect(pathProblems(tourFromStops(fixed, false), w)).toEqual([]);
  });

  it('a clear leg is left alone', () => {
    const p = garden();
    const w = buildTourWorld(p, 'mature');
    const a: TourStop = { position: [4, 1.6, -3], target: [8, 1.2, -4], dwell: 2, label: 'a', source: 'auto' };
    const b: TourStop = { position: [6, 1.6, -4], target: [8, 1.2, -4], dwell: 2, label: 'b', source: 'auto' };
    expect(clearStops([a, b], false, w)).toHaveLength(2);
  });

  it('the automatic tour of the garden is clear of everything from start to finish, looping, at every tenth of a second', () => {
    const p = garden();
    const w = buildTourWorld(p, 'mature');
    const tour = buildGardenTour(p, w, OVERVIEW, true);
    expect(tour.loop).toBe(true);
    expect(pathProblems(tour, w, 0.1)).toEqual([]);
    for (let t = 0; t <= tour.duration; t += 0.1) expect(samplePose(tour, t).position[1]).toBeGreaterThanOrEqual(MIN_CAMERA_Y);
  });

  it('a tour of saved views that cross the house is lifted over it too', () => {
    const p: GardenProject = { ...garden(), savedViews: [view('a', 12, 1.6, -9), { id: 'b', name: 'View b', cameraPosition: [12, 1.6, -19.5], target: [12, 1.2, -15] }] };
    const w = buildTourWorld(p, 'mature');
    const tour = buildGardenTour(p, w, OVERVIEW, true);
    expect(tour.stops.some((s) => s.via)).toBe(true);
    expect(pathProblems(tour, w)).toEqual([]);
    expect(countedStops(tour)).toBe(2);
  });

  it('eye-level stops are placed where the camera is in the clear, even under a young tree whose leaves a walker could stand in', () => {
    let p = garden();
    for (const [x, y] of [[4, 2], [20, 2], [4, 10], [20, 10], [12, 4]]) p = plant(p, 'syzygium-smithii', x, y);
    const w = buildTourWorld(p, 'yr3');
    const stops = autoGardenStops(p, w, OVERVIEW);
    for (const s of stops.slice(1)) {
      expect(blockedBy(w, s.position), s.label).toBeNull();
      expect(openAbove(w, { x: s.position[0], y: -s.position[2] }), `${s.label} has open sky above`).toBe(true);
    }
  });

  it('holds for many different gardens (houses, sheds, trees and shrubs in the way, at every growth stage)', () => {
    let seed = 777;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let trial = 0; trial < 14; trial += 1) {
      let p = garden();
      for (let i = 0; i < 6; i += 1) {
        const x = 1.5 + rnd() * 21, y = 2 + rnd() * 17;
        if (rnd() < 0.3) p = put(p, structure(rnd() < 0.5 ? 'shed' : 'water_tank', x, y, 1.5 + rnd() * 2, 1.5 + rnd() * 2, 2));
        else p = plant(p, ['syzygium-smithii', 'callistemon-little-john', 'ficus-carica', 'dichondra-repens'][Math.floor(rnd() * 4)], x, y);
      }
      for (const stage of ['planted', 'yr3', 'mature'] as const) {
        const w = buildTourWorld(p, stage);
        const stops = autoGardenStops(p, w, OVERVIEW);
        const tour = buildGardenTour(p, w, OVERVIEW, true);
        expect(stops.slice(1).every((s) => isWalkable(w.walk, { x: s.position[0], y: -s.position[2] })), `trial ${trial} ${stage} stops walkable`).toBe(true);
        // an eye-level stop is never inside a solid; the camera path (apart from the overview stop, which is far above everything) is clear
        const problems = pathProblems(tour, w).filter((q) => q.t > 0.0001);
        expect(problems, `trial ${trial} ${stage}`).toEqual([]);
      }
    }
  });
});

describe('counting stops and sampling', () => {
  it('waypoints are not counted as stops, and the stop shown skips them', () => {
    const p = garden();
    const w = buildTourWorld(p, 'mature');
    const a: TourStop = { position: [12, 1.6, -9], target: [12, 1.2, -15], dwell: 2, label: 'south', source: 'auto' };
    const b: TourStop = { position: [12, 1.6, -19.5], target: [12, 1.2, -15], dwell: 2, label: 'north', source: 'auto' };
    const tour = tourFromStops(clearStops([a, b], true, w), true);
    expect(tour.stops.length).toBeGreaterThan(2);
    expect(countedStops(tour)).toBe(2);
    for (let t = 0; t <= tour.duration; t += 0.5) { const i = countedIndex(tour, t); expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThan(2); }
  });

  it('a looping tour is continuous across the join, and a one-pass tour holds its last stop', () => {
    const p = garden();
    const w = buildTourWorld(p, 'mature');
    const loop = buildGardenTour(p, w, OVERVIEW, true);
    const a = samplePose(loop, loop.duration - 1e-6).position, b = samplePose(loop, 0).position;
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(0.05);
    const once = buildGardenTour(p, w, OVERVIEW, false);
    const end = samplePose(once, once.duration + 100).position;
    const last = once.stops[once.stops.length - 1].position;
    expect(end).toEqual([last[0], Math.max(MIN_CAMERA_Y, last[1]), last[2]]);
  });

  it('the camera rests at every counted stop and moves between them', () => {
    const p = garden();
    const w = buildTourWorld(p, 'mature');
    const tour = buildGardenTour(p, w, OVERVIEW, true);
    const rest = tour.segments.filter((s) => s.kind === 'dwell' && s.t1 > s.t0);
    expect(rest.length).toBe(countedStops(tour));
    const s = rest[1];
    const p1 = samplePose(tour, s.t0 + 0.1).position, p2 = samplePose(tour, s.t1 - 0.1).position;
    expect(p1).toEqual(p2); // not moving while it rests
    expect(sampleTour(tour, rest[0].t1 + 0.5).travelling).toBe(true);
  });
});
