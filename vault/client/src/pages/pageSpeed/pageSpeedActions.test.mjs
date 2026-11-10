// node client/src/pages/pageSpeed/pageSpeedActions.test.mjs   (the Page speed Actions tab logic). No network.
import assert from 'assert';
import {
  buildActions, auditIdFor, actionsText, ACTION_HELP, WHO, EFFORT, PRIORITY_GROUPS, CATEGORY_WHY, METRIC_HELP,
} from './pageSpeedActions.mjs';

const mobile = {
  strategy: 'mobile',
  opportunities: [{ id: 'uses-text-compression', title: 'Enable text compression' }],
  failedAudits: [{ id: 'image-alt', title: 'Image elements do not have [alt] attributes' }, { id: 'aria-roles', title: 'ARIA roles are not valid' }],
  diagnostics: [],
  warnings: [],
  workOrder: [
    { priority: 'P0', category: 'performance', categoryLabel: 'Performance', title: 'Serve one host — drop the extra redirect', action: 'tech', evidence: ['a'] },
    { priority: 'P0', category: 'accessibility', categoryLabel: 'Accessibility', title: 'Image elements do not have [alt] attributes', action: 'tech2', evidence: [] },
    { priority: 'P0', category: 'accessibility', categoryLabel: 'Accessibility', title: 'ARIA roles are not valid', action: 'tech3' },
    { priority: 'P1', category: 'performance', categoryLabel: 'Performance', title: 'Enable text compression', action: 'tech4' },
    { priority: 'P2', category: 'seo', categoryLabel: 'SEO', title: 'Something brand new from Lighthouse', action: 'raw action' },
  ],
};
const desktop = { strategy: 'desktop', workOrder: [{ priority: 'P0', title: 'Serve one host — drop the extra redirect', category: 'performance' }] };

// every help entry is complete and uses known who/effort keys
for (const [id, h] of Object.entries(ACTION_HELP)) {
  assert.ok(h.plain && h.how, `${id} has plain and how`);
  assert.ok(WHO[h.who], `${id} who is known`);
  assert.ok(EFFORT[h.effort], `${id} effort is known`);
}
for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) assert.ok(CATEGORY_WHY[c], `${c} has a reason`);
assert.deepStrictEqual(PRIORITY_GROUPS.map((g) => g.id), ['P0', 'P1', 'P2']);
assert.ok(Object.keys(METRIC_HELP).length === 6);

// matching tickets to audits
assert.strictEqual(auditIdFor(mobile.workOrder[0], mobile), 'redirects', 'curated title is matched');
assert.strictEqual(auditIdFor(mobile.workOrder[1], mobile), 'image-alt', 'generic ticket matched by title');
assert.strictEqual(auditIdFor(mobile.workOrder[4], mobile), '', 'unknown stays empty');

const acts = buildActions(mobile, desktop);
assert.strictEqual(acts.length, 5);
assert.strictEqual(acts[0].title, ACTION_HELP.redirects.plain);
assert.strictEqual(acts[0].who, WHO.host);
assert.strictEqual(acts[0].alsoOther, true, 'redirect is on desktop too');
assert.strictEqual(acts[1].alsoOther, false, 'alt text is mobile only');
assert.strictEqual(acts[1].who, WHO.content);
assert.strictEqual(acts[2].title, ACTION_HELP['aria-generic'].plain, 'any aria-* audit gets the ARIA help');
assert.strictEqual(acts[4].title, 'Something brand new from Lighthouse', 'unknown keeps the Lighthouse title');
assert.strictEqual(acts[4].why, CATEGORY_WHY.seo, 'unknown falls back to the category reason');
assert.strictEqual(acts[4].plainKnown, false);
assert.strictEqual(buildActions(mobile)[0].alsoOther, null, 'no other view -> no comparison');
assert.deepStrictEqual(buildActions({}), [], 'old/empty view -> no actions');

const txt = actionsText(acts, { strategy: 'mobile', url: 'https://x.com', done: new Set([acts[0].key]) });
assert.match(txt, /## Fix first/);
assert.match(txt, /\[x\] The address bounces/);
assert.match(txt, /## When there is time/);

console.log('pageSpeedActions tests passed');
