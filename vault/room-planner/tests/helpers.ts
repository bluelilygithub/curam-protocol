import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { angularDistance, canonicalStringify } from '../src/engine';
import type {
  Command, Fixture, FurnitureDefinition, FurnitureInstance, Project, Room, ValidationViolation, WallSegment, Vertex,
} from '../src/engine';

export const scenarioPath = (name: string): string =>
  join(dirname(fileURLToPath(import.meta.url)), 'scenarios', name);
export const loadScenario = <T = Project>(name: string): T => JSON.parse(readFileSync(scenarioPath(name), 'utf8')) as T;
export const readScenarioText = (name: string): string => readFileSync(scenarioPath(name), 'utf8');

// ---- builders

export function rectVertices(w: number, l: number, prefix = 'v'): Vertex[] {
  return [
    { id: `${prefix}1`, position: { x: 0, y: 0 } },
    { id: `${prefix}2`, position: { x: w, y: 0 } },
    { id: `${prefix}3`, position: { x: w, y: l } },
    { id: `${prefix}4`, position: { x: 0, y: l } },
  ];
}

export function ringWalls(vs: Vertex[], prefix = 'w', thickness = 0.15): WallSegment[] {
  return vs.map((v, i) => ({
    id: `${prefix}${i + 1}`, startVertexId: v.id, endVertexId: vs[(i + 1) % vs.length].id, thickness,
  }));
}

export function makeRoom(over: Partial<Room> = {}): Room {
  const vertices = over.vertices ?? rectVertices(4, 5);
  return {
    id: 'room-1', name: 'Room', floorElevation: 0, wallHeight: 2.7, ceilingHeight: 2.7,
    vertices, walls: ringWalls(vertices), fixtures: [], furniture: [], ...over,
  };
}

export function makeProject(rooms: Room[] = [makeRoom()], defs: FurnitureDefinition[] = []): Project {
  return { schemaVersion: 1, id: 'p1', units: 'metric', rooms, furnitureDefinitions: defs, materials: [] };
}

export function makeInstance(over: Partial<FurnitureInstance> & { id: string }): FurnitureInstance {
  return {
    definitionId: 'box', roomId: 'room-1', position: { x: 2, y: 2 }, elevation: 0, rotation: 0,
    width: 1, length: 1, height: 1, ...over,
  };
}

export function makeDoor(over: Partial<Fixture> & { id: string }): Fixture {
  return {
    type: 'door', wallId: 'w1', offsetAlongWall: 2, width: 0.9, height: 2.1, elevation: 0,
    hingeSide: 'left', swingAngle: Math.PI / 2, ...over,
  };
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as object)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

// ---- C12 comparisons

type Json = unknown;
function compare(a: Json, b: Json, path: string): void {
  if (typeof a === 'number' && typeof b === 'number') {
    if (path.endsWith('rotation')) {
      expect(angularDistance(a, b), `${path}: ${a} vs ${b}`).toBeLessThanOrEqual(1e-9);
    } else if (path.endsWith('swingAngle')) {
      expect(Math.abs(a - b), path).toBeLessThanOrEqual(1e-9);
    } else {
      expect(a, path).toBe(b);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    expect(a.length, `${path}.length`).toBe(b.length);
    a.forEach((x, i) => compare(x, b[i], `${path}[${i}]`));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined).sort();
    const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined).sort();
    expect(ka, `${path} keys`).toEqual(kb);
    for (const k of ka) compare((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  expect(a, path).toEqual(b);
}

/** The single project comparison helper (C12). Linear values exact; rotation within 1e-9 rad with wraparound. */
export function expectProjectEqual(a: Project, b: Project): void {
  compare(a, b, 'project');
}

/** Replay hash (C12): canonical JSON with rotations rounded to 1e-9 rad, then SHA-256. */
export function hashProject(p: Project): string {
  const copy = structuredClone(p);
  const round = (n: number): number => Math.round(n * 1e9) / 1e9;
  for (const r of copy.rooms) for (const f of r.furniture) f.rotation = round(f.rotation) + 0;
  return createHash('sha256').update(canonicalStringify(copy)).digest('hex');
}

export interface ExpectedViolation {
  type: string;
  severity: 'hard' | 'soft';
  objects?: string[];
  fixtures?: string[];
}

const norm = (v: { type: string; severity: string; objects: string[]; fixtures: string[] }): string =>
  `${v.type}|${v.severity}|${[...v.objects].sort().join(',')}|${[...v.fixtures].sort().join(',')}`;

/** Violation matching (C12): type, severity and each sorted ID list. Order and message text are not compared. */
export function expectViolations(actual: ValidationViolation[], expected: ExpectedViolation[]): void {
  const a = actual.map((v) => norm({ type: v.type, severity: v.severity, objects: v.involvedObjectIds, fixtures: v.involvedFixtureIds ?? [] })).sort();
  const e = expected.map((v) => norm({ type: v.type, severity: v.severity, objects: v.objects ?? [], fixtures: v.fixtures ?? [] })).sort();
  expect(a).toEqual(e);
}

export const cmdJson = (c: Command): string => canonicalStringify(c);
