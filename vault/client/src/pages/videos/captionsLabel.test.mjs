import assert from 'node:assert/strict';
import { captionsLabel } from './captionsLabel.mjs';

assert.equal(captionsLabel(null), '');
assert.equal(captionsLabel(undefined), '');
assert.equal(captionsLabel('x'), '');
assert.equal(captionsLabel({ provenance: 'manual', languageName: 'English' }), ' (written by a person in English)');
assert.equal(captionsLabel({ provenance: 'manual', languageCode: 'en' }), ' (written by a person in en)', 'the code when there is no name');
assert.equal(captionsLabel({ provenance: 'manual' }), ' (written by a person)', 'no language known');
assert.equal(captionsLabel({ provenance: 'auto', languageName: 'English (auto-generated)' }), " (made by YouTube's speech recognition in English (auto-generated), so it may mishear names and numbers)");
assert.match(captionsLabel({ provenance: 'auto' }), /^ \(made by YouTube's speech recognition, so it may mishear names and numbers\)$/);
assert.equal(captionsLabel({ provenance: 'unknown', languageName: 'French' }), ' (French; who wrote it is unknown)');
assert.equal(captionsLabel({ provenance: 'unknown' }), '', 'nothing known: nothing said');
assert.equal(captionsLabel({}), '');
console.log('captionsLabel.test.mjs: all passed');
