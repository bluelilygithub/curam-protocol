#!/usr/bin/env node
'use strict';

/**
 * Builds the standalone Route Tracer (vault/route-tracer/) into vault/dist/route-tracer-app/ so the Express static
 * handler serves it next to the Vault client. Runs after the client build (which empties dist/).
 *
 * Deliberately NON-FATAL: Route Tracer is a self-contained add-on, and a failure here must not take the whole Vault
 * deploy down. It logs loudly and exits 0; the /route-tracer page then shows a "not built" notice instead of the app.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'route-tracer');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';

function run(args, label) {
  const r = spawnSync(npm, args, { cwd: dir, stdio: 'inherit', shell });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

try {
  if (!fs.existsSync(dir)) throw new Error('route-tracer/ folder not found');
  if (!fs.existsSync(path.join(dir, 'node_modules', 'vite'))) run(['install', '--include=dev', '--no-audit', '--no-fund'], 'route-tracer install');
  run(['run', 'build'], 'route-tracer build');
  console.log('[route-tracer] built into dist/route-tracer-app');
} catch (e) {
  console.warn(`\n[route-tracer] WARNING: ${e.message}. Vault build continues without Route Tracer.\n`);
}
