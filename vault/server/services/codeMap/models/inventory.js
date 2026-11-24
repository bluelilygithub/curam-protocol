'use strict';

// Code Map → Models check, milestone 1: the inventory. For every tool that calls a model: which models it uses (default tier, backup, any
// admin-set dedicated model), how each was resolved, what the tool needs (server/config/modelNeeds.js) and what each model can do
// (modelInfo in services/costCalculator.js). It only reads; it never changes Settings. See docs/code-map.md "Models".
//
// Which tiers and setting keys a tool uses is read from the tool's own server files (Code Map's ownership of the latest run), so it cannot
// drift from the code. Dedicated keys resolve the way the per-tool resolvers do (the admin's setting if that model is still in the list,
// otherwise the tool falls back to the workspace default). The check runs as the first admin, like the weekly Code Map run.

const fs = require('fs');
const path = require('path');
const { MODEL_NEEDS } = require('../../../config/modelNeeds');
const { modelInfo } = require('../../costCalculator');

const TIERS = ['standard', 'light', 'gemini', 'deepseek', 'ollama'];
// Settings keys that end in _model but are not one tool's model choice.
const NOT_TOOL_KEYS = new Set(['vault_models', 'default_model', 'no_model']);
// Where each provider's key comes from (callModel.js, graphics, aiVisibility). Ollama needs a server address rather than a key.
const PROVIDER_ENV = {
  anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', deepseek: 'DEEPSEEK_API_KEY', ollama: 'OLLAMA_BASE_URL',
  fal: 'FAL_API_KEY', replicate: 'REPLICATE_API_TOKEN', perplexity: 'PERPLEXITY_API_KEY',
};

