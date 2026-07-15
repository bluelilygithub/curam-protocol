#!/usr/bin/env node
'use strict';

/**
 * Stage 11 — insights module tests:
 * - disclaimer text lock
 * - structural isolation from scenario / orchestrate / calc
 * - citation enforcement
 * - graceful document failure
 * - mocked Q&A (no live LLM required for unit pass)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  INSIGHT_DISCLAIMER,
  buildInsight,
  compareInsights,
  fetchDocument,
  clearDocumentCache,
} = require('./index');
const { enforceCitations } = require('./buildInsight');

const G = '\x1b[32m';
const R = '\x1b[31m';
const X = '\x1b[0m';

let passed = 0;
let failed = 0;

function test(name, fn) {
  const run = async () => {
    try {
      await fn();
      passed += 1;
      console.log(`${G}✓${X} ${name}`);
    } catch (err) {
      failed += 1;
      console.log(`${R}✗${X} ${name}`);
      console.log(`  ${err.stack || err.message}`);
    }
  };
  return run();
}

const FORBIDDEN_IMPORT_RE = /require\(['"](\.\.\/)+?(scenario|orchestrate|validate|clarify|runPipeline|parseScenario|grounding|presentation|wireApi)['"]\)|require\(['"](\.\.\/)*calc(\/|['"])/;

function collectJsFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectJsFiles(full));
    else if (ent.isFile() && ent.name.endsWith('.js') && !ent.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

const sampleProduct = {
  id: 'demo_bank_home_loan',
  product_id: 'P1',
  name: 'Demo Variable Home Loan',
  lender: 'DemoBank',
  rate: 5.89,
  offset: true,
  redraw: true,
  links: {
    terms: 'https://example.com/terms.pdf',
    fees: null,
    overview: null,
  },
};

async function main() {
  await test('disclaimer literal lock (BORROWING_POWER pattern)', async () => {
    assert.strictEqual(
      INSIGHT_DISCLAIMER,
      'AI-generated analysis of publicly available lender documents — not financial or legal advice, '
      + 'and not a substitute for confirming terms directly with the lender.'
    );
    const r = await buildInsight(
      { product: sampleProduct, question: 'anything' },
      {
        fetchProductDocuments: async () => ({
          ok: false,
          error: 'no_document_links',
          message: "Couldn't retrieve this document",
          documents: [],
        }),
      }
    );
    assert.strictEqual(r.disclaimer, INSIGHT_DISCLAIMER);
  });

  await test('structural isolation: zero import paths into scenario/orchestrate/calc', async () => {
    const root = __dirname;
    const files = collectJsFiles(root);
    assert.ok(files.length >= 4, 'expected insight module files');
    const offenders = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      // Also forbid relative requires that climb into calc/
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) return;
        if (FORBIDDEN_IMPORT_RE.test(line)) {
          offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
        }
        if (/require\(['"].*\/calc\//.test(line)) {
          offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
        }
        if (/require\(['"]\.\.\/scenario['"]\)/.test(line)
          || /require\(['"]\.\.\/orchestrate['"]\)/.test(line)) {
          offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    assert.deepStrictEqual(offenders, [], `Forbidden imports:\n${offenders.join('\n')}`);
  });

  await test('enforceCitations strips uncited claims', async () => {
    const { findings, uncited_gaps } = enforceCitations(
      [
        { claim: 'No early exit fee', source_quote_or_paraphrase: 'No early termination fee applies', document_section_or_location: 'Page 4' },
        { claim: 'Invented privilege', source_quote_or_paraphrase: '', document_section_or_location: null },
      ],
      []
    );
    assert.strictEqual(findings.length, 1);
    assert.ok(uncited_gaps.some((g) => /Uncited claim removed/i.test(g)));
  });

  await test('buildInsight: missing question → invalid_request with disclaimer', async () => {
    const r = await buildInsight({ product: sampleProduct, question: '  ' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'invalid_request');
    assert.strictEqual(r.disclaimer, INSIGHT_DISCLAIMER);
  });

  await test('buildInsight: document fetch failure is explicit, not empty analysis', async () => {
    const r = await buildInsight(
      { product: sampleProduct, question: 'Can I repay early?' },
      {
        fetchProductDocuments: async () => ({
          ok: false,
          product_id: sampleProduct.id,
          error: 'http_error',
          message: "Couldn't retrieve this document (HTTP 404)",
          documents: [{ ok: false, url: sampleProduct.links.terms, message: 'HTTP 404' }],
        }),
      }
    );
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /Couldn['']t retrieve/i);
    assert.deepStrictEqual(r.findings, []);
    assert.strictEqual(r.disclaimer, INSIGHT_DISCLAIMER);
  });

  await test('buildInsight: clear findable answer cites document (mocked LLM)', async () => {
    const r = await buildInsight(
      { product: sampleProduct, question: 'Can I pay this off early without penalty?' },
      {
        fetchProductDocuments: async () => ({
          ok: true,
          product_id: sampleProduct.id,
          product_name: sampleProduct.name,
          lender: sampleProduct.lender,
          documents: [{
            ok: true,
            kind: 'terms',
            url: sampleProduct.links.terms,
            format: 'pdf',
            pages: 2,
            text: '[Page 1]\nEarly repayment. You may repay the loan in full at any time. No early termination fee applies to variable rate home loans.\n[Page 2]\nOffset account interest is calculated daily.',
          }],
        }),
        callModel: async () => JSON.stringify({
          findings: [{
            claim: 'You may repay the variable home loan in full at any time with no early termination fee.',
            source_quote_or_paraphrase: 'You may repay the loan in full at any time. No early termination fee applies to variable rate home loans.',
            document_section_or_location: 'Page 1 — Early repayment',
          }],
          uncited_gaps: [],
        }),
      }
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.findings.length, 1);
    assert.match(r.findings[0].source_quote_or_paraphrase, /No early termination fee/i);
    assert.ok(r.findings[0].document_section_or_location);
    assert.strictEqual(r.disclaimer, INSIGHT_DISCLAIMER);
  });

  await test('buildInsight: unanswered topic → uncited_gaps, not invented fact', async () => {
    const r = await buildInsight(
      { product: sampleProduct, question: 'Does this work for irregular self-employed income?' },
      {
        fetchProductDocuments: async () => ({
          ok: true,
          product_id: sampleProduct.id,
          documents: [{
            ok: true,
            kind: 'terms',
            url: sampleProduct.links.terms,
            format: 'pdf',
            text: '[Page 1]\nThis document describes repayment timing and offset features only. It does not discuss borrower employment types.',
          }],
        }),
        callModel: async () => JSON.stringify({
          findings: [],
          uncited_gaps: [
            'Not addressed in the document I could access — employment / self-employed income eligibility is not discussed',
          ],
        }),
      }
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.findings.length, 0);
    assert.ok(r.uncited_gaps.some((g) => /not addressed/i.test(g)));
    // Must not invent a positive claim
    assert.ok(!r.findings.some((f) => /self-employed/i.test(f.claim)));
  });

  await test('compareInsights: surfaces disagreement rather than picking a winner', async () => {
    const a = { ...sampleProduct, id: 'bank_a', lender: 'BankA', links: { terms: 'https://a.example/t.pdf' } };
    const b = { ...sampleProduct, id: 'bank_b', lender: 'BankB', links: { terms: 'https://b.example/t.pdf' } };
    const r = await compareInsights(
      {
        products: [a, b],
        question: 'Which has no cap on extra repayments?',
      },
      {
        fetchProductDocuments: async (product) => ({
          ok: true,
          product_id: product.id,
          product_name: product.name,
          lender: product.lender,
          documents: [{
            ok: true,
            kind: 'terms',
            url: product.links.terms,
            format: 'pdf',
            text: product.id === 'bank_a'
              ? '[Page 3]\nUnlimited additional repayments permitted.'
              : '[Page 5]\nAdditional repayments capped at $20,000 per year without break costs.',
          }],
        }),
        callModel: async () => JSON.stringify({
          findings: [
            {
              claim: 'BankA states unlimited additional repayments are permitted.',
              source_quote_or_paraphrase: 'Unlimited additional repayments permitted.',
              document_section_or_location: 'Page 3',
              product_id: 'bank_a',
            },
            {
              claim: 'BankB caps additional repayments at $20,000 per year without break costs.',
              source_quote_or_paraphrase: 'Additional repayments capped at $20,000 per year without break costs.',
              document_section_or_location: 'Page 5',
              product_id: 'bank_b',
            },
          ],
          disagreements: [
            'BankA marketing/terms say unlimited extra repayments; BankB PDS caps at $20,000/year — documents disagree across products.',
          ],
          uncited_gaps: [],
        }),
      }
    );
    assert.strictEqual(r.ok, true);
    assert.ok(r.findings.length >= 2);
    assert.ok(r.disagreements.some((d) => /disagree/i.test(d)));
    assert.strictEqual(r.disclaimer, INSIGHT_DISCLAIMER);
  });

  await test('fetchDocument: invalid / empty URL fails clearly', async () => {
    clearDocumentCache();
    const r = await fetchDocument('');
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /Couldn['']t retrieve|No document/i);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
