// Performance smoke tests (Test Plan §6): deterministic ceilings on perf-100.json. If a ceiling is exceeded the fix is
// algorithmic (broad-phase, caching), never "raise the ceiling" — that is a Spec change.
import { describe, expect, it } from 'vitest';
import {
  apply, CommandHistory, deserializeProject, generateSnapCandidates, inverse, rankSnapCandidates, serializeProject,
  validateInstance, validateRoom,
} from '../../src/engine';
import type { Command } from '../../src/engine';
import { loadScenario, makeInstance, readScenarioText } from '../helpers';

/** Median of N runs: robust against a single GC pause on a busy CI machine. */
function timeMs(fn: () => void, runs = 9): number {
  fn(); // warm up
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    fn();
    t.push(performance.now() - s);
  }
  return t.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

const project = loadScenario('perf-100.json');
const room = project.rooms[0];

describe('perf-100 ceilings', () => {
  it('full validation pass, 100 objects, one candidate: < 5 ms', () => {
    const candidate = makeInstance({ id: 'cand', position: { x: 4.1, y: 4.1 }, width: 0.5, length: 0.5 });
    expect(timeMs(() => validateInstance(room, project.furnitureDefinitions, candidate))).toBeLessThan(5);
  });
  it('snap candidate generation + ranking: < 2 ms', () => {
    const moving = { position: { x: 4.1, y: 4.1 }, width: 0.5, length: 0.5, rotation: 0 };
    expect(timeMs(() => rankSnapCandidates(generateSnapCandidates({ moving, room, others: room.furniture })))).toBeLessThan(2);
  });
  it('single apply (composite, 10 sub-commands): < 1 ms', () => {
    const subs: Command[] = room.furniture.slice(0, 10).map((f) => ({
      type: 'MoveFurniture', instanceId: f.id, from: f.position, to: { x: f.position.x + 0.001, y: f.position.y },
    }));
    const composite: Command = { type: 'Composite', commands: subs };
    expect(timeMs(() => apply(composite, project))).toBeLessThan(1);
  });
  it('serialize + deserialize the full project: < 10 ms', () => {
    expect(timeMs(() => deserializeProject(serializeProject(project)))).toBeLessThan(10);
  });
  it('fixture load + validate + replay of a 50-command history: < 50 ms', () => {
    const cmds: Command[] = [];
    for (let i = 0; i < 25; i++) {
      const f = room.furniture[i];
      cmds.push({ type: 'MoveFurniture', instanceId: f.id, from: f.position, to: { x: f.position.x + 0.002, y: f.position.y } });
      cmds.push({ type: 'MoveFurniture', instanceId: f.id, from: { x: f.position.x + 0.002, y: f.position.y }, to: f.position });
    }
    const t = timeMs(() => {
      let s = deserializeProject(readScenarioText('perf-100.json'));
      validateRoom(s.rooms[0], s.furnitureDefinitions);
      const h = new CommandHistory();
      for (const c of cmds) { s = apply(c, s); h.push(c); }
      void inverse(cmds[0]);
    }, 5);
    expect(t).toBeLessThan(50);
  });
});
