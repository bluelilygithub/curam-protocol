'use strict';

// Stage 2 smoke-set expectations — written while authoring the fixtures in
// fixtureTexts.js, BEFORE any extraction/segmentation/obligation code existed.
// expectedObligations exist now so Stage 4 can't fit its own expectations to
// its own output later; only the segmentation-boundary assertion (test 11 in
// milestone2.test.js) reads them today.
//
// Clause counts are ranges, not exact numbers — segmentation granularity can
// legitimately vary by a paragraph or two without being wrong; the exact-slice
// guardrail (test 9) is the assertion that actually matters for correctness.

module.exports = {
  scanned: {
    minClauseCount: 1,
    maxClauseCount: 8,
    expectNumberedHeadings: false,
    expectedObligations: [
      { description: 'Lessee pays $1,200/month lease rental', snippet: '1,200 per month', obligor: 'user', timingShape: 'rrule', note: 'snippet avoids the leading "$" — a confirmed OCR misread ($1,200 -> 31,200) at this render size/font, unrelated to any pipeline bug' },
      { description: 'Lessee notifies Lessor 90 days before renewal', snippet: 'Ninety days before the renewal date', obligor: 'user', timingShape: 'anchorOffset', anchorEvent: 'renewal_date', offsetDays: -90 },
    ],
  },
  mixed: {
    minClauseCount: 2,
    maxClauseCount: 10,
    expectNumberedHeadings: true,
    expectedObligations: [
      { description: "Vendor invoice paid within 30 days", snippet: "within 30 days of the Vendor's invoice", obligor: 'counterparty', timingShape: 'anchorOffset', anchorEvent: 'invoice_date', offsetDays: 30 },
    ],
  },
  unnumbered: {
    minClauseCount: 3,
    maxClauseCount: 12,
    expectNumberedHeadings: false,
    expectedObligations: [
      { description: 'Recipient may terminate on 30 days written notice', snippet: 'thirty days written notice', obligor: 'ambiguous', timingShape: 'anchorOffset', offsetDays: 30 },
    ],
  },
  deepNesting: {
    minClauseCount: 8,
    maxClauseCount: 20,
    expectNumberedHeadings: true,
    expectedNumberLabels: ['2.2(a)(i)', '2.2(a)(ii)', '4.1(a)(i)'],
    expectedObligations: [
      { description: 'Customer pays invoices within 30 days', snippet: 'within 30 days of the invoice date', obligor: 'counterparty', timingShape: 'anchorOffset', anchorEvent: 'invoice_date', offsetDays: 30 },
    ],
  },
  multiParty: {
    minClauseCount: 3,
    maxClauseCount: 12,
    expectNumberedHeadings: false,
    expectedObligations: [
      { description: 'Borrower makes monthly repayments of $5,000', snippet: 'monthly repayments of AUD $5,000', obligor: 'counterparty', timingShape: 'rrule' },
      { description: 'Guarantor pays outstanding amount within 14 days of demand', snippet: 'within 14 days of written demand', obligor: 'ambiguous', timingShape: 'anchorOffset', offsetDays: 14 },
    ],
  },
  amendment: {
    minClauseCount: 1,
    maxClauseCount: 6,
    expectNumberedHeadings: false,
    expectedObligations: [
      { description: 'Amendment effective 1 April 2026', snippet: 'Effective as of 1 April 2026', obligor: 'user', timingShape: 'absolute' },
      { description: 'Invoices paid within 45 days, superseding the 30-day base term', snippet: 'within 45 days of the invoice date', obligor: 'counterparty', timingShape: 'anchorOffset', offsetDays: 45, note: 'supersedes an obligation in the base contract fixture' },
    ],
  },
};
