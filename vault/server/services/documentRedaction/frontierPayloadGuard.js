'use strict';

/**
 * Hard safety net: reject any outgoing frontier payload that still contains
 * a known original (real) entity value from the job's entity map.
 */

function collectRealValues(entityMap) {
  const values = [];
  for (const entry of entityMap?.entries || []) {
    const real = String(entry.realValue || '').trim();
    if (real.length >= 3) values.push(real);
  }
  // Longest first so substrings don't hide longer hits in reporting
  values.sort((a, b) => b.length - a.length);
  return [...new Set(values)];
}

/**
 * @param {string|string[]} texts — prompt fragments, extracted PDF text, etc.
 * @param {object} entityMap
 * @throws Error with code ENTITY_LEAK_IN_PAYLOAD
 */
function assertNoRealEntitiesInOutgoingPayload(texts, entityMap) {
  const parts = (Array.isArray(texts) ? texts : [texts])
    .map((t) => String(t || ''));
  const combined = parts.join('\n');
  const reals = collectRealValues(entityMap);
  const hits = [];
  for (const real of reals) {
    if (combined.includes(real)) {
      hits.push({
        categoryLabel: (entityMap.entries || []).find((e) => e.realValue === real)?.categoryLabel || null,
        length: real.length,
        // Never echo the real value into the error message body that might be logged to clients
        masked: `${real[0]}…${real[real.length - 1]} (${real.length} chars)`,
      });
    }
  }
  if (hits.length) {
    const err = new Error(
      `Refusing frontier call: ${hits.length} known original entit(y/ies) detected in outgoing payload. `
      + 'Fix leftovers / re-apply before sending to a frontier model.',
    );
    err.status = 409;
    err.code = 'ENTITY_LEAK_IN_PAYLOAD';
    err.hits = hits;
    throw err;
  }
  return { ok: true, checkedValues: reals.length, bytesScanned: Buffer.byteLength(combined, 'utf8') };
}

module.exports = {
  assertNoRealEntitiesInOutgoingPayload,
  collectRealValues,
};
