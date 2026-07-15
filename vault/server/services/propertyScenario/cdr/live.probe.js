#!/usr/bin/env node
/**
 * Live CDR PRD multi-bank probe (network required).
 * Run: node server/services/propertyScenario/cdr/live.probe.js
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const { getLiveMortgageLenders, clearCdrCache } = require('./mortgageService');

async function main() {
  clearCdrCache();
  console.log('Fetching CDR residential mortgages from configured banks…\n');
  const started = Date.now();
  const live = await getLiveMortgageLenders({ forceRefresh: true });
  const ms = Date.now() - started;

  console.log(`Done in ${ms}ms`);
  console.log(live.coverage?.summary || '(no summary)');
  console.log('');

  (live.coverage?.per_bank || []).forEach((b) => {
    const mark = b.ok ? '✓' : '✗';
    console.log(
      `${mark} ${b.bank_name.padEnd(12)} list=${b.list_ok ? 'ok' : 'fail'} `
      + `products=${b.product_list_count} details_ok=${b.detail_ok_count} `
      + `normalized=${b.normalized_count} ${b.duration_ms}ms`
    );
    if (b.issues?.length) {
      b.issues.slice(0, 3).forEach((i) => console.log(`    · ${i}`));
      if (b.issues.length > 3) console.log(`    · … +${b.issues.length - 3} more`);
    }
  });

  console.log(`\nRepresentative products for UI (${live.lenders?.length || 0}):`);
  (live.lenders || []).forEach((l) => {
    console.log(
      `  · ${l.lender} — ${l.name}: ${l.rate}%`
      + (l.comparison_rate != null ? ` (comp ${l.comparison_rate}%)` : '')
      + ` ${l.fixed_or_variable}`
      + (l.offset ? ' offset' : '')
      + (l.redraw ? ' redraw' : '')
    );
  });

  process.exit(live.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
