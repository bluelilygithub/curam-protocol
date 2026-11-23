'use strict';

// Runs NVIDIA SkillSpector (installed in Dockerfile.base, pinned) on one GitHub link or uploaded zip and turns its JSON into the shape the
// Skill Scanner page shows. See docs/skill-scan.md.
//
// Safety:
// - The child process gets a MINIMAL environment, never Vault's: only PATH, a throwaway HOME, locale settings and, for a deep scan only,
//   ANTHROPIC_API_KEY. Vault's other secrets (database, OAuth, other API keys) never reach it.
// - shell:false, a hard timeout, and everything in a temporary folder that is deleted afterwards (the zip, the clone, the report).
// - Static scans always pass --no-llm (SkillSpector's model analysis is ON by default).
// - SkillSpector itself never runs the scanned code or installs its packages; it bounds clones and zips (100 MB, 10,000 files, 60 s)
//   and refuses zip-slip, symlinks and encrypted entries.
// - Only public github.com links are accepted here (SkillSpector would also take GitLab and Bitbucket).

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = process.env.SKILLSPECTOR_BIN || 'skillspector';
const STATIC_TIMEOUT_MS = 6 * 60 * 1000;
const DEEP_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_ISSUES = 2000;
const GITHUB_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(\/tree\/[A-Za-z0-9._/-]{1,300})?\/?$/;

/** A public github.com link to a repo or a folder in it, tidied; null when it is anything else. */
function parseGithubUrl(raw) {
  const s = String(raw || '').trim();
  const m = s.match(GITHUB_URL_RE);
  if (!m || /\.\./.test(s)) return null;
  return `https://github.com/${m[1]}/${m[2]}${m[3] ? m[3].replace(/\/+$/, '') : ''}`;
}

/** The only environment SkillSpector gets. */
function scanEnv({ home, deep = false, anthropicKey = null, model = null }) {
  const env = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PYTHONIOENCODING: 'utf-8',
    NO_COLOR: '1',
    TERM: 'dumb',
    SKILLSPECTOR_MAX_WORKFLOW_SECONDS: String(Math.floor((deep ? DEEP_TIMEOUT_MS : STATIC_TIMEOUT_MS) / 1000) - 30),
  };
  // Windows (local development only) needs these to start a process at all
  for (const k of ['SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE']) if (process.platform === 'win32' && process.env[k]) env[k] = process.env[k];
  if (deep) {
    env.SKILLSPECTOR_PROVIDER = 'anthropic';
    env.ANTHROPIC_API_KEY = anthropicKey || '';
    if (model) env.SKILLSPECTOR_MODEL = model;
  }
  return env;
}

function buildArgs({ target, outFile, deep = false, recursive = false }) {
  return [
    'scan', target, '-f', 'json', '-o', outFile,
    ...(deep ? [] : ['--no-llm']),
    ...(recursive ? ['--recursive', '--max-skills', '32'] : []),
  ];
}

