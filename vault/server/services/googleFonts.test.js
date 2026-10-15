'use strict';
const assert = require('assert');
const { looksLikeSfnt, fontWeightNum } = require('./googleFonts');

const pad = (head) => Buffer.concat([Buffer.from(head, 'latin1'), Buffer.alloc(20)]);
assert.ok(looksLikeSfnt(pad('\x00\x01\x00\x00')), 'TrueType');
assert.ok(looksLikeSfnt(pad('true')), 'Apple TrueType');
assert.ok(looksLikeSfnt(pad('OTTO')), 'OpenType (CFF)');
assert.ok(!looksLikeSfnt(pad('wOFF')), 'WOFF is not usable by ffmpeg');
assert.ok(!looksLikeSfnt(pad('wOF2')), 'WOFF2 is not usable by ffmpeg');
assert.ok(!looksLikeSfnt(Buffer.from([0x4c, 0xe6, 0x01, 0x00, ...new Array(20).fill(0)])), 'EOT (what the old identity now gets) is rejected');
assert.ok(!looksLikeSfnt(Buffer.from('<!DOCTYPE html><html>error page')), 'an error page is rejected');
assert.ok(!looksLikeSfnt(Buffer.alloc(4)), 'too short');
assert.ok(!looksLikeSfnt(null));
assert.strictEqual(fontWeightNum('bold'), 700);
assert.strictEqual(fontWeightNum('normal'), 400);

console.log('googleFonts tests passed');
