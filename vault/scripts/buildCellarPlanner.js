#!/usr/bin/env node
'use strict';

/**
 * Builds the standalone Cellar Planner (vault/cellar-planner/) into vault/dist/cellar-planner-app/ so the Express static
 * handler serves it next to the Vault client. Runs after the client build (which empties dist/).
 *
 * Deliberately NON-FATAL: Cellar Planner is a self-contained add-on, and a failure here must not take the whole Vault
 * deploy down. It logs loudly and exits 0; the /cellar-planner page then shows a "not built" notice instead of the app.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'cellar-planner');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';

function run(args, label) {
  const r = spawnSync(npm, args, { cwd: dir, stdio: 'inherit', shell });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

try {
  if (!fs.existsSync(dir)) throw new Error('cellar-planner/ folder not found');
  if (!fs.existsSync(path.join(dir, 'node_modules', 'vite'))) run(['install', '--include=dev', '--no-audit', '--no-fund'], 'cellar-planner install');
  run(['run', 'build'], 'cellar-planner build');
  console.log('[cellar-planner] built into dist/cellar-planner-app');
  // the public lite tool is a separate, smaller bundle served at /cellar-lite/; if only it fails, the full planner above still deploys
  try {
    run(['run', 'build:lite:vault'], 'cellar-planner lite build');
    console.log('[cellar-planner] lite built into dist/cellar-lite');
  } catch (e) {
    console.warn(`
[cellar-planner] WARNING: ${e.message}. /cellar-lite will not be served.
`);
  }
} catch (e) {
  console.warn(`\n[cellar-planner] WARNING: ${e.message}. Vault build continues without Cellar Planner.\n`);
}