/** spawn without a shell; resolves { code, stdout, stderr, timedOut }. Output is capped so a noisy run cannot fill memory. */
function runProcess(bin, args, { env, cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const cap = (s, add) => (s.length > 40000 ? s : s + add);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try { child = spawn(bin, args, { env, cwd, shell: false, windowsHide: true }); } catch (err) { resolve({ code: -1, stdout, stderr: err.message, timedOut }); return; }
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout = cap(stdout, d.toString()); });
    child.stderr.on('data', (d) => { stderr = cap(stderr, d.toString()); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}`, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

/** Is the skillspector command there (it is not until the base image with it has been deployed)? Cached for 10 minutes. */
let installedCache = { at: 0, value: null };
async function isInstalled(deps = {}) {
  if (!deps.run && installedCache.value !== null && Date.now() - installedCache.at < 10 * 60 * 1000) return installedCache.value;
  const home = os.tmpdir();
  const res = await (deps.run || runProcess)(BIN, ['--help'], { env: scanEnv({ home }), cwd: home, timeoutMs: 30000 });
  const value = res.code === 0;
  if (!deps.run) installedCache = { at: Date.now(), value };
  return value;
}

const clip = (v, n) => (v == null ? null : String(v).replace(/\s+$/g, '').slice(0, n));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function normIssue(i) {
  return {
    id: clip(i.id, 40),
    category: clip(i.category, 80),
    pattern: clip(i.pattern, 120),
    severity: SEVERITIES.includes(String(i.severity).toUpperCase()) ? String(i.severity).toUpperCase() : 'LOW',
    confidence: num(i.confidence),
    file: clip(i.location?.file, 300),
    line: num(i.location?.start_line),
    finding: clip(i.finding, 300),
    explanation: clip(i.explanation, 800),
    remediation: clip(i.remediation, 800),
    snippet: clip(i.code_snippet, 800),
    occurrences: Array.isArray(i.occurrences) ? i.occurrences.length : 1,
  };
}

const counts = (issues) => Object.fromEntries(SEVERITIES.map((s) => [s, issues.filter((i) => i.severity === s).length]));

/** One skill's report (SkillSpector's single-skill JSON, or one entry of a --recursive run). */
function normSkill(r) {
  if (r && r.error && !r.risk_assessment) return { name: clip(r.name, 200) || 'unknown', path: clip(r.path, 300), error: clip(r.error, 500), issues: [], counts: counts([]) };
  const ra = r?.risk_assessment || {};
  const ac = r?.analysis_completeness || {};
  const md = r?.metadata || {};
  const issues = (Array.isArray(r?.issues) ? r.issues : []).slice(0, MAX_ISSUES).map(normIssue);
  return {
    name: clip(r?.skill?.name || r?.name, 200) || 'unknown',
    path: clip(r?.path, 300),
    score: num(ra.score ?? r?.risk_score),
    severity: clip(ra.severity || r?.risk_severity, 20),
    recommendation: clip(ra.recommendation, 30),
    maxIssueSeverity: clip(ra.max_issue_severity, 20),
    executionSuccessful: r?.execution_successful !== false,
    complete: ac.is_complete !== false,
    coverage: num(ac.coverage_percent),
    limitations: (Array.isArray(ac.limitations) ? ac.limitations : []).slice(0, 10).map((l) => clip(typeof l === 'string' ? l : JSON.stringify(l), 300)),
    fileCount: Array.isArray(r?.components) ? r.components.length : null,
    suppressedCount: num(r?.suppressed_count) || 0,
    llm: { requested: !!md.llm_requested, available: md.llm_available ?? null, degraded: !!md.llm_degraded, error: clip(md.llm_error, 300) },
    version: clip(md.skillspector_version, 40),
    issues,
    counts: counts(issues),
  };
}

/** SkillSpector JSON (single skill, or `multi_skill` from --recursive) -> the page's report. */
function normalizeReport(raw) {
  if (raw && raw.multi_skill) {
    const skills = (Array.isArray(raw.skills) ? raw.skills : []).map(normSkill);
    const all = skills.flatMap((s) => s.issues);
    return {
      multi: true,
      score: num(raw.max_risk_score),
      severity: clip(raw.risk_severity, 20),
      recommendation: clip(raw.risk_recommendation, 30),
      executionSuccessful: raw.execution_successful !== false,
      complete: raw.analysis_completeness?.is_complete !== false,
      skillCount: num(raw.skill_count) ?? skills.length,
      skillsOmitted: num(raw.skills_omitted) || 0,
      version: skills.find((s) => s.version)?.version || null,
      issueCount: all.length,
      counts: counts(all),
      skills,
    };
  }
  const s = normSkill(raw || {});
  return {
    multi: false, score: s.score, severity: s.severity, recommendation: s.recommendation, executionSuccessful: s.executionSuccessful,
    complete: s.complete, skillCount: 1, skillsOmitted: 0, version: s.version, issueCount: s.issues.length, counts: s.counts, skills: [s],
  };
}

const lastLines = (s, n = 3) => String(s || '').trim().split(/\r?\n/).filter((l) => l.trim() && !/^\s*[│┃╭╰─━]+/.test(l)).slice(-n).join(' ').slice(0, 400);

/**
 * Scan a GitHub link (`url`) or a zip (`zipBuffer`). Resolves { exitCode, report, raw } or throws with a plain message.
 * Exit 0 = no policy failure, 1 = risk above the threshold (a normal result), 2 = SkillSpector could not complete.
 */
async function runScan({ url = null, zipBuffer = null, deep = false, recursive = false, model = null }, deps = {}) {
  const target0 = url ? parseGithubUrl(url) : null;
  if (url && !target0) throw Object.assign(new Error('Paste a public github.com link, e.g. https://github.com/owner/repo or a /tree/main/folder link.'), { status: 400 });
  if (!url && !zipBuffer) throw Object.assign(new Error('Paste a GitHub link or upload a zip.'), { status: 400 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-skillscan-'));
  try {
    let target = target0;
    if (zipBuffer) {
      target = path.join(dir, 'skill.zip');
      fs.writeFileSync(target, zipBuffer);
    }
    const outFile = path.join(dir, 'report.json');
    const home = path.join(dir, 'home');
    fs.mkdirSync(home);
    const timeoutMs = deep ? DEEP_TIMEOUT_MS : STATIC_TIMEOUT_MS;
    const res = await (deps.run || runProcess)(BIN, buildArgs({ target, outFile, deep, recursive }),
      { env: scanEnv({ home, deep, anthropicKey: deps.anthropicKey ?? process.env.ANTHROPIC_API_KEY, model }), cwd: dir, timeoutMs });
    if (res.timedOut) throw new Error(`The scan took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped.`);
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { /* no report written */ }
    if (!raw) {
      if (res.code === -1) throw new Error('SkillSpector is not installed on this server yet (it arrives with the next base image).');
      throw new Error(`SkillSpector could not scan that: ${lastLines(res.stderr) || lastLines(res.stdout) || `exit code ${res.code}`}`);
    }
    return { exitCode: res.code, report: normalizeReport(raw), raw };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = {
  BIN, STATIC_TIMEOUT_MS, DEEP_TIMEOUT_MS, GITHUB_URL_RE,
  parseGithubUrl, scanEnv, buildArgs, runProcess, isInstalled, normIssue, normSkill, normalizeReport, runScan,
};
