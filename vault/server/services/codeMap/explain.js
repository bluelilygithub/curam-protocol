'use strict';

// Code Map "Explain and plan a fix" (milestone 5): for one finding in one stored run, ask the workspace's standard model for a short
// explanation and a step-by-step fix plan that cites file:line.
//
// Grounding: the model sees only the finding (rule, why, fix, the tool's note), its evidence from the stored run, and excerpts read from
// disk around each evidence line: up to 200 lines per location (100 either side, or the first 200 lines when the evidence has no line),
// overlapping windows merged, at most MAX_LOCATIONS locations and MAX_TOTAL_LINES lines in all. Only paths inside server/ and client/src/
// are read; anything else (absolute, "..", another folder, a symlink out, node_modules, .env) is refused and listed as not read.
// The answer is untrusted: references that do not point into an excerpt it was shown are dropped.
// Model: getModelsForUser(userId).standard through callModel, usage logged as code_map_explain. No hardcoded model id.
// Injectable (getRun, readFile, realpath, getModels, callModel, logUsage) so the test needs no database, disk or model.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const ALLOWED = ['server/', 'client/src/'];
const WINDOW = 200;
const MAX_LOCATIONS = 8;
const MAX_TOTAL_LINES = 800;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const FEATURE = 'code_map_explain';

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** A repo-relative path we may read, normalised, or null. Lexical check only; the caller also checks where it really points. */
function allowedPath(file) {
  if (typeof file !== 'string' || !file || file.length > 400 || file.includes('\0') || file.includes('\\')) return null;
  if (path.posix.isAbsolute(file) || /^[a-zA-Z]:/.test(file)) return null;
  const norm = path.posix.normalize(file);
  if (norm !== file || norm.startsWith('../') || norm.split('/').includes('..')) return null;
  if (!ALLOWED.some((p) => norm.startsWith(p))) return null;
  if (norm.split('/').some((s) => s === 'node_modules' || s.startsWith('.env'))) return null;
  return norm;
}

/** The finding, the tool's check and the evidence for { ruleId, toolId, findingId } in a run result. */
function locateFinding(result, { ruleId, toolId, findingId }) {
  const findings = result.findings || [];
  const tool = (result.tools || []).find((t) => t.id === toolId) || null;
  let f = findingId ? findings.find((x) => x.id === findingId && x.ruleId === ruleId) : null;
  if (!f) f = findings.find((x) => x.ruleId === ruleId && (!toolId || toolId === 'all' || (x.tools || []).includes(toolId)));
  if (!f) return null;
  const rule = (result.rules || []).find((r) => r.id === ruleId) || null;
  if (f.kind === 'rule') {
    if (!tool || !(f.tools || []).includes(tool.id)) return null;
    const check = (tool.checks || {})[ruleId] || {};
    return { finding: f, rule, tool, status: check.status, note: check.note, evidence: check.evidence || [] };
  }
  return { finding: f, rule, tool, status: null, note: f.title, evidence: f.evidence || [] };
}

/** Excerpts around each evidence location, from allowed files only. */
function gatherExcerpts(evidence, { root = ROOT, readFile, realpath } = {}) {
  const read = readFile || ((p) => {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) throw new Error('not a readable file');
    return fs.readFileSync(p, 'utf8');
  });
  const real = realpath || ((p) => fs.realpathSync(p));
  const rootReal = (() => { try { return real(root); } catch { return root; } })();
  const refused = [];
  const byFile = new Map(); // file -> [lineNumbers]
  for (const e of evidence) {
    const f = allowedPath(e && e.file);
    if (!f) { if (e && e.file && !refused.some((r) => r.file === e.file)) refused.push({ file: String(e.file), reason: 'outside server/ and client/src/' }); continue; }
    if (!byFile.has(f)) {
      if (byFile.size >= MAX_LOCATIONS) continue;
      byFile.set(f, []);
    }
    byFile.get(f).push(Math.max(0, Number(e.line) || 0));
  }
  const excerpts = [];
  let total = 0;
  for (const [file, lines] of byFile) {
    let text;
    try {
      const abs = path.resolve(root, file);
      const where = real(abs);
      const rel = path.relative(rootReal, where);
      if (rel.startsWith('..') || path.isAbsolute(rel) || !allowedPath(rel.split(path.sep).join('/'))) {
        refused.push({ file, reason: 'points outside server/ and client/src/' });
        continue;
      }
      text = read(where);
    } catch {
      refused.push({ file, reason: 'could not be read (moved or deleted since the run?)' });
      continue;
    }
    const all = String(text).replace(/\r\n?/g, '\n').split('\n');
    const wins = lines.map((ln) => (ln > 0 ? [Math.max(1, ln - WINDOW / 2), ln + WINDOW / 2 - 1] : [1, WINDOW]))
      .map(([a, b]) => [a, Math.min(b, all.length)]).sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const w of wins) {
      const last = merged[merged.length - 1];
      if (last && w[0] <= last[1] + 1) last[1] = Math.max(last[1], w[1]);
      else merged.push([...w]);
    }
    for (const [from, to0] of merged) {
      if (total >= MAX_TOTAL_LINES) break;
      const to = Math.min(to0, from + (MAX_TOTAL_LINES - total) - 1);
      if (to < from) continue;
      excerpts.push({ file, from, to, text: all.slice(from - 1, to).map((l, i) => `${from + i}| ${l}`).join('\n') });
      total += to - from + 1;
    }
  }
  return { excerpts, refused, totalLines: total };
}

