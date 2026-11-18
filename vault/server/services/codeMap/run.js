#!/usr/bin/env node
'use strict';

// Command-line runner for the Code Map analyzer.
//   node server/services/codeMap/run.js [out.json] [--root <vault dir>]
// Prints a summary and, when a path is given, writes the full result there as JSON.
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { analyze } = require('./index');

function main(argv) {
  let root = path.resolve(__dirname, '../../..');
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i]);
    else out = argv[i];
  }
  const r = analyze({ root, log: null });
  const s = r.summary;
  console.log(`Code Map of ${root}`);
  console.log(`  ${s.files} files (${s.tests} tests), ${s.locServer.toLocaleString()} server lines, ${s.locClient.toLocaleString()} client lines, ${s.locTests.toLocaleString()} test lines`);
  console.log(`  ${s.tools} tools, ${s.mounts} mounts, ${s.routesFiles} route files, ${s.cycles} import cycles, ${r.edges.length} tool links`);
  console.log(`  ${r.orphans.length} possibly unused files, ${r.backups.length} backups, ${r.packages.length} separate packages`);
  console.log(`  ${s.findings} findings, ${s.gaps} failed or warning checks, ${r.durationMs} ms`);
  const avg = Math.round(r.tools.reduce((n, t) => n + t.score, 0) / (r.tools.length || 1));
  console.log(`  average tool score ${avg}%`);
  console.log('\nFindings:');
  for (const f of r.findings) {
    console.log(`  [${f.sev.padEnd(6)}] ${f.title}${f.tools.length ? ` - ${f.tools.slice(0, 8).join(', ')}${f.tools.length > 8 ? ', ...' : ''}` : ''}`);
  }
  if (out) {
    fs.writeFileSync(out, JSON.stringify(r, null, 1));
    console.log(`\nWrote ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { main };
