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
//
// Stage 3 additions (contractType, parties, keyTerms, definitions,
// mustFlagClauses, mustNotFlagClauses) were written BEFORE any Stage 3/4
// analysis code existed, same discipline as the block above — chosen by hand
// from the fixture text and each fixture's actual playbook position
// (server/services/contractReview/playbooks.js), not fitted to model output
// after the fact. Every sourceQuote/quotedText below is an exact substring
// of the fixture's own text (verified against fixtureTexts.js directly), and
// deliberately avoids "$" in any fixture that goes through OCR (scanned,
// and the scanned exhibit portion of mixed) — Tesseract genuinely misreads
// that glyph at this fixture's render size (see the existing scanned
// expectedObligations note below); this is an OCR-imprecision workaround,
// not a loosened assertion. mustFlagClauses/mustNotFlagClauses riskLevel
// calls are chosen to match the ACTUAL playbook position text literally
// (e.g. the msa payment_terms playbook only calls out "materially shorter"
// than net-30 as risky, never "longer" — so a net-45 amendment clause is
// correctly mustNotFlag/standard here, not mustFlag, even though "longer
// payment terms" might look risky to a human skimming quickly).
//
// "isUser" marks which party a given fixture's review is run as by default.
// multiParty carries an additional "roleFlip" block — Stage 3's comparison
// script must run that fixture a second time as the Guarantor instead of
// the Lender and confirm the role-sensitive flags (the unconditional
// guarantee, and the 14-day demand-payment clause) invert from
// standard/mustNotFlag to risky/mustFlag, while the role-INVARIANT flags
// (the undefined-interest-rate repayment clause; the governing-law clause)
// do not change — a real role-flip test has to show sensitivity where it
// exists without falsely showing it everywhere.

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
    contractType: 'lease',
    parties: [
      { name: 'Coastal Warehousing Pty Ltd', role: 'landlord', isUser: false },
      { name: 'Orchard Freight Ltd', role: 'tenant', isUser: true },
    ],
    keyTerms: {
      effectiveDate: '2026-02-01',
      termLengthMonths: 36,
      governingLawCountry: null,
      governingLawRegion: null,
      contractValue: null,
      contractValueCurrency: null,
    },
    definitions: [
      { term: 'Lessor', quotedText: 'Coastal Warehousing Pty Ltd ("Lessor")' },
      { term: 'Lessee', quotedText: 'Orchard Freight Ltd ("Lessee")' },
    ],
    mustFlagClauses: [],
    mustNotFlagClauses: [
      { sourceQuote: 'due on the first day of each month', clauseType: 'payment_terms', riskLevel: 'standard' },
      { sourceQuote: 'Ninety days before the renewal date', clauseType: 'auto_renewal', riskLevel: 'standard' },
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
    contractType: 'sow',
    parties: [
      { name: 'Acme Robotics Pty Ltd', role: 'vendor', isUser: true },
      { name: 'Blue Horizon Consulting', role: 'customer', isUser: false },
    ],
    keyTerms: {
      effectiveDate: null,
      termLengthMonths: null,
      governingLawCountry: null,
      governingLawRegion: null,
      contractValue: 18000,
      contractValueCurrency: 'AUD',
    },
    definitions: [],
    mustFlagClauses: [],
    mustNotFlagClauses: [
      { sourceQuote: "Payment of AUD $18,000 is due within 30 days of the Vendor's invoice", clauseType: 'payment_terms', riskLevel: 'standard' },
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
    contractType: 'nda',
    parties: [
      { name: 'Acme Robotics Pty Ltd', role: 'other', roleRaw: 'Discloser', isUser: false },
      { name: 'Blue Horizon Consulting', role: 'other', roleRaw: 'Recipient', isUser: true },
    ],
    keyTerms: {
      effectiveDate: '2026-03-01',
      termLengthMonths: 24,
      governingLawCountry: 'AU',
      governingLawRegion: 'Queensland',
      contractValue: null,
      contractValueCurrency: null,
    },
    definitions: [
      { term: 'Discloser', quotedText: 'Acme Robotics Pty Ltd ("Discloser")' },
      { term: 'Recipient', quotedText: 'Blue Horizon Consulting ("Recipient")' },
    ],
    // One-sided confidentiality obligation (only the Recipient is bound —
    // the NDA's title says "mutual" but the operative clause never mirrors
    // an obligation onto the Discloser) is risky per the nda playbook's own
    // "one-sided obligations favouring the other party are risky" position,
    // for the user (Recipient), who carries the whole burden.
    mustFlagClauses: [
      { sourceQuote: 'not to disclose it to any third party without the', clauseType: 'confidentiality', riskLevel: 'risky' },
      // 2-year initial term + 3-year survival = 5 years total confidentiality
      // exposure, exceeding the nda playbook's stated 1-3 year standard range.
      { sourceQuote: 'shall survive for an additional three years', clauseType: 'termination', riskLevel: 'risky' },
    ],
    mustNotFlagClauses: [
      { sourceQuote: 'thirty days written notice to the other party', clauseType: 'termination', riskLevel: 'standard' },
      { sourceQuote: 'governed by the laws of Queensland, Australia', clauseType: 'governing_law', riskLevel: 'standard' },
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
    contractType: 'msa',
    parties: [
      { name: 'Acme Robotics Pty Ltd', role: 'vendor', isUser: true },
      { name: 'Blue Horizon Consulting Pty Ltd', role: 'customer', isUser: false },
    ],
    keyTerms: {
      effectiveDate: null,
      termLengthMonths: 12,
      governingLawCountry: null,
      governingLawRegion: null,
      contractValue: null,
      contractValueCurrency: null,
    },
    definitions: [
      { term: 'Party', quotedText: 'Acme Robotics Pty Ltd and Blue Horizon Consulting Pty Ltd (each a "Party")' },
      { term: 'Services', quotedText: '"Services" means the services described in Schedule A.' },
    ],
    // This fixture was authored for Stage 2's segmentation-boundary tests —
    // every substantive clause in it is genuinely mutual/symmetric with no
    // real risk axis, so there is nothing to correctly mustFlag here.
    mustFlagClauses: [],
    mustNotFlagClauses: [
      // Mutual cap at 12 months' fees matches the msa playbook's own
      // "cap of at least 12 months' fees is standard" position exactly.
      { sourceQuote: 'liability under this Agreement shall exceed the fees paid in the preceding twelve months', clauseType: 'limitation_of_liability', riskLevel: 'standard' },
      // Net-30 matches the msa playbook's "Net-30 payment terms are standard" exactly.
      { sourceQuote: 'The Customer shall pay all invoices within 30 days of the invoice date', clauseType: 'payment_terms', riskLevel: 'standard' },
      // Mutual, immediate-for-cause with a 14-day cure period — no playbook
      // position exists for termination under msa, but this is an
      // unambiguously symmetric, standard clause either way.
      { sourceQuote: 'Either party may terminate this Agreement immediately upon written notice if the other party:', clauseType: 'termination', riskLevel: 'standard' },
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
    contractType: 'loan',
    // Default run: user = Lender. Chosen (rather than Guarantor) as the
    // default specifically so the obligor values above (fixed during Stage
    // 2, before any role was assigned) stay correct without editing them —
    // both obligations are genuinely non-Lender obligations from the
    // Lender's own point of view. The Guarantor's own risk profile is
    // covered instead, deliberately, by the roleFlip block below.
    parties: [
      { name: 'Northbridge Finance Ltd', role: 'lender', isUser: true },
      { name: 'Harbor Trading Co Pty Ltd', role: 'borrower', isUser: false },
      { name: 'Janet Ellery', role: 'guarantor', isUser: false },
    ],
    keyTerms: {
      effectiveDate: null,
      termLengthMonths: null,
      governingLawCountry: 'AU',
      governingLawRegion: 'New South Wales',
      contractValue: 250000,
      contractValueCurrency: 'AUD',
    },
    definitions: [],
    mustFlagClauses: [
      // No interest rate is stated anywhere on the loan facility — the loan
      // playbook's own position ("a clear repayment schedule AND interest
      // rate is standard; ... undefined rates ... are risky") makes this
      // risky regardless of which party is the user — a role-INVARIANT
      // flag, unlike the two below.
      { sourceQuote: 'monthly repayments of AUD $5,000', clauseType: 'payment_terms', riskLevel: 'risky' },
    ],
    mustNotFlagClauses: [
      // Favourable to the Lender by construction — an unconditional
      // guarantee and a short demand-payment window both benefit the party
      // being repaid, not the party bearing the obligation.
      { sourceQuote: 'The Guarantor unconditionally guarantees', clauseType: 'indemnity', riskLevel: 'standard' },
      { sourceQuote: 'within 14 days of written demand', clauseType: 'payment_terms', riskLevel: 'standard' },
      { sourceQuote: 'governed by the laws of New South Wales', clauseType: 'governing_law', riskLevel: 'standard' },
    ],
    // Re-run this fixture with the Guarantor confirmed as the user instead
    // of the Lender. The two role-sensitive clauses above must invert;
    // the undefined-interest-rate clause and the governing-law clause must
    // NOT change, since neither position depends on which party is the user.
    roleFlip: {
      userPartyName: 'Janet Ellery',
      userRole: 'guarantor',
      mustFlagClauses: [
        { sourceQuote: 'The Guarantor unconditionally guarantees', clauseType: 'indemnity', riskLevel: 'risky' },
        { sourceQuote: 'within 14 days of written demand', clauseType: 'payment_terms', riskLevel: 'risky' },
        { sourceQuote: 'monthly repayments of AUD $5,000', clauseType: 'payment_terms', riskLevel: 'risky' },
      ],
      mustNotFlagClauses: [
        { sourceQuote: 'governed by the laws of New South Wales', clauseType: 'governing_law', riskLevel: 'standard' },
      ],
    },
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
    // An amendment to an MSA is still detected as its underlying contract
    // type, not a distinct "amendment" type — there is no such CONTRACT_TYPE_KEYS
    // value, matching the base-agreement's own detected type (deepNesting).
    contractType: 'msa',
    parties: [
      { name: 'Acme Robotics Pty Ltd', role: 'vendor', isUser: true },
      { name: 'Blue Horizon Consulting', role: 'customer', isUser: false },
    ],
    keyTerms: {
      effectiveDate: '2026-04-01',
      termLengthMonths: null,
      governingLawCountry: null,
      governingLawRegion: null,
      contractValue: null,
      contractValueCurrency: null,
    },
    definitions: [
      { term: 'Base Agreement', quotedText: 'Blue Horizon Consulting (the "Base Agreement")' },
    ],
    // Net-45 is LONGER than net-30, not shorter — the msa payment_terms
    // playbook position only calls out "materially shorter" terms as risky,
    // never longer ones, so this is correctly mustNotFlag/standard even
    // though slower payment might look risky to a human skimming quickly.
    mustFlagClauses: [],
    mustNotFlagClauses: [
      { sourceQuote: 'within 45 days of the invoice date', clauseType: 'payment_terms', riskLevel: 'standard' },
    ],
  },
};
