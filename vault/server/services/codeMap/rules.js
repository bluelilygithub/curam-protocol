'use strict';

// Code Map, stage 8: the convention checks, one declarative entry per rule.
// Each test(tool, ctx) returns { status: 'pass'|'warn'|'fail'|'na', note, evidence: [{ file, line, text }] }.
// Ported from the "convention checks" block of specs/code-map/reference/analyze.py. To add a convention, add one entry.

const path = require('path');
const { splitLines, appOf } = require('./files');
const { kebab } = require('./ownership');

const MODEL_RX = /['"`](claude-(?:opus|sonnet|haiku|3|instant)[\w.-]*|gemini-\d[\w.-]*|gpt-[34o][\w.-]*|deepseek-[\w.-]+)['"`]/;
const AI_RX = /callModel|messages\.create|messages\.stream|generateContent|GoogleGenerativeAI|@anthropic-ai\/sdk|streamAnthropic|callClaude|askGuide|guideCore|runTutor/;
const RESOLVE_RX = /getModelsForUser|ModelResolver|resolve\w*Model|modelResolver|guideCore|guideBasicsKit/;
const RAWFETCH_RX = /\bfetch\(\s*[`'"]\/api/;
const LUCIDE_RX = /from\s+['"]lucide-react['"]/;
const MODAL_RX = /fixed inset-0/;
const CONSOLE_RX = /\bconsole\.(log|warn|error|info)\(/g;
const DEL_RX = /router\.delete\(/;
const BIN_RX = /moveToBin|recycleBin/;
const SAFE_RX = /safeFetch|htmlFetch|checkSsrf/;
const SSRF_CALL_RX = /(fetch|axios\.(get|post)|got)\(\s*(req\.(body|query|params)\.\w*url|url|targetUrl|pageUrl)\b/i;
const SSRF_SRC_RX = /req\.(body|query|params)\.\w*url|\{[^}]*\burl\b[^}]*\}\s*=\s*req\.(body|query)/i;
const MODEL_SKIP_RX = /costCalculator|pricing|\.test\.|client\/src\/utils\/models\.js/;
const ICON_SKIP_RX = /IconProvider|IconLibraryGenerator/;

// docs/<kebab-id>.md is tried first; these tools document themselves under another name (null = none expected yet).
const DOC_ALIAS = {
  clients: 'crm-activity-model.md', gmailIntel: 'gmail-intel.md', html: 'html-agent.md', seo: 'seo-agent.md',
  googleAds: 'google-ads-agent.md', searchConsole: 'search-console-agent.md', youtube: 'youtube-agent.md',
  videos: 'video-tools.md', graphics: 'graphics-tools.md', pdf: 'pdf-agent.md', translate: 'translate-agent.md',
  documentRedaction: 'document-redaction-agent-architecture.md', contractReview: 'contract-review-spec.md',
  measurements: 'measurement-converter.md', wellbeing: 'wellbeing-assessment-app.md', goals: 'goals-guide.md',
  fitness: 'fitness-planner.md', memory: 'semantic-memory.md', suggestions: 'suggestions-inbox.md',
  chat: 'chat-navigation.md', student: null, devicePreview: null, restyle: 'restyle.md', shares: 'shares-thesis.md',
  clientProjects: null, expenseReview: null, changelog: 'changelog.md', admin: null, tasks: null, usage: null,
};

function check(status, note, evidence) {
  return { status, note, evidence: evidence || [] };
}

// First `limit` lines in `fs` matching rx, as evidence.
function linesMatching(files, fs, rx, limit = 6, skip = null) {
  const out = [];
  for (const f of fs) {
    if (skip && skip(f)) continue;
    const lines = splitLines(files[f]);
    for (let i = 0; i < lines.length; i++) {
      if (rx.test(lines[i])) {
        out.push({ file: f, line: i + 1, text: lines[i].trim().slice(0, 160) });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

const RULES = [
  {
    id: 'flag',
    label: 'Feature flag parity',
    severity: 'high',
    area: 'Feature access',
    why: 'Client and server flag lists must match, or a tool can be switched on in the menu but refused by the API (or the reverse), and an admin cannot turn it off.',
    fix: 'Add the flag, with the same default, to both server/config/featureAccess.js and client/src/utils/featureAccess.js, then run node server/config/featureAccess.test.js.',
    test(t, { SF, CF }) {
      const k = t.featureKey;
      if (t.adminOnly) return check('na', 'Admin-only page; no feature flag needed.');
      if (!k) return check('na', 'Always on (core tool, no feature flag).');
      if (k in SF && k in CF) {
        const same = SF[k] === CF[k];
        return check(same ? 'pass' : 'fail', `Flag "${k}" is in both lists${same ? '' : ` but defaults differ (server ${SF[k]}, client ${CF[k]})`}.`);
      }
      return check('fail', `Flag "${k}" missing from ${k in SF ? 'client' : 'server'} list.`);
    },
  },
  {
    id: 'lifecycle',
    label: 'Lifecycle entry',
    severity: 'medium',
    area: 'Feature access',
    why: 'A tool that ships switched off needs a FEATURE_LIFECYCLE entry (preview or parked) so admins can see why it is off and whether it is ready.',
    fix: 'Add the same FEATURE_LIFECYCLE value to the server and client featureAccess.js files.',
    test(t, { SF, SL, CL }) {
      const k = t.featureKey;
      if (k && SF[k] === 'false') {
        const ok = k in SL && k in CL && SL[k] === CL[k];
        return check(ok ? 'pass' : 'fail', `Ships off: lifecycle server=${SL[k] || 'missing'}, client=${CL[k] || 'missing'}.`);
      }
      if (k) return check('pass', `Ships on${k in SL ? ` (lifecycle ${SL[k]})` : ' (counts as ga)'}.`);
      return check('na', 'No flag.');
    },
  },
  {
    id: 'rateLimit',
    label: 'AI rate limit',
    severity: 'high',
    area: 'Cost & abuse',
    why: 'A route that calls a model without aiLimiter lets a runaway client loop or a shared login run up model spend.',
    fix: 'Add aiLimiter at the mount in server/index.js (or on the AI handlers inside the route file), as the guide-chat routes do.',
    test(t, { files }) {
      const aiMounts = t.mounts.filter((m) => m.modules.some((mod) => AI_RX.test(files[mod])));
      if (!aiMounts.length) return check('na', 'No AI routes mounted directly.');
      const missing = aiMounts.filter((m) => !m.aiLimiter && !m.admin);
      const real = missing.filter((m) => !m.modules.some((mod) => files[mod].includes('aiLimiter')));
      return check(real.length ? 'warn' : 'pass',
        real.length ? `AI route(s) without aiLimiter: ${real.map((m) => m.path).join(', ')}` : 'AI routes rate-limited.',
        real.map((m) => ({ file: 'server/index.js', line: m.line, text: m.path })));
    },
  },
  {
    id: 'models',
    label: 'No hardcoded model ids',
    severity: 'high',
    area: 'Model selection',
    why: 'Model ids come from Settings through getModelsForUser. A hardcoded id goes stale and ignores the admin\'s choice.',
    fix: 'Replace the id with getModelsForUser(userId).standard or .light (or the tool\'s resolver). Hardcoded ids belong only in costCalculator.js and pricing.js.',
    test(t, { files }) {
      const ev = linesMatching(files, [...t.ownedServer, ...t.ownedClient], MODEL_RX, 6, (f) => MODEL_SKIP_RX.test(f));
      return check(ev.length ? 'fail' : 'pass', ev.length ? `${ev.length}+ hardcoded model id(s) outside pricing tables.` : 'No hardcoded model ids.', ev);
    },
  },
  {
    id: 'modelResolver',
    label: 'Model resolver',
    severity: 'medium',
    area: 'Model selection',
    why: 'Code that calls a model should pick it through getModelsForUser or a resolver, so Settings decides which model runs.',
    fix: 'Resolve the model with getModelsForUser(userId) (or a *ModelResolver) before calling it.',
    test(t, { files }) {
      const usesAi = t.ownedServer.some((f) => AI_RX.test(files[f]));
      if (!usesAi) return check('na', 'No direct AI calls in its own server code.');
      const resolves = t.ownedServer.some((f) => RESOLVE_RX.test(files[f]))
        || t.sharedServer.some((f) => AI_RX.test(files[f]) && RESOLVE_RX.test(files[f]));
      return check(resolves ? 'pass' : 'warn', resolves ? 'AI calls resolve models via Settings.' : 'Makes AI calls but no getModelsForUser / resolver seen in its own files; check.');
    },
  },
  {
    id: 'apiClient',
    vaultOnly: true,
    label: 'apiClient',
    severity: 'medium',
    area: 'Conventions',
    why: 'apiClient adds the login token and handles errors in one place. A raw fetch(\'/api...\') skips both.',
    fix: 'Call the endpoint through client/src/utils/apiClient.js; add a FormData or blob path to apiClient if it lacks one.',
    test(t, { files }) {
      const ev = linesMatching(files, t.ownedClient, RAWFETCH_RX);
      return check(ev.length ? 'fail' : 'pass', ev.length ? 'Raw fetch(\'/api...\') used.' : 'All /api calls through apiClient.', ev);
    },
  },
  {
    id: 'ssrf',
    label: 'SSRF guard',
    severity: 'high',
    area: 'Security',
    why: 'Fetching a URL a user typed, without the SSRF guard, can let them reach internal services from the server.',
    fix: 'Fetch user-supplied URLs with server/utils/safeFetch.js or server/services/htmlFetch.js.',
    test(t, { files }) {
      const risky = t.ownedServer.filter((f) => {
        const src = files[f];
        return !SAFE_RX.test(src) && SSRF_CALL_RX.test(src) && SSRF_SRC_RX.test(src);
      });
      if (!risky.length) return check('pass', 'No unguarded user-URL fetch seen.');
      const few = risky.slice(0, 4);
      return check('warn', `Fetches a URL taken from the request without safeFetch/htmlFetch: ${few.map((f) => path.posix.basename(f)).join(', ')}. Check whether the URL can be user-supplied.`,
        few.map((f) => ({ file: f, line: 0, text: '' })));
    },
  },
  {
    id: 'tests',
    label: 'Tests',
    severity: 'medium',
    area: 'Tests',
    why: 'Code with no tests breaks quietly. Tools that call paid APIs or handle money matter most.',
    fix: 'Add a node test file beside the tool\'s service or route (run it with node path/to/file.test.js; no package.json script).',
    test(t) {
      const n = t.tests.length;
      const status = n === 0 ? 'fail' : (n < 2 && t.locServer + t.locClient > 3000 ? 'warn' : 'pass');
      return check(status, `${n} test file(s) cover its own code.`);
    },
  },
  {
    id: 'guide',
    label: 'Guide chat',
    severity: 'low',
    area: 'Conventions',
    why: 'Every tool follows the Video Tools conventions, which include a guide chat for help in plain words.',
    fix: 'Add the tool to server/config/guides.js and use the shared TutorChat (docs/guide-chat.md), then run npm run test:guides.',
    test(t, { files, guideEndpoints }) {
      const tutorCalls = t.apiCalls.filter((a) => a.includes('tutor'));
      const hasGuideCfg = t.ownedClient.some((f) => files[f].includes('guideId'));
      const registered = tutorCalls.filter((a) => guideEndpoints.has(a));
      if (t.adminOnly && !tutorCalls.length) return check('na', 'Admin-only page.');
      if (registered.length || (hasGuideCfg && tutorCalls.length)) {
        return check('pass', `Guide chat: ${[...new Set(registered.length ? registered : tutorCalls)].sort().join(', ')}`);
      }
      if (tutorCalls.length) return check('warn', `Calls a tutor endpoint not listed in server/config/guides.js: ${tutorCalls.join(', ')}`);
      return check('fail', 'No guide chat found (convention: every tool has one).');
    },
  },
  {
    id: 'docs',
    label: 'Docs',
    severity: 'low',
    area: 'Docs',
    why: 'A docs/<tool>.md file is where gotchas and decisions live, so the next change does not repeat old mistakes.',
    fix: 'Write docs/<tool>.md (or add the alias in rules.js DOC_ALIAS if it is documented under another name).',
    test(t, { docs, keyfiles }) {
      const k = t.featureKey;
      const cands = [`${kebab(t.id)}.md`, k ? `${kebab(k)}.md` : null, DOC_ALIAS[t.id]];
      const found = cands.filter((d) => d && docs.has(d));
      const pref = [...docs].filter((d) => d.startsWith(`${kebab(t.id)}-`)).sort();
      if (found.length || pref.length) return check('pass', `docs/${(found.length ? found : pref)[0]}`);
      const mentioned = keyfiles.includes(t.label) || (t.clientEntries.length > 0 && keyfiles.includes(path.posix.basename(t.clientEntries[0])));
      return check(mentioned ? 'warn' : 'fail', mentioned ? 'Only mentioned in docs/key-files.md; no docs/<tool>.md.' : 'No docs file found.');
    },
  },
  {
    id: 'recycleBin',
    label: 'Recycle bin',
    severity: 'low',
    area: 'Data safety',
    why: 'Deleted user content should go to the shared 30-day recycle bin so a mistake can be undone.',
    fix: 'Call moveToBin() in the same transaction as the delete (docs/recycle-bin.md), or record in the tool\'s doc why its deletes are trivial.',
    test(t, { files }) {
      const dels = linesMatching(files, t.ownedServer, DEL_RX, 4, (f) => !f.startsWith('server/routes/'));
      if (!dels.length) return check('na', 'No delete routes of its own.');
      const usesBin = t.ownedServer.some((f) => BIN_RX.test(files[f]));
      return check(usesBin ? 'pass' : 'warn',
        usesBin ? 'Deletes go to the recycle bin.' : `${dels.length}+ delete route(s), no moveToBin seen. Fine if items are trivial; check.`,
        usesBin ? [] : dels);
    },
  },
  {
    id: 'icons',
    vaultOnly: true,
    label: 'getIcon',
    severity: 'low',
    area: 'UI system',
    why: 'Icons go through getIcon so the semantic map stays the one place icons are chosen.',
    fix: 'Replace the lucide-react import with getIcon(name, { size }) from IconProvider, adding the name to the semantic map first.',
    test(t, { files }) {
      const ev = linesMatching(files, t.ownedClient, LUCIDE_RX, 6, (f) => ICON_SKIP_RX.test(f));
      return check(ev.length ? 'fail' : 'pass', ev.length ? 'Imports lucide-react directly (use getIcon).' : 'Icons via getIcon.', ev);
    },
  },
  {
    id: 'modals',
    vaultOnly: true,
    label: 'Shared Dialog',
    severity: 'low',
    area: 'UI system',
    why: 'Dialog.jsx handles focus, Escape, scroll lock and z-index. Hand-rolled overlays drift from it.',
    fix: 'Use client/src/components/Dialog.jsx unless the overlay is a deliberate full-screen mode.',
    test(t, { files }) {
      const ev = linesMatching(files, t.ownedClient, MODAL_RX, 6, (f) => f.endsWith('Dialog.jsx'));
      return check(ev.length ? 'warn' : 'pass', ev.length ? `Hand-rolled "fixed inset-0" overlay(s) (${ev.length}+). Use Dialog.jsx unless it is a full-screen mode.` : 'Uses the shared Dialog.', ev);
    },
  },
  {
    id: 'logging',
    label: 'Logger',
    severity: 'low',
    area: 'Observability',
    why: 'getLogger() tags each line with the request and user, so problems can be traced. console.* lines cannot.',
    fix: 'Replace console.* with getLogger() from server/middleware/requestContext.js (docs/observability.md).',
    test(t, { files }) {
      if (!t.ownedServer.length) return check('na', 'No server code of its own.');
      const n = t.ownedServer.reduce((s, f) => s + (files[f].match(CONSOLE_RX) || []).length, 0);
      const usesLogger = t.ownedServer.some((f) => files[f].includes('getLogger'));
      return check(n > 5 ? 'warn' : 'pass', `${n} console.* call(s); ${usesLogger ? 'uses getLogger.' : 'no getLogger.'}`);
    },
  },
];

const RULE_BY_ID = Object.fromEntries(RULES.map((r) => [r.id, r]));

// ---- context the rules read ----

function flagKeys(src) {
  const d = src.indexOf('DEFAULT');
  if (d === -1) return {};
  let blk = src.slice(src.indexOf('{', d));
  const end = blk.indexOf('};');
  if (end !== -1) blk = blk.slice(0, end);
  return Object.fromEntries([...blk.matchAll(/^\s*(\w+):\s*(true|false)/gm)].map((m) => [m[1], m[2]]));
}

function lifecycleKeys(src) {
  const d = src.indexOf('FEATURE_LIFECYCLE =');
  if (d === -1) return {};
  let blk = src.slice(src.indexOf('{', d));
  const end = blk.indexOf('};');
  if (end !== -1) blk = blk.slice(0, end);
  return Object.fromEntries([...blk.matchAll(/^\s*(\w+):\s*'(\w+)'/gm)].map((m) => [m[1], m[2]]));
}

// docs: Set of names in docs/; keyfiles: text of docs/key-files.md.
function buildRuleContext(files, { docs = new Set(), keyfiles = '' } = {}) {
  const srv = files['server/config/featureAccess.js'] || '';
  const cli = files['client/src/utils/featureAccess.js'] || '';
  return {
    files,
    SF: flagKeys(srv),
    CF: flagKeys(cli),
    SL: lifecycleKeys(srv),
    CL: lifecycleKeys(cli),
    guideEndpoints: new Set([...(files['server/config/guides.js'] || '').matchAll(/endpoint: '([^']+)'/g)].map((m) => m[1])),
    docs,
    keyfiles,
  };
}

// Python's round(): halves go to the even number (62.5 -> 62), so scores match the reference.
function pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

// Runs every rule on a tool and adds checks, score, fails, warns, lifecycle, defaultOn.
function applyRules(t, ctx, rules = RULES) {
  const c = {};
  // vaultOnly rules check Vault's own client code, not an embedded app (it has no apiClient, Dialog or getIcon).
  const vaultView = { ...t, ownedClient: (t.ownedClient || []).filter((f) => !appOf(f)) };
  for (const r of rules) c[r.id] = r.test(r.vaultOnly ? vaultView : t, ctx);
  const vals = Object.values(c);
  const pass = vals.filter((v) => v.status === 'pass').length;
  const total = vals.filter((v) => v.status !== 'na').length;
  t.checks = c;
  t.score = total ? pyRound((100 * pass) / total) : 100;
  t.fails = vals.filter((v) => v.status === 'fail').length;
  t.warns = vals.filter((v) => v.status === 'warn').length;
  const k = t.featureKey;
  t.lifecycle = k ? ctx.SL[k] || 'ga' : 'ga';
  t.defaultOn = k ? (ctx.SF[k] || 'true') === 'true' : true;
  return t;
}

module.exports = {
  RULES, RULE_BY_ID, DOC_ALIAS, MODEL_RX, AI_RX, CONSOLE_RX,
  check, linesMatching, pyRound, flagKeys, lifecycleKeys, buildRuleContext, applyRules,
};