/** Tiers and dedicated setting keys a tool's code uses. Pure. */
function scanSources(text) {
  const src = String(text || '');
  const tiers = new Set();
  for (const t of TIERS) {
    if (new RegExp(`\\.${t}\\b|pickTextModel\\([^)]*['"]${t}['"]`).test(src)) tiers.add(t);
  }
  if (/pickTextModel\(\s*[\w.]+\s*\)/.test(src)) tiers.add('standard'); // pickTextModel(tiers) prefers standard
  // Guide chats pick their tier in guideCore from createGuide({ tier }); no tier means standard.
  for (const m of src.matchAll(/\btier:\s*['"](light|standard)['"]/g)) tiers.add(m[1]);
  if (/\bcreateGuide\(/.test(src) && !/\btier:\s*['"]/.test(src)) tiers.add('standard');
  const keys = new Set();
  for (const m of src.matchAll(/['"`]([a-z][a-z0-9_]*_model)['"`]/g)) if (!NOT_TOOL_KEYS.has(m[1])) keys.add(m[1]);
  return { tiers: TIERS.filter((t) => tiers.has(t)), keys: [...keys].sort() };
}

/** Provider of a model: the catalog entry's provider, else the id prefix (the same routing as callModel). Pure. */
function providerOf(id, catalog = []) {
  const entry = catalog.find((m) => String(m?.id).trim() === id);
  if (entry?.provider) return String(entry.provider).toLowerCase();
  if (/^gemini-/.test(id)) return 'gemini';
  if (/^deepseek-/.test(id)) return 'deepseek';
  if (/^ollama:/.test(id)) return 'ollama';
  if (/^fal(-ai)?\//.test(id)) return 'fal';
  if (/^sonar/.test(id)) return 'perplexity';
  return 'anthropic';
}

function describeModel(modelId, { catalog, env }) {
  if (!modelId) return { modelId: null, provider: null, inList: false, providerKey: false, info: null };
  const provider = providerOf(modelId, catalog);
  const envName = PROVIDER_ENV[provider];
  return {
    modelId,
    provider,
    inList: catalog.some((m) => String(m?.id).trim() === modelId),
    providerKey: envName ? Boolean(String(env[envName] || '').trim()) : null, // null = a provider this check does not know the key for
    info: modelInfo(modelId),
  };
}

/** One tool's inventory row. Pure: everything it needs is passed in. */
function inventoryTool({ tool, sourceText, needs, tiers, catalog, settings, env, claimed = new Map() }) {
  const scan = scanSources(sourceText);
  scan.keys = scan.keys.filter((k) => !claimed.has(k) || claimed.get(k) === tool.id);
  const fallbackId = tiers.standard || null;
  const models = [];
  for (const t of scan.tiers) {
    models.push({ role: 'default', via: `tier:${t}`, resolvedFrom: tiers[t] ? `the workspace ${t} model` : `no ${t} model is set`, ...describeModel(tiers[t] || null, { catalog, env }) });
  }
  for (const key of scan.keys) {
    const saved = String(settings[key] || '').trim();
    const usable = saved && catalog.some((m) => String(m?.id).trim() === saved);
    const role = /fallback|backup/.test(key) ? 'backup' : 'dedicated';
    let resolvedFrom;
    if (!saved) resolvedFrom = 'not set, so the tool uses the workspace default';
    else if (usable) resolvedFrom = `Settings: ${key}`;
    else resolvedFrom = `Settings: ${key} names ${saved}, which is not in the model list, so the tool falls back to the default`;
    models.push({ role, via: `setting:${key}`, savedId: saved || null, resolvedFrom, ...describeModel(usable ? saved : fallbackId, { catalog, env }) });
  }
  return { tool: tool.id, label: tool.label, needs: needs || null, needsDeclared: Boolean(needs), models };
}

/**
 * The whole inventory. `run` is a finished Code Map run result (its tools carry ownedServer); `readFile(rel)` returns a file's text.
 * Only tools whose code uses a tier or a model setting, or that declare needs, are listed. Pure apart from readFile.
 */
function buildInventory({ run, readFile, tiers, catalog = [], settings = {}, env = {}, needsMap = MODEL_NEEDS }) {
  const read = (rel) => { try { return readFile(rel); } catch { return null; } };
  // A tool's code = its own server files plus the local files they require (transitively), so a resolver it reaches through a file Code Map
  // counts as shared still counts. Files reached by more than SHARED_LIMIT tools are workspace plumbing (modelResolver, guideCore, callModel)
  // that mention every tier, so they are left out.
  const SHARED_LIMIT = 3;
  const reach = new Map(); // tool id -> Set of files
  const toolsPerFile = new Map();
  const ownerOf = new Map();
  for (const tool of run?.tools || []) for (const f of tool.ownedServer || []) ownerOf.set(f, tool.id);
  for (const tool of run?.tools || []) {
    const seen = new Set();
    const queue = [...(tool.ownedServer || [])];
    while (queue.length) {
      const rel = queue.shift();
      if (seen.has(rel)) continue;
      if (ownerOf.has(rel) && ownerOf.get(rel) !== tool.id) continue; // another tool's own code (its models are its own)
      const text = read(rel);
      if (text == null) continue;
      seen.add(rel);
      for (const m of text.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
        const hit = [base, `${base}.js`, `${base}/index.js`].find((c) => c.endsWith('.js') && read(c) != null);
        if (hit && !seen.has(hit)) queue.push(hit);
      }
    }
    reach.set(tool.id, seen);
    for (const f of seen) toolsPerFile.set(f, (toolsPerFile.get(f) || 0) + 1);
  }
  const claimed = new Map();
  for (const [id, n] of Object.entries(needsMap)) for (const k of n.ownsKeys || []) claimed.set(k, id);
  const rows = [];
  for (const tool of run?.tools || []) {
    const own = new Set(tool.ownedServer || []);
    const files = [...(reach.get(tool.id) || [])].filter((f) => own.has(f) || toolsPerFile.get(f) <= SHARED_LIMIT);
    const sourceText = files.map(read).join('\n');
    const row = inventoryTool({ tool, sourceText, needs: needsMap[tool.id], tiers, catalog, settings, env, claimed });
    if (row.models.length || row.needsDeclared) rows.push(row);
  }
  const toolIds = new Set((run?.tools || []).map((t) => t.id));
  return {
    tiers,
    tools: rows,
    undeclared: rows.filter((r) => r.models.length && !r.needsDeclared).map((r) => r.tool), // calls a model, no needs entry
    unknownNeeds: Object.keys(needsMap).filter((id) => !toolIds.has(id)), // a needs entry for a tool that does not exist
  };
}

/** Load everything from the database and disk and build the inventory as the first admin. */
async function loadInventory({
  pool = require('../../../db').pool,
  root = path.resolve(__dirname, '../../../..'),
  env = process.env,
  resolver = require('../../modelResolver'),
} = {}) {
  const runRow = (await pool.query(`SELECT result FROM code_map_runs WHERE status = 'done' ORDER BY "createdAt" DESC, id DESC LIMIT 1`)).rows[0];
  if (!runRow) throw Object.assign(new Error('Run the Code Map analysis first: the Models check reads tool ownership from the latest run.'), { status: 409 });
  const run = typeof runRow.result === 'string' ? JSON.parse(runRow.result) : runRow.result;
  const adminId = (await pool.query('SELECT id FROM users WHERE "isAdmin" = TRUE ORDER BY id ASC LIMIT 1')).rows[0]?.id;
  if (!adminId) throw new Error('No admin account');
  const [tiers, { models: catalog }, settingRows] = await Promise.all([
    resolver.getModelsForUser(adminId),
    resolver.getVaultModelsConfigForUser(adminId),
    pool.query(`SELECT key, value FROM settings WHERE "userId" = $1 AND key LIKE '%\\_model'`, [adminId]),
  ]);
  const settings = Object.fromEntries(settingRows.rows.map((r) => [r.key, r.value]));
  const readFile = (rel) => {
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root)) return ''; // a path from the stored run never leaves the app folder
    return fs.readFileSync(abs, 'utf8');
  };
  return { adminId, generatedAt: new Date().toISOString(), ...buildInventory({ run, readFile, tiers, catalog, settings, env }) };
}

module.exports = { scanSources, providerOf, inventoryTool, buildInventory, loadInventory, PROVIDER_ENV };