const SYSTEM = `You are reviewing the source code of Vault, a Node/Express and React web app, for its administrator. You get one finding from Vault's Code Map (a regex-based check of the code against the project's own rules), the evidence it found, and excerpts of the files named, with line numbers.

Rules:
- Use ONLY the finding and the excerpts given. Do not assume code you were not shown exists or behaves a certain way.
- If the excerpts do not show enough to explain the finding or to plan a fix, say "I could not tell" and what you would need to see. Never guess.
- The checks are pattern matches and can be wrong. If the excerpts show the finding is a false positive, say so plainly and explain why.
- Cite every claim and every step with file:line from the excerpts (for example server/routes/notes.js:42). Only cite lines you were shown.
- Plain, short, practical. The plan is for a developer: name the file and what to change, in order. Do not write whole files.

Reply with JSON only, no other text:
{"explanation": "2 to 5 sentences: what the finding means here and why it matters, with file:line references",
 "falsePositive": false,
 "steps": [{"do": "one concrete change", "refs": ["file:line"]}],
 "unsure": "what you could not tell, or an empty string"}`;

function buildPrompt(loc, excerpts, refused) {
  const r = loc.rule || {};
  const f = loc.finding;
  const lines = [
    'FINDING',
    `Rule: ${r.label || f.ruleId} (${f.ruleId}), severity ${f.sev}, area ${f.area || ''}`,
    `Why it matters: ${r.why || f.why || ''}`,
    `Usual fix: ${r.fix || f.fix || ''}`,
    loc.tool ? `Tool: ${loc.tool.label} (${loc.tool.id})${loc.status ? `, status ${loc.status}` : ''}` : 'Tool: none in particular (a structural finding)',
    `What the check found: ${loc.note || f.title || ''}`,
    '',
    'EVIDENCE (file:line and the matching text)',
    ...(loc.evidence.length ? loc.evidence.slice(0, 30).map((e) => `- ${e.file}${e.line ? `:${e.line}` : ''}${e.text ? `  ${String(e.text).slice(0, 200)}` : ''}`) : ['- none recorded']),
    '',
    'EXCERPTS',
  ];
  if (!excerpts.length) lines.push('(none could be read)');
  for (const x of excerpts) lines.push(`--- ${x.file} lines ${x.from}-${x.to} ---`, x.text);
  if (refused.length) lines.push('', 'NOT READ', ...refused.map((x) => `- ${x.file}: ${x.reason}`));
  return lines.join('\n');
}

const REF_RE = /((?:server|client\/src)\/[\w./-]+\.\w+):(\d+)/g;

