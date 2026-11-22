'use strict';

// Code Map, stages 6-7: who owns each mount, what code each tool reaches and owns, and how tools link.
// Port of the "reach sets" and "tool-to-tool coupling" blocks of specs/code-map/reference/analyze.py.

const { bfs } = require('./imports');
const { isTest, EMBEDDED_APPS } = require('./files');
const { mountsForApi, seg } = require('./mounts');

// A file reached by this many tools or more is shared, not owned.
const COMMON_T = 3;

// Mount owner table. Edit here when a mount lands on the wrong tool.
const OWNER_CONFIG = {
  chatSegs: ['chat', 'projects', 'files', 'session-files', 'pinned-urls', 'folders', 'bookmarks', 'fetch-url', 'web-search'],
  extraSegs: {
    student: ['study-decks', 'student-quizzes'], goals: ['mission'], tasks: ['task-templates'], html: ['page-speed-tutor'],
    clients: ['deals', 'cases', 'shelf-inbox', 'crm-tutor'], gmailIntel: ['gmail'], searchConsole: ['gsc'],
    admin: ['admin', 'backup'], pcHealth: ['pc-helper'], shares: ['metals'], videos: ['local-audio'],
    gardenPlanner: ['map-tiles', 'plant-images', 'geocode'], routeTracer: ['route-tracks', 'route-tutor'],
    cellarPlanner: ['cellar-planner', 'cellar-tutor', 'cellar-lite'], roomPlanner: ['room-projects'],
    guitar: ['guitar-play'], liveTv: ['live-tv-player'], burnerMail: ['inbound-mail'], fitness: ['fitness'],
    measurements: ['measurements-tutor'], restyle: ['restyle', 'restyle-tutor'], shelf: [],
  },
};

const CORE_FILES = [
  'server/db.js', 'server/services/modelResolver.js', 'server/services/SuggestionService.js', 'server/middleware/auth.js',
  'server/services/recycleBin/index.js', 'server/utils/safeFetch.js', 'server/lib/logger.js', 'server/services/callModel.js',
  'client/src/utils/apiClient.js', 'client/src/components/tutor/TutorChat.jsx', 'client/src/components/Dialog.jsx',
  'client/src/providers/IconProvider.jsx', 'client/src/store/processingStore.js', 'client/src/components/Tooltip.jsx',
  'client/src/components/voiceInput/VoiceInput.jsx', 'server/services/guideCore.js',
];

