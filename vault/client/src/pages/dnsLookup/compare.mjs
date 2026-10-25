// Compare two resolvers' answers for the same name. TTL is ignored (it counts down differently on each resolver); value and MX priority count.
// Takes the `results` arrays from POST /api/dns-lookup/records and returns [{ type, same, a, b }] for the types both answered without error.

const keyOf = (r) => `${r.priority ?? ''}|${String(r.value).toLowerCase()}`;

export function compareResults(a = [], b = []) {
  const byType = new Map(b.map((r) => [r.type, r]));
  return a.map((ra) => {
    const rb = byType.get(ra.type);
    if (!rb) return { type: ra.type, same: null };
    if (ra.error || rb.error) return { type: ra.type, same: null, error: ra.error || rb.error };
    const ka = ra.records.map(keyOf).sort();
    const kb = rb.records.map(keyOf).sort();
    return { type: ra.type, same: ka.length === kb.length && ka.every((k, i) => k === kb[i]), a: ra.records, b: rb.records };
  });
}
