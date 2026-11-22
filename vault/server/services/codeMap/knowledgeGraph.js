'use strict';

// Code Map, Knowledge graph tab: reads the graph Understand-Anything (github.com/Egonex-AI/Understand-Anything, MIT) wrote into the repo.
// Vault never runs it: the owner runs /understand in Claude Code on their own machine and commits .ua/. No model calls, no network.
// Shape: KnowledgeGraph in that repo's understand-anything-plugin/packages/core/src/types.ts.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
// the current folder first, then the older name the tool used
const CANDIDATES = ['.ua/knowledge-graph.json', '.understand-anything/knowledge-graph.json'];
const MAX_BYTES = 30 * 1024 * 1024; // shortcut: the whole file goes to the browser; past this, slim nodes on the server instead

function badGraph(message) {
  return Object.assign(new Error(message), { status: 422 });
}

// Returns { file, bytes, project, kind, version, nodes, edges, layers, tour }, or null when no graph has been committed.
function loadKnowledgeGraph(root = ROOT) {
  const rel = CANDIDATES.find((p) => fs.existsSync(path.join(root, p)));
  if (!rel) return null;
  const full = path.join(root, rel);
  const bytes = fs.statSync(full).size;
  if (bytes > MAX_BYTES) throw badGraph(`${rel} is ${Math.round(bytes / 1048576)} MB; the Knowledge graph tab reads files up to 30 MB.`);
  let g;
  try {
    g = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    throw badGraph(`${rel} is not valid JSON. Run /understand again.`);
  }
  if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) throw badGraph(`${rel} has no nodes or edges list. Run /understand again.`);
  const ids = new Set(g.nodes.map((n) => n && n.id).filter((id) => typeof id === 'string'));
  return {
    file: rel,
    bytes,
    version: g.version || null,
    kind: g.kind || 'codebase',
    project: g.project || null,
    nodes: g.nodes.filter((n) => n && typeof n.id === 'string'),
    // an edge to a node that is not in the file would break the graph drawing
    edges: g.edges.filter((e) => e && ids.has(e.source) && ids.has(e.target)),
    layers: Array.isArray(g.layers) ? g.layers : [],
    tour: Array.isArray(g.tour) ? [...g.tour].sort((a, b) => (a.order || 0) - (b.order || 0)) : [],
  };
}

module.exports = { loadKnowledgeGraph, CANDIDATES, MAX_BYTES };
