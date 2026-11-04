// node client/src/pages/domains/runAll.test.mjs   (which lookups "run everything" makes, and how results are filed)
import assert from 'node:assert';
import { planRun, assemble, handleOf, takenDomain, tableDefaults, tableNames, domainRows, socialRows, needHandles, columnSummary, verifyTargets } from './runAll.mjs';

const sug = (name, results) => ({ name, results });
const ws = {
  preferred: 'vinoire', shortlist: ['vinoire', 'chillar'],
  suggestions: [sug('vinoire', [{ domain: 'vinoire.com', tld: 'com', available: false }, { domain: 'vinoire.io', tld: 'io', available: true }]), sug('chillar', [])],
};

// the plan: score, social, two prices, compare, and a profile of the taken domain
{
  const p = planRun(ws);
  assert.deepStrictEqual(p.jobs.map((j) => j.key), ['verify', 'score', 'social', 'pricing', 'pricing', 'compare', 'overview']);
  assert.deepStrictEqual(p.jobs[0].body, { names: ['vinoire'], social: false }, 'a live availability check comes first');
  assert.strictEqual(p.jobs[1].url, '/api/domains/score?domain=vinoire');
  assert.strictEqual(p.jobs[2].url, '/api/domains/social?username=vinoire');
  assert.strictEqual(p.jobs[3].url, '/api/domains/pricing?domain=vinoire.com');
  assert.strictEqual(p.jobs[4].url, '/api/domains/pricing?domain=vinoire.com.au');
  assert.deepStrictEqual(p.jobs[5].body, { domains: ['vinoire', 'chillar'] });
  assert.strictEqual(p.jobs[6].url, '/api/domains/overview?domain=vinoire.com');
  assert.deepStrictEqual(p.skipped, []);
}
// nothing chosen: nothing runs
{
  const p = planRun({ preferred: '  ', shortlist: [] });
  assert.deepStrictEqual(p.jobs, []);
  assert.match(p.skipped[0].reason, /preferred name/);
}
// fewer than two shortlisted: compare is skipped with a reason, the rest still runs
{
  const p = planRun({ ...ws, shortlist: ['vinoire'] });
  assert.ok(!p.jobs.some((j) => j.key === 'compare'));
  assert.match(p.skipped.find((s) => s.key === 'compare').reason, /at least two/);
  assert.ok(p.jobs.some((j) => j.key === 'score'));
}
// compare takes at most five, without repeats
assert.strictEqual(planRun({ ...ws, shortlist: ['a', 'b', 'a', 'c', 'd', 'e', 'f'] }).jobs.find((j) => j.key === 'compare').body.domains.length, 5);
// profile only for a registered domain: all free, or never checked, says why
{
  const free = planRun({ ...ws, suggestions: [sug('vinoire', [{ domain: 'vinoire.com', tld: 'com', available: true }])] });
  assert.ok(!free.jobs.some((j) => j.key === 'overview'));
  assert.match(free.skipped.find((s) => s.key === 'overview').reason, /free/);
  const unchecked = planRun({ ...ws, suggestions: [sug('vinoire', [])] });
  assert.match(unchecked.skipped.find((s) => s.key === 'overview').reason, /not checked/);
  const typed = planRun({ preferred: 'mybrand', shortlist: [], suggestions: [] });
  assert.match(typed.skipped.find((s) => s.key === 'overview').reason, /not checked/);
}
// .com is profiled before .com.au, and either before another ending
assert.strictEqual(takenDomain(sug('x', [{ domain: 'x.io', tld: 'io', available: false }, { domain: 'x.com.au', tld: 'com.au', available: false }, { domain: 'x.com', tld: 'com', available: false }])), 'x.com');
assert.strictEqual(takenDomain(sug('x', [{ domain: 'x.io', tld: 'io', available: false }, { domain: 'x.com.au', tld: 'com.au', available: false }])), 'x.com.au');
assert.strictEqual(takenDomain(null), null);
// a name with spaces or symbols gives a usable handle
assert.strictEqual(handleOf('Blue Lily & Co!'), 'bluelilyco');
assert.strictEqual(planRun({ preferred: 'Blue Lily', shortlist: [], suggestions: [] }).jobs[2].url, '/api/domains/social?username=bluelily');

// filing results: pricing from both endings is kept together; a failed job is an error, not a missing result
{
  const p = planRun(ws);
  const out = p.jobs.map((j) => (j.key === 'social' ? { ok: false, error: 'rate limited' } : j.key === 'pricing' ? { ok: true, data: { for: j.ending } } : j.key === 'verify' ? { ok: true, data: { checks: [{ name: 'vinoire' }] } } : { ok: true, data: { k: j.key } }));
  const { results, errors, verified } = assemble(p, out);
  assert.deepStrictEqual(verified, [{ name: 'vinoire' }]);
  assert.ok(!('verify' in results), 'the live check is not a result to show');
  assert.deepStrictEqual(results.pricing, { com: { for: 'com' }, 'com.au': { for: 'com.au' } });
  assert.deepStrictEqual(results.score, { k: 'score' });
  assert.strictEqual(errors.social, 'rate limited');
  assert.ok(!('social' in results));
  assert.ok(!('all' in errors));
}
// a failed live check is reported, and does not stop the rest
{
  const p = planRun(ws);
  const { results, errors, verified } = assemble(p, p.jobs.map((j) => (j.key === 'verify' ? { ok: false, error: 'service down' } : { ok: true, data: { k: j.key } })));
  assert.strictEqual(errors.verify, 'service down');
  assert.strictEqual(verified, null);
  assert.deepStrictEqual(results.score, { k: 'score' });
}
// a skipped tool shows its reason where its result would be
{
  const p = planRun({ ...ws, shortlist: [] });
  const { errors } = assemble(p, p.jobs.map(() => ({ ok: true, data: {} })));
  assert.match(errors.compare, /at least two/);
}


