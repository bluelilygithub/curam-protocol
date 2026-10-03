#!/usr/bin/env node
'use strict';

/**
 * Builds the standalone Room Planner (vault/room-planner/) into vault/dist/room-planner-app/ so the Express static
 * handler serves it next to the Vault client. Runs after the client build (which empties dist/).
 *
 * Deliberately NON-FATAL: Room Planner is a self-contained add-on, and a failure here must not take the whole Vault
 * deploy down. It logs loudly and exits 0; the /room-planner page then shows a "not built" notice instead of the app.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'room-planner');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const shell = process.platform === 'win32';

function run(args, label) {
  const r = spawnSync(npm, args, { cwd: dir, stdio: 'inherit', shell });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

try {
  if (!fs.existsSync(dir)) throw new Error('room-planner/ folder not found');
  if (!fs.existsSync(path.join(dir, 'node_modules', 'vite'))) run(['install', '--include=dev', '--no-audit', '--no-fund'], 'room-planner install');
  run(['run', 'build'], 'room-planner build');
  console.log('[room-planner] built into dist/room-planner-app');
} catch (e) {
  console.warn(`\n[room-planner] WARNING: ${e.message}. Vault build continues without Room Planner.\n`);
}
