'use strict';

// Code Map, stage 2: the relative-import graph between files.
// Port of the "import graph" block of specs/code-map/reference/analyze.py.

const path = require('path');
const { EXTS } = require('./files');

const IMP_RE = /(?:require\(\s*|import\s*\(\s*|from\s+|import\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;

// Resolve a relative specifier against the importing file: as written, + each extension, then /index.<ext>.
function resolve(files, src, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(src), spec));
  const cands = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => `${base}/index${e}`)];
  for (const c of cands) if (Object.prototype.hasOwnProperty.call(files, c)) return c;
  return null;
}

function addTo(map, k, v) {
  let s = map.get(k);
  if (!s) map.set(k, (s = new Set()));
  s.add(v);
}

// Returns { deps: Map<file, Set<file>>, importers: Map<file, Set<file>> }.
function buildGraph(files) {
  const deps = new Map();
  const importers = new Map();
  for (const [f, s] of Object.entries(files)) {
    for (const m of s.matchAll(IMP_RE)) {
      const t = resolve(files, f, m[2]);
      if (t && t !== f) {
        addTo(deps, f, t);
        addTo(importers, t, f);
      }
    }
  }
  return { deps, importers };
}

// Breadth-first walk from a list of start files.
function bfs(starts, graph) {
  const seen = new Set(starts);
  const q = [...starts];
  for (let i = 0; i < q.length; i++) {
    for (const y of graph.get(q[i]) || []) {
      if (!seen.has(y)) {
        seen.add(y);
        q.push(y);
      }
    }
  }
  return seen;
}

module.exports = { IMP_RE, resolve, buildGraph, bfs };