// ── the side-by-side table ──
const R = (tld, available) => ({ domain: 'x.' + tld, tld, available });
const many = {
  suggestions: [
    sug('alpha', [R('com', false), R('com.au', false), R('io', true)]),
    sug('bravo', [R('com', true), R('com.au', true), R('io', true), R('ai', true)]),
    sug('charlie', [R('com', false), R('io', false)]),
    sug('delta', [R('com.au', true)]),
    sug('echo', [R('app', true), R('ai', true), R('co', true)]),
  ],
  preferred: '', shortlist: [], tableNames: [],
};
// no choices yet: the best three, a free .com or .com.au first, then the most free endings
assert.deepStrictEqual(tableDefaults(many), ['bravo', 'delta', 'echo']);
// the preferred name and then the shortlist come first
assert.deepStrictEqual(tableDefaults({ ...many, preferred: 'charlie', shortlist: ['alpha', 'charlie', 'echo'] }), ['charlie', 'alpha', 'echo']);
// a name that is not one of the suggestions is ignored; fewer than three suggestions give fewer columns
assert.deepStrictEqual(tableDefaults({ ...many, preferred: 'ghost' }), ['bravo', 'delta', 'echo']);
assert.deepStrictEqual(tableDefaults({ suggestions: [sug('solo', [])], shortlist: [], preferred: '' }), ['solo']);
assert.deepStrictEqual(tableDefaults({ suggestions: null }), []);
// the person's own choice wins where still valid; the gaps are filled from the defaults
assert.deepStrictEqual(tableNames({ ...many, tableNames: ['echo', 'alpha', 'charlie'] }), ['echo', 'alpha', 'charlie']);
assert.deepStrictEqual(tableNames({ ...many, tableNames: ['echo', 'gone'] }), ['echo', 'bravo', 'delta']);
assert.deepStrictEqual(tableNames({ ...many, tableNames: ['echo', 'echo', 'echo'] }).length, 3, 'a repeat does not leave an empty column');

// domain rows: every standard ending, each name's state
{
  const names = ['alpha', 'bravo'];
  const rows = domainRows(many, names);
  assert.deepStrictEqual(rows.map((r) => r.tld), ['com', 'com.au', 'org', 'io', 'ai', 'co', 'app']);
  assert.deepStrictEqual(rows[0].cells.map((c) => c.state), ['taken', 'free']);
  assert.deepStrictEqual(rows[4].cells.map((c) => c.state), ['unknown', 'free'], 'an ending that was not checked is unknown, not free');
  assert.deepStrictEqual(rows[2].cells.map((c) => c.state), ['unknown', 'unknown'], '.org was not in an older check: unknown, never free');
  assert.strictEqual(rows[0].cells[0].domain, 'x.com');
  // an unusual ending the service returned is added after the standard ones
  const odd = domainRows({ suggestions: [sug('z', [R('xyz', true)])] }, ['z']);
  assert.strictEqual(odd[odd.length - 1].tld, 'xyz');
}
// social rows: platforms from every name, an unchecked name is shown as unchecked, a platform the other name lacks is unknown
{
  const handles = {
    alpha: { availability: { instagram: { available: true, profile_url: 'https://i/alpha' }, tiktok: { available: false } } },
    bravo: { availability: { instagram: { available: false }, github: { available: true } } },
  };
  const rows = socialRows(handles, ['alpha', 'bravo', 'charlie']);
  assert.deepStrictEqual(rows.map((r) => r.platform), ['github', 'instagram', 'tiktok']);
  const insta = rows.find((r) => r.platform === 'instagram');
  assert.deepStrictEqual(insta.cells.map((c) => c.state), ['free', 'taken', 'unchecked']);
  assert.strictEqual(insta.cells[0].url, 'https://i/alpha');
  assert.deepStrictEqual(rows.find((r) => r.platform === 'github').cells.map((c) => c.state), ['unknown', 'free', 'unchecked']);
  assert.deepStrictEqual(needHandles(handles, ['alpha', 'bravo', 'charlie']), ['charlie']);
  assert.deepStrictEqual(needHandles(null, ['a']), ['a']);
  assert.deepStrictEqual(socialRows(null, ['a']), []);
  // the summary under a column
  const dr = domainRows(many, ['alpha', 'bravo']);
  assert.deepStrictEqual(columnSummary(dr, rows, 1), { domainsFree: 4, domainsTotal: 7, handlesFree: 1, handlesTotal: 3 });
  assert.strictEqual(columnSummary(dr, rows, 2).handlesFree, null, 'unchecked handles have no count');
}

// Verify now checks the preferred name, the shortlist and the table's names, at most five
assert.deepStrictEqual(verifyTargets({ ...many, preferred: 'alpha', shortlist: ['bravo'], tableNames: ['echo', 'charlie', 'delta'] }), ['alpha', 'bravo', 'echo', 'charlie', 'delta']);
assert.deepStrictEqual(verifyTargets({ ...many, preferred: 'ghost', shortlist: ['gone'], tableNames: [] }), ['bravo', 'delta', 'echo'], 'names that are not suggestions are ignored; the table supplies the rest');
assert.deepStrictEqual(verifyTargets({ suggestions: null }), []);
assert.strictEqual(verifyTargets({ ...many, preferred: 'alpha', shortlist: ['bravo', 'charlie', 'delta', 'echo'] }).length, 5);

console.log('runAll tests passed');
