// Shape numbers: a small number on each box so a person can say "after 7" or "if 4.1 is no". The number is saved on the box itself
// (customData.vaultNo) and never changes once given. Pure functions; test: node client/src/pages/drawings/shapeNumbers.test.mjs
//
// Rules for a box that has no number yet:
//  - it sits BETWEEN two numbered boxes (an arrow in from one, an arrow out to another): a sub-number of the one before it, so a step
//    put in after 4 is 4.1, the next one put in after 4 is 4.2 (it reads in order, and nothing else is renumbered);
//  - anything else (added at the start or the end, a branch, or on its own): the next whole number after the biggest used so far.

const NUM_RE = /^\d{1,4}(\.\d{1,3}){0,4}$/;
export const isNumber = (s) => typeof s === 'string' && NUM_RE.test(s);

const whole = (n) => parseInt(String(n).split('.')[0], 10);

/**
 * @param {Array<{id:string,num?:string}>} nodes  in reading order
 * @param {Array<{from:string,to:string}>} edges  between node ids
 * @param {Iterable<string>} [alsoTaken]  numbers that must not be reused (for example those of deleted boxes)
 * @returns {Map<string,string>} id -> number, for the nodes that had none
 */
export function assignNumbers(nodes, edges, alsoTaken = []) {
  const numOf = new Map(nodes.filter((n) => isNumber(n.num)).map((n) => [n.id, n.num]));
  const taken = new Set([...numOf.values(), ...[...alsoTaken].filter(isNumber)]);
  let top = 0;
  for (const t of taken) top = Math.max(top, whole(t));
  const given = new Map();
  for (const n of nodes) {
    if (numOf.has(n.id)) continue;
    const before = edges.filter((e) => e.to === n.id && numOf.has(e.from)).map((e) => e.from);
    const after = edges.filter((e) => e.from === n.id && numOf.has(e.to)).map((e) => e.to);
    let num;
    if (before.length && after.length) {
      const parent = numOf.get(before[0]);
      let k = 1;
      while (taken.has(`${parent}.${k}`)) k += 1;
      num = `${parent}.${k}`;
    } else {
      top += 1;
      num = String(top);
    }
    taken.add(num);
    numOf.set(n.id, num);
    given.set(n.id, num);
  }
  return given;
}
