// node client/src/pages/guitar/coachRoute.test.mjs   (a chord change in a Coach session is a route, not a pair)
import assert from 'node:assert';
import { routeStages } from './coachRoute.mjs';

// C#m to E goes by way of A and B, as a real progression in a key that has both chords
const r = routeStages('C#m', 'E', 10);
assert.deepStrictEqual(r.route, ['C#m', 'A', 'E', 'B']);
assert.ok(r.pick.inBetween.includes('A') && r.pick.inBetween.includes('B'));
assert.strictEqual(r.stages.length, 3, 'slow pair, the route, then faster');
assert.strictEqual(r.stages.reduce((n, s) => n + s.minutes, 0), 10, 'the stages use exactly the block minutes');
assert.match(r.stages[1].text, /C#m → A → E → B/);

// a short block still gets all three stages, each at least a minute
const short = routeStages('A', 'E', 3);
assert.ok(short.stages.every(s => s.minutes >= 1));

// two chords with no shared key: no route, said plainly, and the stages still add up
const odd = routeStages('C', 'F#', 6);
assert.strictEqual(odd.route, null);
assert.ok(odd.reason);
assert.match(odd.stages[1].text, /do not share a key/);
assert.strictEqual(odd.stages.reduce((n, s) => n + s.minutes, 0), 6);

console.log('coachRoute tests passed');
