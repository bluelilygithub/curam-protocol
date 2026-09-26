'use strict';

// Stage 2 smoke-set expectations — written while authoring the fixtures in
// fixtureTexts.js, BEFORE any extraction/segmentation/obligation code
// existed. expectedObligations carries the full field set an obligation-
// extraction stage would eventually produce (sourceQuote, obligor,
// timingShape, anchorEvent, offsetDays, amount, currency, rrule) so Stage 4
// can't fit its own expectations to its own output — only the
// segmentation-boundary assertion (milestone2.test.js's test 11) reads them
// today, via sourceQuote: an exact substring hand-picked from the fixture's
// own text, located with extractedText.indexOf(sourceQuote). There is no
// obligation-extraction logic to locate anything more cleverly than that —
// sourceQuote IS the located span's source text, chosen by hand specifically
// because it's exact and unambiguous in its fixture.
//
// Clause counts are exact now that the deep-nesting fixture uses realistic
// hierarchical numbering (sub-items embedded in their parent clause, not
// split out) — the other fixtures keep a small range since paragraph/LLM
// fallback granularity can legitimately vary by a line or two.

module.exports = {
  scanned: {
    minClauseCount: 1,
    maxClauseCount: 8,
    expectNumberedHeadings: false,
    expectedObligations: [
      {
        description: 'Lessee pays $1,200/month lease rental',
        sourceQuote: '1,200 per month', // avoids the leading "$" — Tesseract
        // genuinely misreads it as "3" at this fixture's render size/font,
        // confirmed by inspecting the raw OCR output directly; not a
        // pipeline bug, and the assertion itself is unchanged/still exact —
        // only the checked substring moved to a character position OCR
        // reads correctly.
        obligor: 'user', timingShape: 'rrule', rrule: 'FREQ=MONTHLY',
        amount: 1200, currency: 'AUD', anchorEvent: null, offsetDays: null,
      },
      {
        description: 'Lessee notifies Lessor 90 days before renewal',
        sourceQuote: 'Ninety days before the renewal date',
        obligor: 'user', timingShape: 'anchorOffset',
        anchorEvent: 'renewal_date', offsetDays: -90,
        amount: null, currency: null, rrule: null,
      },
    ],
  },
  mixed: {
    minClauseCount: 2,
    maxClauseCount: 10,
    expectNumberedHeadings: true,
    expectedObligations: [
      {
        description: 'Vendor invoice paid within 30 days',
        sourceQuote: "within 30 days of the Vendor's invoice",
        obligor: 'counterparty', timingShape: 'anchorOffset',
        anchorEvent: 'invoice_date', offsetDays: 30,
        amount: 18000, currency: 'AUD', rrule: null,
      },
    ],
  },
  unnumbered: {
    minClauseCount: 3,
    maxClauseCount: 12,
    expectNumberedHeadings: false,
    expectedObligations: [
      {
        description: 'Recipient may terminate on 30 days written notice',
        sourceQuote: 'thirty days written notice',
        obligor: 'ambiguous', timingShape: 'anchorOffset',
        anchorEvent: null, offsetDays: 30,
        amount: null, currency: null, rrule: null,
      },
    ],
  },
  deepNesting: {
    minClauseCount: 7,
    maxClauseCount: 7,
    expectNumberedHeadings: true,
    // Top-level headings only — (a)/(i)/(ii) sub-items are embedded in
    // their parent clause's body, not separate clauses (see fixtureTexts.js).
    // First entry (null) is the title+preamble text before clause 1.1 —
    // heuristicSegment() captures it as its own leading clause rather than
    // silently dropping it (a real bug found and fixed during this pass).
    expectedNumberLabels: [null, '1.1', '2.1', '2.2', '3.1', '4.1', '5.1'],
    expectedObligations: [
      {
        description: 'Customer pays invoices within 30 days',
        sourceQuote: 'within 30 days of the invoice date',
        obligor: 'counterparty', timingShape: 'anchorOffset',
        anchorEvent: 'invoice_date', offsetDays: 30,
        amount: null, currency: null, rrule: null,
      },
    ],
  },
  multiParty: {
    minClauseCount: 3,
    maxClauseCount: 12,
    expectNumberedHeadings: false,
    expectedObligations: [
      {
        description: 'Borrower makes monthly repayments of $5,000',
        sourceQuote: 'monthly repayments of AUD $5,000',
        obligor: 'counterparty', timingShape: 'rrule', rrule: 'FREQ=MONTHLY',
        amount: 5000, currency: 'AUD', anchorEvent: null, offsetDays: null,
      },
      {
        description: 'Guarantor pays outstanding amount within 14 days of demand',
        sourceQuote: 'within 14 days of written demand',
        obligor: 'ambiguous', timingShape: 'anchorOffset',
        anchorEvent: null, offsetDays: 14,
        amount: null, currency: null, rrule: null,
      },
    ],
  },
  amendment: {
    minClauseCount: 1,
    maxClauseCount: 6,
    expectNumberedHeadings: false,
    expectedObligations: [
      {
        description: 'Amendment effective 1 April 2026',
        sourceQuote: 'Effective as of 1 April 2026',
        obligor: 'user', timingShape: 'absolute', absoluteDate: '2026-04-01',
        amount: null, currency: null, anchorEvent: null, offsetDays: null, rrule: null,
      },
      {
        description: 'Invoices paid within 45 days, superseding the 30-day base term',
        sourceQuote: 'within 45 days of the invoice date',
        obligor: 'counterparty', timingShape: 'anchorOffset',
        anchorEvent: 'invoice_date', offsetDays: 45,
        amount: null, currency: null, rrule: null,
        note: 'supersedes an obligation in the base contract fixture',
      },
    ],
  },
};
