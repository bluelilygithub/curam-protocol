#!/usr/bin/env node
// node server/services/codeMap/knowledgeGraph.test.js   (reads temporary folders only; no database, model or network)
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadKnowledgeGraph } = require('./knowledgeGraph');

const tmp = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
};

// nothing committed yet
assert.strictEqual(loadKnowledgeGraph(tmp({})), null);

// a graph: dangling edges dropped, tour sorted, kind defaults to codebase
const g = {
  version: '1', project: { name: 'vault' },
  nodes: [{ id: 'a', type: 'file', name: 'a.js' }, { id: 'b', type: 'function', name: 'b' }, { name: 'no id' }],
  edges: [{ source: 'a', target: 'b', type: 'contains' }, { source: 'a', target: 'gone', type: 'calls' }],
  layers: [{ id: 'l', name: 'API', nodeIds: ['a'] }],
  tour: [{ order: 2, title: 'second', nodeIds: [] }, { order: 1, title: 'first', nodeIds: ['a'] }],
};
let r = loadKnowledgeGraph(tmp({ '.ua/knowledge-graph.json': JSON.stringify(g) }));
assert.strictEqual(r.file, '.ua/knowledge-graph.json');
assert.strictEqual(r.kind, 'codebase');
assert.deepStrictEqual(r.nodes.map((n) => n.id), ['a', 'b']);
assert.deepStrictEqual(r.edges.map((e) => e.target), ['b']);
assert.deepStrictEqual(r.tour.map((s) => s.title), ['first', 'second']);

// the older folder name still works, and .ua wins when both are there
r = loadKnowledgeGraph(tmp({ '.understand-anything/knowledge-graph.json': JSON.stringify(g) }));
assert.strictEqual(r.file, '.understand-anything/knowledge-graph.json');
r = loadKnowledgeGraph(tmp({ '.understand-anything/knowledge-graph.json': JSON.stringify(g), '.ua/knowledge-graph.json': JSON.stringify(g) }));
assert.strictEqual(r.file, '.ua/knowledge-graph.json');

// broken files are a 422 with a message for the admin
assert.throws(() => loadKnowledgeGraph(tmp({ '.ua/knowledge-graph.json': '{oops' })), (e) => e.status === 422 && /not valid JSON/.test(e.message));
assert.throws(() => loadKnowledgeGraph(tmp({ '.ua/knowledge-graph.json': '{"nodes":[]}' })), (e) => e.status === 422 && /no nodes or edges/.test(e.message));

console.log('knowledgeGraph: all checks passed');
