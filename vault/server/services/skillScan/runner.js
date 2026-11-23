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
const EACH_SKILL_TIMEOUT_MS = 15 * 60 * 1000; // a static scan of up to MAX_SKILLS skills, one after another
const timeoutFor = ({ deep = false, recursive = false } = {}) => (deep ? DEEP_TIMEOUT_MS : recursive ? EACH_SKILL_TIMEOUT_MS : STATIC_TIMEOUT_MS);
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
function scanEnv({ home, deep = false, anthropicKey = null, model = null, timeoutMs = timeoutFor({ deep }) }) {
  const env = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PYTHONIOENCODING: 'utf-8',
    NO_COLOR: '1',
    TERM: 'dumb',
    SKILLSPECTOR_MAX_WORKFLOW_SECONDS: String(Math.floor(timeoutMs / 1000) - 30),
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

// --recursive only works on a LOCAL folder: SkillSpector ignores it for a link or a zip (one bundle) and refuses --max-skills there
// ("--max-skills requires a local --recursive multi-skill directory"). So an each-skill scan is always given a folder that Vault
// unpacked itself (prepareFolder below), where --max-skills is allowed. Its default of 32 would leave most of a big repository
// unscanned (claude-trading-skills has 68 skills), so it is raised to MAX_SKILLS.
const MAX_SKILLS = 100;
function buildArgs({ target, outFile, deep = false, recursive = false }) {
  return [
    'scan', target, '-f', 'json', '-o', outFile,
    ...(deep ? [] : ['--no-llm']),
    ...(recursive ? ['--recursive', '--max-skills', String(MAX_SKILLS)] : []),
  ];
}

const MAX_UNPACKED_BYTES = 100 * 1024 * 1024; // the same caps SkillSpector applies to its own downloads and zips
const MAX_ENTRIES = 10000;

/** A github.com link -> the archive to download and the folder inside it ("/tree/main/skills/pdf" -> ref main, folder skills/pdf). */
function githubArchive(url) {
  const m = String(url).match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/([^/]+)((?:\/[^/]+)*))?$/);
  if (!m) return null;
  return {
    archiveUrl: `https://github.com/${m[1]}/${m[2]}/archive/${m[3] ? encodeURIComponent(m[3]) : 'HEAD'}.zip`,
    subPath: (m[4] || '').replace(/^\/+/, ''),
  };
}

/**
 * Unpack a zip into `dest`, refusing anything unsafe: absolute or drive paths, "..", more than MAX_ENTRIES entries, and more than
 * MAX_UNPACKED_BYTES unpacked (counted while streaming, so a zip bomb is stopped part-way, not after inflating in memory). Symlinks are
 * skipped, never created. Every path is checked to stay inside `dest`.
 */
async function extractZip(buffer, dest, { maxBytes = MAX_UNPACKED_BYTES, maxEntries = MAX_ENTRIES } = {}) {
  const JSZip = require('jszip');
  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch (err) { throw Object.assign(new Error(`That zip could not be opened (${err.message}).`), { status: 400 }); }
  const entries = Object.values(zip.files);
  if (entries.length > maxEntries) throw Object.assign(new Error(`The zip has more than ${maxEntries} files.`), { status: 400 });
  const root = path.resolve(dest);
  let total = 0;
  for (const e of entries) {
    // jszip quietly rewrites "../x" to "x"; check the name as written in the zip too, and refuse the whole zip if it tries to escape
    const original = String(e.unsafeOriginalName || '').replace(/\\/g, '/');
    if (original.startsWith('/') || /^[A-Za-z]:/.test(original) || original.split('/').includes('..')) {
      throw Object.assign(new Error('The zip contains an unsafe path, so it was not scanned.'), { status: 400 });
    }
    const name = String(e.name || '').replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) {
      throw Object.assign(new Error('The zip contains an unsafe path, so it was not scanned.'), { status: 400 });
    }
    if (e.dir) continue;
    const mode = Number(e.unixPermissions) || 0;
    if ((mode & 0o170000) === 0o120000) continue; // a symlink: never created
    const out = path.resolve(root, name);
    if (!out.startsWith(root + path.sep)) throw Object.assign(new Error('The zip contains an unsafe path, so it was not scanned.'), { status: 400 });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(out);
      const st = e.nodeStream('nodebuffer');
      st.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          st.pause();
          ws.destroy();
          reject(Object.assign(new Error(`The zip unpacks to more than ${Math.round(maxBytes / 1048576)} MB, so it was not scanned.`), { status: 400 }));
        }
      });
      st.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      st.pipe(ws);
    });
  }
}

/** The folder to scan: unpack, step into a lone top folder (GitHub archives always have one), then into the /tree/ folder if asked. */
async function prepareFolder({ zipBuffer, url, dir }, deps = {}) {
  let buffer = zipBuffer;
  let subPath = '';
  if (!buffer) {
    const gh = githubArchive(url);
    if (!gh) throw Object.assign(new Error('That GitHub link cannot be downloaded.'), { status: 400 });
    subPath = gh.subPath;
    try {
      buffer = (await (deps.fetchFile || require('../../utils/safeFetch').fetchPublicFile)(gh.archiveUrl, { maxBytes: MAX_UNPACKED_BYTES, timeoutMs: 60000, accept: 'application/zip' })).buffer;
    } catch (err) {
      throw new Error(`The repository could not be downloaded from GitHub (${err.message}). Check the link is public and the branch name is right.`);
    }
  }
  const src = path.join(dir, 'src');
  fs.mkdirSync(src);
  await extractZip(buffer, src, deps.limits);
  let root = src;
  const top = fs.readdirSync(root, { withFileTypes: true });
  if (top.length === 1 && top[0].isDirectory()) root = path.join(root, top[0].name);
  if (subPath) {
    const sub = path.resolve(root, subPath);
    if (!sub.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(sub) || !fs.statSync(sub).isDirectory()) {
      throw Object.assign(new Error(`The folder "${subPath}" is not in that repository.`), { status: 400 });
    }
    root = sub;
  }
  return root;
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
    if (recursive) {
      // each skill separately needs a local folder (see buildArgs)
      target = await prepareFolder({ zipBuffer, url: target0, dir }, deps);
    } else if (zipBuffer) {
      target = path.join(dir, 'skill.zip');
      fs.writeFileSync(target, zipBuffer);
    }
    const outFile = path.join(dir, 'report.json');
    const home = path.join(dir, 'home');
    fs.mkdirSync(home);
    const timeoutMs = timeoutFor({ deep, recursive });
    const res = await (deps.run || runProcess)(BIN, buildArgs({ target, outFile, deep, recursive }),
      { env: scanEnv({ home, deep, anthropicKey: deps.anthropicKey ?? process.env.ANTHROPIC_API_KEY, model, timeoutMs }), cwd: dir, timeoutMs });
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
  BIN, STATIC_TIMEOUT_MS, DEEP_TIMEOUT_MS, EACH_SKILL_TIMEOUT_MS, MAX_SKILLS, GITHUB_URL_RE, timeoutFor,
  parseGithubUrl, scanEnv, buildArgs, runProcess, isInstalled, normIssue, normSkill, normalizeReport, runScan,
  githubArchive, extractZip, prepareFolder,
};
