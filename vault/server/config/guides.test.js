'use strict';

// node server/config/guides.test.js   (npm run test:guides)
// Keeps every guide chat on the shared component and in the shared registry, so a new guide automatically gets the same
// behaviour (readable tooltip, email the conversation, drag, wide/narrow, microphone) and cannot be added half-wired.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { GUIDES } = require('./guides');

const clientSrc = path.join(__dirname, '../../client/src');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const files = walk(clientSrc).filter((f) => /\.jsx?$/.test(f));

// guides = files that use the shared chat component (not the component itself)
const guideFiles = files.filter((f) => !f.includes(`${path.sep}components${path.sep}tutor${path.sep}`) && /from '[./]*(?:[./]+)components\/tutor\/TutorChat'/.test(fs.readFileSync(f, 'utf8')));
assert.ok(guideFiles.length >= 4, `found ${guideFiles.length} guide wrapper files`);

const REQUIRED = ['endpoint', 'guideId', 'payloadKey', 'name', 'shortName', 'subtitle', 'intro', 'starters', 'verdicts', 'buttonTip', 'openTip', 'busyText', 'placeholder', 'inputLabel', 'errorText', 'wideKey'];
const indexJs = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const manifestFile = JSON.parse(fs.readFileSync(path.join(__dirname, '../testing/routeManifest.json'), 'utf8'));
const manifest = manifestFile.routes || manifestFile;
const seen = {}; const wideKeys = new Set();

for (const f of guideFiles) {
  const rel = path.relative(clientSrc, f);
  const text = fs.readFileSync(f, 'utf8');
  const cfg = text.slice(text.indexOf('const CONFIG = {'));
  assert.ok(cfg.startsWith('const CONFIG = {'), `${rel} defines a CONFIG`);
  for (const key of REQUIRED) assert.ok(new RegExp(`^\\s{2}${key}:`, 'm').test(cfg), `${rel}: config has "${key}"`);
  const id = cfg.match(/^\s{2}guideId: '([a-z0-9-]+)'/m)?.[1];
  const endpoint = cfg.match(/^\s{2}endpoint: '([^']+)'/m)?.[1];
  const name = cfg.match(/^\s{2}name: '([^']+)'/m)?.[1];
  const wideKey = cfg.match(/^\s{2}wideKey: '([^']+)'/m)?.[1];
  assert.ok(GUIDES[id], `${rel}: guideId "${id}" is listed in server/config/guides.js`);
  assert.strictEqual(name, GUIDES[id].name, `${rel}: name matches the registry`);
  assert.strictEqual(endpoint, GUIDES[id].endpoint, `${rel}: endpoint matches the registry`);
  assert.ok(!seen[id], `guide "${id}" is used by only one wrapper (${seen[id]} and ${rel})`);
  seen[id] = rel;
  assert.ok(!wideKeys.has(wideKey), `${rel}: wideKey "${wideKey}" is unique`);
  wideKeys.add(wideKey);
  // the server side exists: the endpoint is mounted, and classified for the route test
  assert.ok(manifest[`POST ${endpoint}`], `${rel}: POST ${endpoint} is in routeManifest.json`);
  const segs = endpoint.split('/').filter(Boolean); // api, x, (y)
  assert.ok(indexJs.includes(`'/${segs[0]}/${segs[1]}'`), `${rel}: /${segs[0]}/${segs[1]} is mounted in server/index.js`);
}

// every registered guide has a client wrapper
for (const id of Object.keys(GUIDES)) assert.ok(seen[id], `registered guide "${id}" has a wrapper on the client`);

// the shared component offers the email panel only to guides that say who they are, and the server route knows exactly these guides
const chat = fs.readFileSync(path.join(clientSrc, 'components/tutor/TutorChat.jsx'), 'utf8');
assert.match(chat, /config\.guideId/);
assert.match(chat, /\/api\/tutor-email/);
const { GUIDES: emailGuides } = require('../routes/tutorEmail');
assert.deepStrictEqual(Object.keys(emailGuides).sort(), Object.keys(GUIDES).sort(), 'the email route accepts exactly the registered guides');
Object.entries(GUIDES).forEach(([id, g]) => assert.strictEqual(emailGuides[id], g.name));

console.log(`guides tests passed (${guideFiles.length} guides: ${Object.keys(seen).join(', ')})`);