/** The model's answer, checked: references must point into an excerpt it was shown. */
function normalizeAnswer(raw, excerpts) {
  const inside = (file, line) => excerpts.some((x) => x.file === file && line >= x.from && line <= x.to);
  const dropped = new Set();
  const keepRefs = (list) => {
    const out = [];
    for (const s of Array.isArray(list) ? list : []) {
      const m = /^((?:server|client\/src)\/[\w./-]+\.\w+):(\d+)$/.exec(String(s).trim());
      if (m && inside(m[1], Number(m[2]))) { if (!out.includes(m[0])) out.push(m[0]); } else dropped.add(String(s).slice(0, 120));
    }
    return out.slice(0, 6);
  };
  const textRefs = (t) => {
    for (const m of String(t).matchAll(REF_RE)) if (!inside(m[1], Number(m[2]))) dropped.add(m[0]);
  };
  let j = null;
  const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { j = JSON.parse(s); } catch {
    const a = s.indexOf('{'); const b = s.lastIndexOf('}');
    if (a !== -1 && b > a) { try { j = JSON.parse(s.slice(a, b + 1)); } catch { j = null; } }
  }
  if (!j || typeof j !== 'object') {
    return { explanation: 'I could not tell: the answer came back in a form that could not be read. Try again.', falsePositive: false, steps: [], unsure: '', droppedRefs: [] };
  }
  const explanation = String(j.explanation || '').slice(0, 3000).trim() || 'I could not tell.';
  textRefs(explanation);
  const steps = (Array.isArray(j.steps) ? j.steps : []).slice(0, 10).map((x) => {
    const doText = String((x && x.do) || '').slice(0, 1000).trim();
    textRefs(doText);
    return { do: doText, refs: keepRefs(x && x.refs) };
  }).filter((x) => x.do);
  return { explanation, falsePositive: j.falsePositive === true, steps, unsure: String(j.unsure || '').slice(0, 1000).trim(), droppedRefs: [...dropped].slice(0, 20) };
}

/**
 * Explain one finding of one run.
 * @param {number} userId
 * @param {{ runId: number, ruleId: string, toolId?: string, findingId?: string }} input
 */
async function explainFinding(userId, input = {}, deps = {}) {
  const { runId, ruleId } = input;
  const toolId = typeof input.toolId === 'string' ? input.toolId : '';
  const findingId = typeof input.findingId === 'string' ? input.findingId : '';
  if (!Number.isInteger(runId) || runId < 1) throw httpError(400, 'Which run? (runId must be a run id)');
  if (typeof ruleId !== 'string' || !/^[A-Za-z]{1,40}$/.test(ruleId)) throw httpError(400, 'Which finding? (ruleId is missing)');
  if (toolId && !/^[\w-]{1,60}$/.test(toolId)) throw httpError(400, 'toolId is not a tool id.');
  const getRun = deps.getRun || ((id) => require('./jobs').get(id));
  const run = await getRun(runId);
  if (!run) throw httpError(404, 'That run is no longer here (the last 30 are kept).');
  if (run.status !== 'done' || !run.result) throw httpError(400, 'Only a finished run can be explained.');
  const loc = locateFinding(run.result, { ruleId, toolId, findingId });
  if (!loc) throw httpError(404, 'That finding is not in this run for that tool.');

  const { excerpts, refused, totalLines } = gatherExcerpts(loc.evidence, { root: deps.root || ROOT, readFile: deps.readFile, realpath: deps.realpath });
  const resolve = deps.getModels || require('../modelResolver').getModelsForUser;
  const call = deps.callModel || require('../callModel').callModel;
  const tiers = await resolve(userId);
  const modelId = tiers && tiers.standard;
  if (!modelId) throw httpError(503, 'No AI model is set up for this workspace yet.');
  const result = await call(modelId, buildPrompt(loc, excerpts, refused), { system: SYSTEM, maxTokens: 1500, returnUsage: true, timeoutMs: 60000 });
  (deps.logUsage || require('../../utils/logUsage').logUsage)({ userId, model: result.model || modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: FEATURE });
  return {
    ...normalizeAnswer(result.text, excerpts),
    model: result.model || modelId,
    read: excerpts.map((x) => ({ file: x.file, from: x.from, to: x.to })),
    notRead: refused,
    linesRead: totalLines,
    finding: { runId, ruleId, toolId: loc.tool ? loc.tool.id : null, findingId: loc.finding.id },
  };
}

module.exports = { explainFinding, allowedPath, locateFinding, gatherExcerpts, buildPrompt, normalizeAnswer, SYSTEM, FEATURE, WINDOW, MAX_LOCATIONS, MAX_TOTAL_LINES };
