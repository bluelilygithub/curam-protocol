'use strict';

// Code Map, stage 9: whole-codebase structure: import cycles, largest files, fan-in, possibly unused files,
// backups and the separate packages (planners).
// Port of the "global structure" block of specs/code-map/reference/analyze.py. Churn (git history) is left out:
// the deployed container has no .git, so hotspots stay empty until a later milestone adds them.

const fs = require('fs');
const path = require('path');
const { isTest, walk, readText, hasExt, EXTS, SKIP_DIRS } = require('./files');

// Strongly connected components with more than one file, by Tarjan's algorithm written iteratively
// (an explicit stack of frames instead of recursion, so a long import chain cannot overflow the call stack).
function findCycles(nodes, deps) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  for (const root of nodes) {
    if (index.has(root)) continue;
    const frames = [{ v: root, it: (deps.get(root) || new Set()).values() }];
    index.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);
    while (frames.length) {
      const fr = frames[frames.length - 1];
      const nx = fr.it.next();
      if (!nx.done) {
        const w = nx.value;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          frames.push({ v: w, it: (deps.get(w) || new Set()).values() });
        } else if (onStack.has(w)) {
          low.set(fr.v, Math.min(low.get(fr.v), index.get(w)));
        }
        continue;
      }
      frames.pop();
      const v = fr.v;
      if (frames.length) {
        const parent = frames[frames.length - 1].v;
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
      if (low.get(v) === index.get(v)) {
        const comp = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          comp.push(w);
        } while (w !== v);
        if (comp.length > 1) sccs.push(comp.sort());
      }
    }
  }
  return sccs;
}

const ENTRY_LIKE = /^server\/(index|db)\.js$|^server\/(scripts|seeds|testing|cron)\/|^client\/src\/main\.jsx$|\.config\.|\/scripts\/|_bk\.js$|^server\/assets\//;
const BACKUP_RE = /_bk\.js$|\.bak|_old\./;

function countOccurrences(hay, needle) {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

// Files with no importers that are not entries, tests or scripts, whose name appears nowhere else as a string.
function findOrphans(files, loc, importers) {
  const allText = Object.values(files).join('\n');
  const out = [];
  for (const f of Object.keys(files)) {
    if (isTest(f) || (importers.get(f) && importers.get(f).size) || ENTRY_LIKE.test(f)) continue;
    let stem = path.posix.basename(f, path.posix.extname(f));
    if (stem === 'index') stem = path.posix.basename(path.posix.dirname(f));
    const refs = countOccurrences(allText, stem) - countOccurrences(files[f], stem);
    if (refs > 0) continue;
    out.push({ file: f, loc: loc[f] });
  }
  return out.sort((a, b) => b.loc - a.loc);
}

// Each top-level folder beside client/ and server/ with a package.json: file and line counts.
function findPackages(root) {
  let dirs;
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
  const exts = [...EXTS, '.ts', '.tsx', '.py'];
  const out = [];
  for (const d of dirs) {
    if (d === 'client' || d === 'server') continue;
    const p = path.join(root, d);
    if (!fs.existsSync(path.join(p, 'package.json'))) continue;
    let files = 0;
    let lines = 0;
    walk(p, (fp, name) => {
      if (!hasExt(name, exts)) return;
      files++;
      lines += (readText(fp).match(/\n/g) || []).length;
    }, SKIP_DIRS);
    out.push({ name: d, files, loc: lines });
  }
  return out;
}

function buildStructure({ root, files, loc, deps, importers }) {
  const names = Object.keys(files);
  const nonTest = names.filter((f) => !isTest(f));
  return {
    cycles: findCycles(names, deps),
    largest: nonTest.map((f) => ({ file: f, loc: loc[f] })).sort((a, b) => b.loc - a.loc).slice(0, 25),
    fanin: nonTest.map((f) => ({ file: f, importers: (importers.get(f) || new Set()).size, loc: loc[f] }))
      .sort((a, b) => b.importers - a.importers).slice(0, 20),
    orphans: findOrphans(files, loc, importers),
    backups: names.filter((f) => BACKUP_RE.test(f)).sort(),
    packages: root ? findPackages(root) : [],
    hotspots: [],
  };
}

module.exports = { findCycles, findOrphans, findPackages, buildStructure, ENTRY_LIKE, BACKUP_RE };
