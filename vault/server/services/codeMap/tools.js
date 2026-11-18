'use strict';

// Code Map, stage 3: the tools (from the navigation catalog) and their client entry pages (from App.jsx).
// Port of the "tools from nav catalog" and "page component per tool" blocks of specs/code-map/reference/analyze.py.

const { resolve } = require('./imports');
const { splitLines } = require('./files');

const NAV_FILE = 'client/src/config/appNavigation.js';
const APP_FILE = 'client/src/App.jsx';

// Core tools that are not in APP_NAV_GROUPS, and tools to leave out. Kept here so they are easy to correct.
const TOOL_CONFIG = {
  extraTools: [
    { at: 1, id: 'tasks', label: 'Tasks', path: '/tasks', featureKey: null, group: 'Everyday', adminOnly: false },
    { at: 2, id: 'chat', label: 'Chat & Projects', path: '/chat', featureKey: null, group: 'Everyday', adminOnly: false },
  ],
  skipTools: ['guide'],
  wrapperComponents: ['FeatureRoute', 'Navigate', 'AdminOnly', 'AdminRoute'],
  specialRoutes: { '/student/quiz': 'StudentQuizLayout', '/admin': 'AdminPage', '/chat': 'ChatPage' },
  extraEntries: {
    chat: ['ProjectDetail', 'ProjectList', 'ChatHistoryPage'],
    student: ['StudentCardsChatPage', 'StudentSavedDecksPage'],
  },
};

const NAV_ITEM_RE = /\{ id: '(\w+)',\s*label: '([^']+)',\s*path: '([^']+)'.*?featureKey: (null|'(\w+)')/;

function parseNavTools(navSrc, config = TOOL_CONFIG) {
  const start = navSrc.indexOf('APP_NAV_GROUPS');
  const end = navSrc.indexOf('export function isNavItemActive');
  if (start === -1) throw new Error('APP_NAV_GROUPS not found in appNavigation.js');
  const block = navSrc.slice(start, end === -1 ? undefined : end);
  const tools = [];
  let groupLabel = null;
  for (const line of splitLines(block)) {
    if (/^\s*id: '([\w-]+)',\s*$/.test(line)) continue;
    const gl = line.match(/^\s*label: '([^']+)',\s*$/);
    if (gl) {
      groupLabel = gl[1];
      continue;
    }
    const m = line.match(NAV_ITEM_RE);
    if (m && !m[3].startsWith('http')) {
      tools.push({
        id: m[1],
        label: m[2],
        path: m[3],
        featureKey: m[5] || null,
        group: groupLabel,
        adminOnly: line.includes('adminOnly: true'),
      });
    }
  }
  for (const { at, ...t } of config.extraTools) tools.splice(at, 0, { ...t });
  return tools.filter((t) => !config.skipTools.includes(t.id));
}

// Component name -> file, and route path -> [component names], from App.jsx.
function parseAppRoutes(appSrc, files) {
  const compFile = {};
  for (const m of appSrc.matchAll(/import\s+(\w+)\s+from\s+'(\.\/[^']+)'/g)) {
    const r = resolve(files, APP_FILE, m[2]);
    if (r) compFile[m[1]] = r;
  }
  for (const m of appSrc.matchAll(/const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*'(\.\/[^']+)'/g)) {
    const r = resolve(files, APP_FILE, m[2]);
    if (r) compFile[m[1]] = r;
  }
  const routeComp = new Map();
  for (const m of appSrc.matchAll(/<Route\s+path="([^"]+)"\s+element=\{(.*?)\}\s*\/>/g)) {
    let comps = [...m[2].matchAll(/<(\w+)/g)].map((x) => x[1]);
    const inner = comps.filter((c) => !TOOL_CONFIG.wrapperComponents.includes(c));
    if (inner.length) comps = inner;
    if (!routeComp.has(m[1])) routeComp.set(m[1], []);
    routeComp.get(m[1]).push(comps.length ? comps[comps.length - 1] : null);
  }
  return { compFile, routeComp };
}

// Adds t.clientEntries (sorted unique file list) to each tool.
function attachClientEntries(tools, { compFile, routeComp }, config = TOOL_CONFIG) {
  for (const t of tools) {
    const base = t.path.split('?')[0];
    let names = config.specialRoutes[base] ? [config.specialRoutes[base]] : [...(routeComp.get(base) || [])];
    // detail routes belonging to the tool (e.g. /clients/:id)
    for (const [p, cs] of routeComp) {
      if (p.startsWith(base + '/') && base !== '/') names = names.concat(cs);
    }
    if (config.extraEntries[t.id]) names = names.concat(config.extraEntries[t.id]);
    const entries = new Set();
    for (const n of names) if (n && compFile[n]) entries.add(compFile[n]);
    t.clientEntries = [...entries].sort();
  }
  return tools;
}

function buildTools(files, config = TOOL_CONFIG) {
  const tools = parseNavTools(files[NAV_FILE] || '', config);
  const routes = parseAppRoutes(files[APP_FILE] || '', files);
  return attachClientEntries(tools, routes, config);
}

module.exports = { TOOL_CONFIG, NAV_FILE, APP_FILE, parseNavTools, parseAppRoutes, attachClientEntries, buildTools };
