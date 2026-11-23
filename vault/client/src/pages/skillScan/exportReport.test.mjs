// node client/src/pages/skillScan/exportReport.test.mjs
import assert from 'node:assert/strict';
import { reportMarkdown, reportJson, exportName } from './exportReport.mjs';

const scan = {
  id: 5, userId: 1, source: 'https://github.com/agiprolabs/claude-trading-skills', mode: 'static', recursive: false, finishedAt: '2026-11-24T07:00:00Z',
  report: {
    multi: false, score: 100, recommendation: 'DO_NOT_INSTALL', complete: false, version: '2.12.0', counts: { CRITICAL: 1, HIGH: 0, MEDIUM: 1, LOW: 0 },
    skills: [{ name: 'unknown', complete: false, coverage: 20.1, limitations: ['Analyzer x status: degraded.'], issues: [
      { id: 'TT3', severity: 'CRITICAL', pattern: 'Tainted flow', file: 'skills/birdeye-api/scripts/a.py', line: 87, explanation: 'key | to httpx' },
      { id: 'E1', severity: 'MEDIUM', pattern: 'External Transmission', file: 'skills/x/SKILL.md', line: 4 },
    ] }],
  },
  groups: [
    { id: 'TT3', title: 'Tainted flow', severity: 'CRITICAL', count: 40, fileCount: 26 },
    { id: 'E1', title: 'External Transmission', severity: 'MEDIUM', count: 120, fileCount: 60 },
  ],
  summary: {
    overview: 'Para one.\n\nPara two.', reading: 'review_first', readingReason: 'Mostly API calls.', model: 'claude-x',
    groups: [{ id: 'TT3', assessment: 'expected', explanation: 'API keys | sent to their own APIs.' }], nextSteps: ['Scan each skill separately.'],
  },
};

const out = reportMarkdown(scan);
assert.ok(out.startsWith('# Skill scan: https://github.com/agiprolabs/claude-trading-skills'));
assert.match(out, /SkillSpector verdict:\*\* Do not install \(score 100\/100\)/);
assert.match(out, /AI reading in context:\*\* Review first — Mostly API calls\./);
assert.match(out, /scan incomplete/);
assert.match(out, /## What the findings mean\n\nPara one\.\n\nPara two\./);
assert.match(out, /- Scan each skill separately\./);
assert.match(out, /\| TT3 \| Tainted flow \| CRITICAL \| 40 \| 26 \| Expected for its purpose: API keys \\\| sent to their own APIs\. \|/, 'pipes are escaped in the table');
assert.match(out, /\| E1 \| External Transmission \| MEDIUM \| 120 \| 60 \| not assessed \|/);
assert.match(out, /20\.1% covered/);
assert.match(out, /- \*\*CRITICAL\*\* TT3 Tainted flow — `skills\/birdeye-api\/scripts\/a\.py:87`: key \| to httpx/);
assert.ok(!reportMarkdown({ ...scan, summary: null }).includes('What the findings mean'), 'no explanation section without one');

const j = JSON.parse(reportJson(scan));
assert.equal(j.id, undefined);
assert.equal(j.userId, undefined);
assert.equal(j.report.score, 100);

assert.equal(exportName(scan), 'skill-scan-claude-trading-skills-2026-11-24');
assert.equal(exportName({ fileName: 'my plugin.zip', createdAt: '2026-11-20T00:00:00Z' }), 'skill-scan-my-plugin-2026-11-20');

console.log('exportReport.test.mjs: all passed');
