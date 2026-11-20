#!/usr/bin/env node
'use strict';

/**
 * Builds the standalone DocCompare app (vault/doc-compare/) into vault/dist/doc-compare-app/ so the Express static handler serves it next to the
 * Vault client. Runs after the client build (which empties dist/).
 *
 * Deliberately NON-FATAL: DocCompare is a self-contained add-on, and a failure here must not take the whole Vault deploy down. It logs loudly and
 * exits 0; the /doc-compare page then shows a "not built" notice instead of the app.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'doc-compare');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';

function run(args, label) {
  const r = spawnSync(npm, args, { cwd: dir, stdio: 'inherit', shell });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

try {
  if (!fs.existsSync(dir)) throw new Error('doc-compare/ folder not found');
  if (!fs.existsSync(path.join(dir, 'node_modules', 'vite'))) run(['install', '--include=dev', '--no-audit', '--no-fund'], 'doc-compare install');
  run(['run', 'build'], 'doc-compare build');
  console.log('[doc-compare] built into dist/doc-compare-app');
} catch (e) {
  console.warn(`\n[doc-compare] WARNING: ${e.message}. Vault build continues without DocCompare.\n`);
}
