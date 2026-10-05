#!/usr/bin/env node
'use strict';

/**
 * Builds the standalone Garden Planner (vault/garden-planner/) into vault/dist/garden-planner-app/ so the Express static
 * handler serves it next to the Vault client. Runs after the client build (which empties dist/).
 *
 * Deliberately NON-FATAL: Garden Planner is a self-contained add-on, and a failure here must not take the whole Vault
 * deploy down. It logs loudly and exits 0; the /garden-planner page then shows a "not built" notice instead of the app.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'garden-planner');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';

function run(args, label) {
  const r = spawnSync(npm, args, { cwd: dir, stdio: 'inherit', shell });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

try {
  if (!fs.existsSync(dir)) throw new Error('garden-planner/ folder not found');
  if (!fs.existsSync(path.join(dir, 'node_modules', 'vite'))) run(['install', '--include=dev', '--no-audit', '--no-fund'], 'garden-planner install');
  run(['run', 'build'], 'garden-planner build');
  console.log('[garden-planner] built into dist/garden-planner-app');
} catch (e) {
  console.warn(`\n[garden-planner] WARNING: ${e.message}. Vault build continues without Garden Planner.\n`);
}
