'use strict';

// Code Map, stage 1: read the source files from disk.
// Port of the "collect files" block of specs/code-map/reference/analyze.py.

const fs = require('fs');
const path = require('path');

const EXTS = ['.js', '.jsx', '.mjs', '.cjs'];
// __fixtures__ is skipped so the Code Map's own test tree is not counted as Vault code (not in the Python reference).
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '__pycache__', '__fixtures__']);
const BASES = ['server', 'client/src'];
// Tools whose real code is a separate app shown in an iframe: its src/ and tests/ (TypeScript too) count as that tool's client code.
const EMBEDDED_APPS = { docCompare: 'doc-compare', cellarPlanner: 'cellar-planner', roomPlanner: 'room-planner', gardenPlanner: 'garden-planner', routeTracer: 'route-tracer' };
const APP_EXTS = [...EXTS, '.ts', '.tsx'];

const TEST_RE = /\.(test|spec)\.(m?js|jsx|cjs|tsx?)$/;

// The tool id whose embedded app holds this file, or null for Vault's own code.
function appOf(f) {
  return Object.keys(EMBEDDED_APPS).find((id) => f.startsWith(`${EMBEDDED_APPS[id]}/`)) || null;
}

function isTest(f) {
  return TEST_RE.test(f) || f.includes('/__tests__/');
}

// Python reads with universal newlines, so normalise line endings to \n.
function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');
  } catch {
    return '';
  }
}

function hasExt(fn, exts) {
  return exts.some((e) => fn.endsWith(e));
}

// Depth-first walk, sorted so runs are deterministic. Calls onFile(absPath, name).
function walk(dir, onFile, skip = SKIP_DIRS) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!skip.has(e.name)) walk(p, onFile, skip);
    } else if (e.isFile()) {
      onFile(p, e.name);
    }
  }
}

function toRel(root, p) {
  return path.relative(root, p).split(path.sep).join('/');
}

// Returns a plain object { 'server/x.js': source, ... } in walk order.
function collectFiles(root) {
  const files = {};
  for (const base of BASES) {
    walk(path.join(root, base), (p, name) => {
      if (hasExt(name, EXTS)) files[toRel(root, p)] = readText(p);
    });
  }
  for (const dir of Object.values(EMBEDDED_APPS)) {
    for (const sub of ['src', 'tests']) {
      walk(path.join(root, dir, sub), (p, name) => {
        if (hasExt(name, APP_EXTS) && !name.endsWith('.d.ts')) files[toRel(root, p)] = readText(p);
      });
    }
  }
  return files;
}

// Python: s.count('\n') + 1
function locOf(src) {
  let n = 1;
  for (let i = src.indexOf('\n'); i !== -1; i = src.indexOf('\n', i + 1)) n++;
  return n;
}

function buildLoc(files) {
  const loc = {};
  for (const [f, s] of Object.entries(files)) loc[f] = locOf(s);
  return loc;
}

// Python str.splitlines() for the line endings that occur in source (\n after normalising).
function splitLines(src) {
  const lines = src.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

module.exports = { EXTS, APP_EXTS, EMBEDDED_APPS, appOf, SKIP_DIRS, isTest, readText, walk, toRel, collectFiles, locOf, buildLoc, splitLines, hasExt };
