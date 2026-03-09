#!/usr/bin/env node
/**
 * Gmail NLP Query Translator — Evaluation Harness
 * Run with:  node vault/server/services/gmailNLP.test.js
 *
 * Calls the real Claude API for each test. Requires ANTHROPIC_API_KEY.
 * All tests use today = 2025-03-09 (a Sunday) for deterministic date assertions.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { translateToGmailQuery } = require('./gmailNLP');

// ─── ANSI colours ────────────────────────────────────────────────────────────
const G  = '\x1b[32m';  // green
const R  = '\x1b[31m';  // red
const Y  = '\x1b[33m';  // yellow
const C  = '\x1b[36m';  // cyan
const M  = '\x1b[35m';  // magenta
const DIM = '\x1b[2m';
const B  = '\x1b[1m';
const X  = '\x1b[0m';   // reset

// ─── Pre-computed dates for today = 2025-03-09 (Sunday) ──────────────────────
// today:           2025/03/09
// yesterday:       2025/03/08
// thisWeekMonday:  2025/03/03   (Mon 3 Mar → Sun 9 Mar)
// lastWeekMonday:  2025/02/24
// thisMonthStart:  2025/03/01
// lastMonthStart:  2025/02/01
// thisMonthEnd:    2025/03/01   (exclusive)
// thisYearStart:   2025/01/01
// lastYearStart:   2024/01/01
// lastYearEnd:     2025/01/01
// ago7:            2025/03/02
// ago14:           2025/02/23
// ago30:           2025/02/07
// thisQStart:      2025/01/01   (Q1 2025)
// lastQStart:      2024/10/01   (Q4 2024)
// lastQEnd:        2025/01/01
// currentFYStart:  2024/07/01   (month=2 < 6, so FY started last July)
// currentFYEnd:    2025/07/01
// lastFYStart:     2023/07/01
// lastFYEnd:       2024/07/01

// ─── Test cases ──────────────────────────────────────────────────────────────
// expected.contains  : ALL these strings must appear in gmailQuery (case-insensitive)
// expected.intent    : exact match  (omit to skip)
// expected.responseMode : exact match  (omit to skip)

const TESTS = [

  // ── Direction (5 tests) ──────────────────────────────────────────────────
  {
    id: 1, category: 'Direction',
    input: 'emails from sarah',
    today: '2025-03-09',
    expected: { contains: ['from:', 'sarah'] },
  },
  {
    id: 2, category: 'Direction',
    input: 'emails I sent to john@example.com',
    today: '2025-03-09',
    expected: { contains: ['to:', 'john'] },
  },
  {
    id: 3, category: 'Direction',
    input: 'correspondence with westpac',
    today: '2025-03-09',
    expected: { contains: ['westpac', 'from:', 'to:'] },
  },
  {
    id: 4, category: 'Direction',
    input: 'did I reply to Lisa Andrews last week',
    today: '2025-03-09',
    expected: { contains: ['to:', 'lisa', 'after:2025/02/24'] },
  },
  {
    id: 5, category: 'Direction',
    input: 'has anyone from Acme contacted me recently',
    today: '2025-03-09',
    expected: { contains: ['from:', 'acme', 'after:2025/02/23'] },
  },

  // ── Name Resolution (5 tests) ────────────────────────────────────────────
  {
    id: 6, category: 'Name Resolution',
    input: 'emails from Joy Maddock',
    today: '2025-03-09',
    expected: { contains: ['from:', 'joy', 'maddock'] },
  },
  {
    id: 7, category: 'Name Resolution',
    input: 'emails from Joy',
    today: '2025-03-09',
    expected: { contains: ['from:', 'joy'] },
  },
  {
    id: 8, category: 'Name Resolution',
    input: 'emails from motorcare.com.au',
    today: '2025-03-09',
    expected: { contains: ['from:', 'motorcare'] },
  },
  {
    id: 9, category: 'Name Resolution',
    input: 'emails from my accountant',
    today: '2025-03-09',
    expected: { contains: ['from:', 'accountant'] },
  },
  {
    id: 10, category: 'Name Resolution',
    input: 'emails from joy maddocks',   // misspelling — extra s
    today: '2025-03-09',
    expected: { contains: ['from:', 'maddock'] },  // should correct spelling
  },

  // ── Time Ranges (8 tests) ────────────────────────────────────────────────
  {
    id: 11, category: 'Time Range',
    input: 'emails today',
    today: '2025-03-09',
    expected: { contains: ['after:2025/03/09'] },
  },
  {
    id: 12, category: 'Time Range',
    input: 'emails yesterday',
    today: '2025-03-09',
    expected: { contains: ['after:2025/03/08', 'before:2025/03/09'] },
  },
  {
    id: 13, category: 'Time Range',
    input: 'emails this week',
    today: '2025-03-09',
    expected: { contains: ['after:2025/03/03'] },
  },
  {
    id: 14, category: 'Time Range',
    input: 'emails last week',
    today: '2025-03-09',
    expected: { contains: ['after:2025/02/24', 'before:2025/03/03'] },
  },
  {
    id: 15, category: 'Time Range',
    input: 'emails this month',
    today: '2025-03-09',
    expected: { contains: ['after:2025/03/01'] },
  },
  {
    id: 16, category: 'Time Range',
    input: 'emails last month',
    today: '2025-03-09',
    expected: { contains: ['after:2025/02/01', 'before:2025/03/01'] },
  },
  {
    id: 17, category: 'Time Range',
    input: 'emails this year',
    today: '2025-03-09',
    expected: { contains: ['after:2025/01/01'] },
  },
  {
    id: 18, category: 'Time Range',
    input: 'emails from the last 30 days',
    today: '2025-03-09',
    expected: { contains: ['after:2025/02/07'] },
  },

  // ── Content Keywords (5 tests) ───────────────────────────────────────────
  {
    id: 19, category: 'Content Keywords',
    input: 'unread invoices from last week',
    today: '2025-03-09',
    expected: { contains: ['is:unread', 'invoice', 'after:2025/02/24', 'before:2025/03/03'] },
  },
  {
    id: 20, category: 'Content Keywords',
    input: 'contracts received this month',
    today: '2025-03-09',
    expected: { contains: ['contract', 'after:2025/03/01'] },
  },
  {
    id: 21, category: 'Content Keywords',
    input: 'quotes from suppliers this year',
    today: '2025-03-09',
    expected: { contains: ['quote', 'after:2025/01/01'] },
  },
  {
    id: 22, category: 'Content Keywords',
    input: 'purchase orders from last month',
    today: '2025-03-09',
    expected: { contains: ['purchase', 'after:2025/02/01', 'before:2025/03/01'] },
  },
  {
    id: 23, category: 'Content Keywords',
    input: 'meeting requests this week',
    today: '2025-03-09',
    expected: { contains: ['meeting', 'after:2025/03/03'] },
  },

  // ── Attachments (3 tests) ────────────────────────────────────────────────
  {
    id: 24, category: 'Attachments',
    input: 'emails with attachments from this week',
    today: '2025-03-09',
    expected: { contains: ['has:attachment', 'after:2025/03/03'] },
  },
  {
    id: 25, category: 'Attachments',
    input: 'PDFs from my accountant',
    today: '2025-03-09',
    expected: { contains: ['has:attachment', 'pdf', 'accountant'] },
  },
  {
    id: 26, category: 'Attachments',
    input: 'emails with spreadsheets last month',
    today: '2025-03-09',
    expected: { contains: ['has:attachment', 'after:2025/02/01', 'before:2025/03/01'] },
  },

  // ── Status (3 tests) ─────────────────────────────────────────────────────
  {
    id: 27, category: 'Status',
    input: 'unread emails',
    today: '2025-03-09',
    expected: { contains: ['is:unread'], intent: 'list' },
  },
  {
    id: 28, category: 'Status',
    input: 'starred emails from this week',
    today: '2025-03-09',
    expected: { contains: ['is:starred', 'after:2025/03/03'] },
  },
  {
    id: 29, category: 'Status',
    input: 'important emails about the westgate project',
    today: '2025-03-09',
    expected: { contains: ['is:important', 'westgate'] },
  },

  // ── Count Intent (4 tests) ───────────────────────────────────────────────
  {
    id: 30, category: 'Count Intent',
    input: 'how many times has Libby Barrett emailed me this month',
    today: '2025-03-09',
    expected: { contains: ['from:', 'libby', 'barrett', 'after:2025/03/01'], intent: 'count', responseMode: 'count' },
  },
  {
    id: 31, category: 'Count Intent',
    input: 'how many unread emails do I have',
    today: '2025-03-09',
    expected: { contains: ['is:unread'], intent: 'count', responseMode: 'count' },
  },
  {
    id: 32, category: 'Count Intent',
    input: 'how often does westpac email me this year',
    today: '2025-03-09',
    expected: { contains: ['westpac', 'after:2025/01/01'], intent: 'count', responseMode: 'count' },
  },
  {
    id: 33, category: 'Count Intent',
    input: 'number of invoices received this year',
    today: '2025-03-09',
    expected: { contains: ['invoice', 'after:2025/01/01'], intent: 'count' },
  },

  // ── Extract / Table Intent (3 tests) ─────────────────────────────────────
  {
    id: 34, category: 'Extract Intent',
    input: 'extract all invoice amounts from Acme Corp this month',
    today: '2025-03-09',
    expected: { contains: ['acme', 'invoice', 'after:2025/03/01'], responseMode: 'table' },
  },
  {
    id: 35, category: 'Extract Intent',
    input: 'give me a table of all emails from Sarah this year',
    today: '2025-03-09',
    expected: { contains: ['from:', 'sarah', 'after:2025/01/01'], responseMode: 'table' },
  },
  {
    id: 36, category: 'Extract Intent',
    input: 'list all the quotes I received last quarter',
    today: '2025-03-09',
    expected: { contains: ['quote', 'after:2024/10/01', 'before:2025/01/01'], responseMode: 'table' },
  },

  // ── Summary / Prose Intent (3 tests) ─────────────────────────────────────
  {
    id: 37, category: 'Summary Intent',
    input: 'what has joy maddocks been emailing me about lately',
    today: '2025-03-09',
    expected: { contains: ['from:', 'joy', 'after:2025/02/23'], responseMode: 'prose' },
  },
  {
    id: 38, category: 'Summary Intent',
    input: 'catch me up on emails from the ATO',
    today: '2025-03-09',
    expected: { contains: ['from:', 'ato'], responseMode: 'prose' },
  },
  {
    id: 39, category: 'Summary Intent',
    input: 'summary of emails about the westgate project this month',
    today: '2025-03-09',
    expected: { contains: ['westgate', 'after:2025/03/01'], responseMode: 'prose' },
  },

  // ── Thread Intent (2 tests) ───────────────────────────────────────────────
  {
    id: 40, category: 'Thread Intent',
    input: 'conversation with Sarah about the contract',
    today: '2025-03-09',
    expected: { contains: ['sarah', 'contract'], intent: 'thread' },
  },

  // ── Complex / Combined (5 bonus tests, ids 41-45) ────────────────────────
  {
    id: 41, category: 'Combined',
    input: 'unread invoices with attachments from last month',
    today: '2025-03-09',
    expected: { contains: ['is:unread', 'invoice', 'has:attachment', 'after:2025/02/01', 'before:2025/03/01'] },
  },
  {
    id: 42, category: 'Combined',
    input: 'emails I sent to motorcare this year',
    today: '2025-03-09',
    expected: { contains: ['to:', 'motorcare', 'after:2025/01/01'] },
  },
  {
    id: 43, category: 'Combined',
    input: 'emails from westgate project team this quarter',
    today: '2025-03-09',
    expected: { contains: ['westgate', 'after:2025/01/01'] },
  },
  {
    id: 44, category: 'Combined',
    input: 'attachments from Acme in the last financial year',
    today: '2025-03-09',
    expected: { contains: ['has:attachment', 'acme', 'after:2023/07/01', 'before:2024/07/01'] },
  },
  {
    id: 45, category: 'Combined',
    input: 'did I send the contract to Sarah last week',
    today: '2025-03-09',
    expected: { contains: ['to:', 'sarah', 'contract', 'after:2025/02/24'] },
  },
];

// ─── Evaluation logic ─────────────────────────────────────────────────────────

function evaluateResult(actual, expected) {
  const issues = [];
  let points = 0;
  let maxPoints = 0;

  // 1. Query fragment checks (each fragment worth 1 point)
  if (expected.contains && expected.contains.length > 0) {
    const query = (actual.gmailQuery || '').toLowerCase();
    for (const fragment of expected.contains) {
      maxPoints++;
      if (query.includes(fragment.toLowerCase())) {
        points++;
      } else {
        issues.push(`query missing "${fragment}"`);
      }
    }
  }

  // 2. intent (worth 1 point)
  if (expected.intent !== undefined) {
    maxPoints++;
    if (actual.intent === expected.intent) {
      points++;
    } else {
      issues.push(`intent: expected "${expected.intent}", got "${actual.intent}"`);
    }
  }

  // 3. responseMode (worth 1 point)
  if (expected.responseMode !== undefined) {
    maxPoints++;
    if (actual.responseMode === expected.responseMode) {
      points++;
    } else {
      issues.push(`responseMode: expected "${expected.responseMode}", got "${actual.responseMode}"`);
    }
  }

  const passed = issues.length === 0;
  const score  = maxPoints > 0 ? points / maxPoints : 1;
  return { passed, points, maxPoints, score, issues };
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runTest(test) {
  try {
    const result = await translateToGmailQuery(test.input, test.today);
    const evaluation = evaluateResult(result, test.expected);
    return { test, result, evaluation, error: null };
  } catch (err) {
    const evaluation = { passed: false, points: 0, maxPoints: 1, score: 0, issues: [`threw: ${err.message}`] };
    return { test, result: null, evaluation, error: err.message };
  }
}

function pad(n, width) { return String(n).padStart(width, ' '); }

function printResult(run) {
  const { test, result, evaluation } = run;
  const icon   = evaluation.passed ? `${G}✅ PASS${X}` : `${R}✗  FAIL${X}`;
  const pct    = evaluation.maxPoints > 0
    ? `${evaluation.points}/${evaluation.maxPoints}`
    : '—';

  console.log(`\n${B}[${pad(test.id, 2)}/45]${X} ${DIM}${test.category}${X}`);
  console.log(`  ${C}Input:${X}  ${test.input}`);
  if (result) {
    console.log(`  ${C}Query:${X}  ${result.gmailQuery}`);
    console.log(`  ${DIM}intent=${result.intent}  responseMode=${result.responseMode}  maxResults=${result.maxResults}${X}`);
  }
  console.log(`  ${icon}  (${pct} criteria met)`);
  if (!evaluation.passed) {
    for (const issue of evaluation.issues) {
      console.log(`  ${Y}  ⚠  ${issue}${X}`);
    }
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(`${R}${B}ERROR: ANTHROPIC_API_KEY not set. Check your .env file.${X}`);
    process.exit(1);
  }

  const totalTests = TESTS.length;
  console.log(`\n${B}${M}═══════════════════════════════════════════════════════${X}`);
  console.log(`${B}${M}  Gmail NLP Translator — Evaluation Harness${X}`);
  console.log(`${B}${M}  ${totalTests} tests · today = 2025-03-09 (Sunday)${X}`);
  console.log(`${B}${M}═══════════════════════════════════════════════════════${X}\n`);

  const runs = [];
  const categoryStats = {};
  let totalPoints = 0;
  let totalMaxPoints = 0;

  for (let i = 0; i < TESTS.length; i++) {
    const test = TESTS[i];
    process.stdout.write(`  ${DIM}Running ${pad(i + 1, 2)}/${totalTests}…${X}\r`);

    const run = await runTest(test);
    runs.push(run);

    totalPoints    += run.evaluation.points;
    totalMaxPoints += run.evaluation.maxPoints;

    if (!categoryStats[test.category]) {
      categoryStats[test.category] = { passed: 0, total: 0, points: 0, maxPoints: 0 };
    }
    const cs = categoryStats[test.category];
    cs.total++;
    cs.points    += run.evaluation.points;
    cs.maxPoints += run.evaluation.maxPoints;
    if (run.evaluation.passed) cs.passed++;

    printResult(run);

    // Small delay to avoid rate limiting
    if (i < TESTS.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const passed     = runs.filter(r => r.evaluation.passed).length;
  const pctPassed  = ((passed / totalTests) * 100).toFixed(1);
  const pctScore   = totalMaxPoints > 0 ? ((totalPoints / totalMaxPoints) * 100).toFixed(1) : '100.0';

  console.log(`\n${B}${M}═══════════════════════════════════════════════════════${X}`);
  console.log(`${B}  RESULTS: ${passed}/${totalTests} tests passed (${pctPassed}%)${X}`);
  console.log(`${B}  SCORE:   ${totalPoints}/${totalMaxPoints} criteria met (${pctScore}%)${X}`);
  console.log(`${B}${M}═══════════════════════════════════════════════════════${X}\n`);

  // Per-category breakdown
  console.log(`${B}By category:${X}`);
  const catWidth = Math.max(...Object.keys(categoryStats).map(k => k.length));
  for (const [cat, cs] of Object.entries(categoryStats)) {
    const catPct  = cs.maxPoints > 0 ? ((cs.points / cs.maxPoints) * 100).toFixed(0) : '100';
    const colour  = cs.passed === cs.total ? G : cs.passed === 0 ? R : Y;
    const bar     = `${cs.passed}/${cs.total} tests, ${cs.points}/${cs.maxPoints} pts`;
    console.log(`  ${colour}${cat.padEnd(catWidth)}${X}  ${colour}${bar}  (${catPct}%)${X}`);
  }

  // Failed tests summary
  const failed = runs.filter(r => !r.evaluation.passed);
  if (failed.length > 0) {
    console.log(`\n${B}${R}Failed tests:${X}`);
    for (const run of failed) {
      console.log(`  ${R}[${pad(run.test.id, 2)}]${X} ${run.test.input}`);
      for (const issue of run.evaluation.issues) {
        console.log(`       ${Y}${issue}${X}`);
      }
    }
  } else {
    console.log(`\n${G}${B}All tests passed! 🎉${X}`);
  }

  console.log('');
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`${R}Fatal error:${X}`, err);
  process.exit(1);
});
