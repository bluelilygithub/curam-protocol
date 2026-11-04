'use strict';

// A stand-in for the AI model and DomScan, switched on with DOMAIN_PROVIDER=fake. For trying the Domain page in a browser, and for
// tests, with no keys, no credits and the same answers every time (like MUSIC_PROVIDER=fake). It is NEVER used unless that variable is
// set, and the page says "test mode" when it is. Nothing here is a real availability result.

const crypto = require('crypto');

const hash = (s) => parseInt(crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8), 16);
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

const SYL = ['lu', 'me', 'ra', 'to', 'vi', 'no', 'el', 'sa', 'ka', 'bri', 'dan', 'fen', 'gal', 'hex', 'jun', 'kor', 'lim', 'mar', 'nel', 'ori', 'pel', 'qui', 'rin', 'sol', 'tan', 'ula', 'ven', 'wyn', 'yar', 'zel', 'cae', 'dov', 'ash', 'bel'];
const STYLES = ['invented', 'metaphor', 'compound', 'descriptive'];
// some deliberately poor names so the filters have something to do
const BAD = ['getfridge', 'fridgehub', 'googel', 'phloughtique', 'ab', 'shop4u'];

function wide(prompt) {
  const r = rng(hash(prompt.slice(0, 600)));
  const themes = ((prompt.match(/Words or themes to work in: (.+)/) || [])[1] || '').split(',').map((w) => w.trim().toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean);
  const liked = ((prompt.match(/The client liked: ([^.]+)\./) || [])[1] || '').split(',').map((w) => w.trim()).filter(Boolean);
  const lines = [];
  for (let i = 0; i < 170; i += 1) {
    const n = 2 + Math.floor(r() * 2);
    let name = '';
    for (let k = 0; k < n; k += 1) name += SYL[Math.floor(r() * SYL.length)];
    lines.push(`${name}|${STYLES[i % STYLES.length]}`);
  }
  for (const t of themes.slice(0, 3)) for (let i = 0; i < 4; i += 1) lines.push(`${t}${SYL[Math.floor(r() * SYL.length)]}${SYL[Math.floor(r() * SYL.length)]}|compound`);
  for (const l of liked.slice(0, 2)) for (let i = 0; i < 4; i += 1) lines.push(`${l.slice(0, 3)}${SYL[Math.floor(r() * SYL.length)]}${SYL[Math.floor(r() * SYL.length)]}|invented`);
  return [...lines, ...BAD.map((b) => `${b}|invented`)].join('\n');
}

function explain(prompt) {
  const names = [...prompt.matchAll(/^- ([a-z0-9-]+)(?: \(the client's own name: [^)]*\))?(?: \[([a-z]+)\])?/gm)];
  return JSON.stringify(names.map((m, i) => ({
    name: m[1],
    reasoning: `Built from the sounds in "${m[1]}", a ${m[2] || 'chosen'} name that suits the brief. (Test mode: not written by an AI.)`,
    risks: i % 4 === 1 ? [`Could be misheard as "${m[1].slice(0, -1)}".`] : [],
  })));
}

async function callModel(model, prompt) {
  const text = prompt.includes('\n<question>\n')
    ? `(Test mode, not an AI answer.) From the names listed, I would lean towards the ones with your required endings free and an easy spelling. Tell me more about who it is for and I can narrow it down.`
    : /ONLY a JSON array/.test(prompt) ? explain(prompt) : wide(prompt);
  return { text, model, inputTokens: 0, outputTokens: 0 };
}

// free more often for the less popular endings, as in real life
const TAKEN_PERCENT = { com: 62, 'com.au': 28, org: 35, io: 40, ai: 38, co: 30, app: 24 };
async function statusFor(name, tldList) {
  const tlds = String(tldList).split(',').map((t) => t.trim()).filter(Boolean);
  return { results: tlds.map((tld) => ({ domain: `${name}.${tld}`, tld, available: hash(`${name}.${tld}`) % 100 >= (TAKEN_PERCENT[tld] ?? 30), source: 'rdap' })) };
}

const PLATFORMS = ['instagram', 'twitter', 'tiktok', 'facebook', 'youtube', 'linkedin', 'github', 'threads', 'pinterest', 'reddit'];
async function domscan(path, params = {}) {
  if (path === '/social') {
    const handle = String(params.handle || '');
    return {
      handle, checked_at: new Date().toISOString(),
      availability: Object.fromEntries(PLATFORMS.map((p) => [p, { available: hash(`${handle}@${p}`) % 100 >= 35, checked: true, confidence: 'medium', method: 'public_endpoint' }])),
    };
  }
  if (path === '/status') return statusFor(params.name, params.tlds);
  if (path === '/overview') return { domain: params.domain, test_mode: true, registered: true };
  return {};
}

module.exports = { getModels: async () => ({ standard: 'fake-model', light: 'fake-model' }), callModel, logUsage: () => {}, statusFor, domscan, fake: true };
