#!/usr/bin/env node
'use strict';

/**
 * Live probe: fetch real CDR product docs and optionally ask one insight question.
 * Usage:
 *   node server/services/propertyScenario/insights/live.probe.js
 *   node server/services/propertyScenario/insights/live.probe.js --ask
 */

require('dotenv').config();

const { getLiveMortgageLenders } = require('../cdr');
const {
  fetchProductDocuments,
  buildInsight,
  INSIGHT_DISCLAIMER,
} = require('./index');

const wantAsk = process.argv.includes('--ask');

async function main() {
  console.log('Fetching live CDR lenders…');
  const live = await getLiveMortgageLenders({ forceRefresh: false });
  if (!live.ok || !(live.lenders || []).length) {
    console.error('No live lenders:', live.coverage?.summary);
    process.exit(1);
  }

  const withDocs = (live.lenders || []).filter(
    (l) => l.links?.terms || l.links?.fees || l.links?.overview
  );
  console.log(`Lenders with doc links: ${withDocs.length}/${live.lenders.length}`);

  const sample = withDocs.slice(0, 3);
  if (sample.length < 2) {
    console.error('Need at least 2 products with document links for live fetch probe');
    process.exit(1);
  }

  let okFetches = 0;
  for (const p of sample) {
    console.log(`\n→ ${p.lender} — ${p.name}`);
    console.log(`  terms: ${p.links.terms || '—'}`);
    // eslint-disable-next-line no-await-in-loop
    const pack = await fetchProductDocuments(p);
    if (pack.ok) {
      okFetches += 1;
      const doc = pack.documents.find((d) => d.ok);
      console.log(`  OK format=${doc.format} chars=${doc.char_count} pages=${doc.pages} cache=${doc.cache_hit}`);
      console.log(`  preview: ${String(doc.text).slice(0, 160).replace(/\s+/g, ' ')}…`);
    } else {
      console.log(`  FAIL: ${pack.message}`);
      (pack.documents || []).forEach((d) => {
        if (!d.ok) console.log(`    · ${d.kind}: ${d.message}`);
      });
    }
  }

  console.log(`\nLive document fetches OK: ${okFetches}/${sample.length}`);
  if (okFetches < 2) {
    console.error('Expected at least 2 successful real document fetches');
    process.exit(1);
  }

  if (wantAsk) {
    const product = sample.find((p) => true);
    // Prefer one that fetched OK
    let chosen = null;
    for (const p of sample) {
      // eslint-disable-next-line no-await-in-loop
      const pack = await fetchProductDocuments(p);
      if (pack.ok) {
        chosen = p;
        break;
      }
    }
    if (!chosen) {
      console.error('No product with successful doc fetch for --ask');
      process.exit(1);
    }
    console.log(`\nAsking insight on ${chosen.lender} — ${chosen.name}…`);
    const insight = await buildInsight({
      product: chosen,
      question: 'Can I make extra repayments or pay this loan off early, and are there fees or caps?',
    });
    console.log(JSON.stringify({
      ok: insight.ok,
      findings: insight.findings,
      uncited_gaps: insight.uncited_gaps,
      disclaimer: insight.disclaimer,
      error: insight.error,
      message: insight.message,
    }, null, 2));
    if (insight.disclaimer !== INSIGHT_DISCLAIMER) {
      console.error('Disclaimer mismatch');
      process.exit(1);
    }
  }

  console.log('\nLive probe passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