const API_RE = /['"`](\/api\/[a-zA-Z0-9_/-]+)/g;

function kebab(s) {
  return s.replace(/(?<!^)(?=[A-Z])/g, '-').toLowerCase();
}

// Rules, in order: chat segments, the extra-segment table, the tool's page path or kebab id, then the feature key.
function mountOwner(m, tools, config = OWNER_CONFIG) {
  const sg = seg(m.path);
  const base = sg.endsWith('-tutor') ? sg.slice(0, -'-tutor'.length) : sg;
  if (config.chatSegs.includes(base)) return 'chat';
  for (const t of tools) {
    const extra = config.extraSegs[t.id] || [];
    if (extra.includes(sg) || extra.includes(base)) return t.id;
  }
  for (const t of tools) {
    const tp = t.path.split('?')[0].replace(/^\/+|\/+$/g, '').split('/')[0];
    if (base === tp || base === kebab(t.id)) return t.id;
  }
  for (const t of tools) {
    if (t.featureKey && m.features.includes(t.featureKey)) return t.id;
  }
  return null;
}

function countReach(reachById) {
  const count = new Map();
  for (const rs of Object.values(reachById)) for (const f of rs) count.set(f, (count.get(f) || 0) + 1);
  return count;
}

function slimMount(m) {
  return { path: m.path, line: m.line, aiLimiter: m.aiLimiter, features: m.features, admin: m.admin, public: m.public, modules: m.modules };
}

/**
 * Fills in, on each tool: apiCalls, calls, mounts, ownedClient, ownedServer, sharedClient, sharedServer,
 * locClient, locServer, tests, biggest. Sets m.owner on each mount. Returns the reach maps for later stages.
 */
function computeOwnership({ files, loc, deps, tools, mounts, config = OWNER_CONFIG }) {
  for (const m of mounts) m.owner = mountOwner(m, tools, config);

  const clientReach = {};
  for (const t of tools) clientReach[t.id] = t.clientEntries.length ? bfs(t.clientEntries, deps) : new Set();
  for (const t of tools) {
    const dir = EMBEDDED_APPS[t.id];
    if (!dir) continue;
    const appFiles = Object.keys(files).filter((f) => f.startsWith(`${dir}/`));
    // The whole app is the tool's; following its (non-test) imports also reaches the planner-core files it uses.
    clientReach[t.id] = new Set([...bfs([...clientReach[t.id], ...appFiles.filter((f) => !isTest(f))], deps), ...appFiles]);
  }
  const clientCount = countReach(clientReach);
  const cc = (f) => clientCount.get(f) || 0;

  const serverReach = {};
  const toolMounts = {};
  for (const t of tools) {
    const apis = new Set();
    for (const f of clientReach[t.id]) {
      if (cc(f) >= COMMON_T) continue;
      for (const a of files[f].matchAll(API_RE)) apis.add(a[1]);
    }
    const called = new Map();
    for (const a of apis) for (const m of mountsForApi(mounts, a.replace(/\/+$/, ''))) called.set(m.line, m);
    const primary = mounts.filter((m) => m.owner === t.id).sort((a, b) => a.line - b.line);
    toolMounts[t.id] = primary;
    const calls = new Set();
    for (const m of called.values()) if (m.owner !== t.id) calls.add(m.owner || `platform:${seg(m.path)}`);
    t.calls = [...calls].sort();
    const starts = [...new Set(primary.flatMap((m) => m.modules))].sort();
    serverReach[t.id] = starts.length ? bfs(starts, deps) : new Set();
    t.apiCalls = [...apis].sort();
  }
  const serverCount = countReach(serverReach);
  const sc = (f) => serverCount.get(f) || 0;

  const testFiles = Object.keys(files).filter(isTest);
  for (const t of tools) {
    const cr = [...clientReach[t.id]];
    const sr = [...serverReach[t.id]];
    const primaryMods = new Set(toolMounts[t.id].flatMap((m) => m.modules));
    t.ownedClient = cr.filter((f) => cc(f) < COMMON_T && !isTest(f)).sort();
    t.ownedServer = sr.filter((f) => (sc(f) < COMMON_T || primaryMods.has(f)) && !isTest(f)).sort();
    t.sharedClient = cr.filter((f) => cc(f) >= COMMON_T).sort();
    t.sharedServer = sr.filter((f) => sc(f) >= COMMON_T).sort();
    t.locClient = t.ownedClient.reduce((n, f) => n + loc[f], 0);
    t.locServer = t.ownedServer.reduce((n, f) => n + loc[f], 0);
    const owned = new Set([...t.ownedClient, ...t.ownedServer]);
    t.tests = testFiles.filter((f) => [...(deps.get(f) || [])].some((d) => owned.has(d))).sort();
    t.mounts = toolMounts[t.id].map(slimMount);
    t.biggest = [...owned].sort((a, b) => loc[b] - loc[a]).slice(0, 5).map((f) => ({ file: f, loc: loc[f] }));
  }
  return { clientReach, serverReach, clientCount, serverCount };
}

// Tool-to-tool links: owned files two tools share, plus API calls into another tool's mounts.
function buildEdges(tools) {
  const ownMap = new Map();
  for (const t of tools) {
    for (const f of [...t.ownedClient, ...t.ownedServer]) {
      if (!ownMap.has(f)) ownMap.set(f, new Set());
      ownMap.get(f).add(t.id);
    }
  }
  const edges = new Map();
  const edge = (x, y) => {
    const [a, b] = [x, y].sort();
    const k = `${a}\u0000${b}`;
    if (!edges.has(k)) edges.set(k, { a, b, files: new Set(), api: new Set() });
    return edges.get(k);
  };
  for (const t of tools) {
    for (const f of new Set([...t.ownedClient, ...t.ownedServer])) {
      for (const o of ownMap.get(f)) if (o !== t.id) edge(t.id, o).files.add(f);
    }
    for (const o of t.calls) {
      if (o.startsWith('platform:')) continue;
      edge(t.id, o).api.add(`${t.id}->${o}`);
    }
  }
  return [...edges.values()].map((e) => ({ a: e.a, b: e.b, files: [...e.files].sort().slice(0, 12), n: e.files.size, api: [...e.api].sort() }));
}

function buildSharedModules(files, loc, importers, { clientCount, serverCount }) {
  const out = [];
  for (const f of Object.keys(files)) {
    if (isTest(f)) continue;
    const n = (f.startsWith('server/') ? serverCount.get(f) : clientCount.get(f)) || 0;
    if (n >= 6) out.push({ file: f, tools: n, importers: (importers.get(f) || new Set()).size, loc: loc[f] });
  }
  return out.sort((a, b) => b.tools - a.tools).slice(0, 30);
}

function buildCore(files, loc, importers, tools, { clientReach, serverReach }) {
  return CORE_FILES.filter((f) => f in files).map((f) => ({
    file: f,
    tools: tools.filter((t) => serverReach[t.id].has(f) || clientReach[t.id].has(f)).map((t) => t.id),
    loc: loc[f],
    importers: (importers.get(f) || new Set()).size,
  }));
}

module.exports = { COMMON_T, OWNER_CONFIG, CORE_FILES, API_RE, kebab, mountOwner, computeOwnership, buildEdges, buildSharedModules, buildCore };
