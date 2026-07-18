#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  toPercent,
  parseIsoDurationMonths,
  normalizeMortgageProduct,
  selectRepresentativeProducts,
  classifySpecialPurpose,
} = require('./normalize');

const G = '\x1b[32m';
const R = '\x1b[31m';
const B = '\x1b[1m';
const X = '\x1b[0m';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`${G}✓${X} ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`${R}✗${X} ${name}`);
    console.log(`  ${err.message}`);
  }
}

test('toPercent converts CDR decimal rates', () => {
  assert.strictEqual(toPercent('0.0699'), 6.99);
  assert.strictEqual(toPercent(0.055), 5.5);
  assert.strictEqual(toPercent(5.5), 5.5);
});

test('parseIsoDurationMonths handles P5Y / P36M', () => {
  assert.strictEqual(parseIsoDurationMonths('P5Y'), 60);
  assert.strictEqual(parseIsoDurationMonths('P36M'), 36);
  assert.strictEqual(parseIsoDurationMonths('P1Y6M'), 18);
});

test('normalizeMortgageProduct maps CBA-like detail into Stage 6 schema', () => {
  const row = normalizeMortgageProduct({
    productId: 'abc',
    productCategory: 'RESIDENTIAL_MORTGAGES',
    name: 'Variable Rate Home Loan',
    brand: 'CBA',
    brandName: 'CommBank',
    description: 'OO variable',
    features: [
      { featureType: 'REDRAW' },
      { featureType: 'OFFSET' },
    ],
    fees: [
      {
        name: 'Settlement Fee',
        feeType: 'EVENT',
        feeMethodUType: 'fixedAmount',
        fixedAmount: { amount: '200.00' },
      },
      {
        name: 'Package Fee',
        feeType: 'PERIODIC',
        feeMethodUType: 'fixedAmount',
        fixedAmount: { amount: '395.00' },
        additionalValue: 'P1Y',
      },
    ],
    lendingRates: [
      {
        lendingRateType: 'VARIABLE',
        rate: '0.0604',
        comparisonRate: '0.0615',
        repaymentType: 'PRINCIPAL_AND_INTEREST',
        loanPurpose: 'OWNER_OCCUPIED',
      },
    ],
    eligibility: [{ eligibilityType: 'MIN_INCOME', additionalInfo: 'Income requirements apply' }],
    additionalInformation: {
      termsUri: 'https://example.com/terms.pdf',
      feesAndPricingUri: 'https://example.com/fees.pdf',
    },
    applicationUri: 'https://example.com/apply',
  }, { bankId: 'commbank', bankName: 'CommBank' });

  assert.ok(row);
  assert.strictEqual(row.rate, 6.04);
  assert.strictEqual(row.comparison_rate, 6.15);
  assert.strictEqual(row.fixed_or_variable, 'variable');
  assert.strictEqual(row.offset, true);
  assert.strictEqual(row.redraw, true);
  assert.strictEqual(row.upfront_fees, 200);
  assert.strictEqual(row.ongoing_annual_fees, 395);
  assert.strictEqual(row.source, 'cdr_prd');
  assert.strictEqual(row.stub, false);
  assert.strictEqual(row.fees_estimated, true);
  assert.strictEqual(row.special_eligibility, false);
  assert.ok(row.links.terms);
});

test('classifySpecialPurpose flags sustainable / defence / veterans; ignores self-employed', () => {
  const { classifySpecialPurpose } = require('./normalize');
  assert.strictEqual(
    classifySpecialPurpose('Sustainable Upgrades Home Loan').special_eligibility,
    true
  );
  assert.strictEqual(
    classifySpecialPurpose('NAB Defence Force Home Loan').special_eligibility,
    true
  );
  assert.strictEqual(
    classifySpecialPurpose('Flexi First Option Home Loan - Veterans').special_eligibility,
    true
  );
  assert.strictEqual(
    classifySpecialPurpose('Standard Variable Home Loan').special_eligibility,
    false
  );
  // Must not wipe UBank: eligibility text often says "self-employed"
  assert.strictEqual(
    classifySpecialPurpose(
      'Flex - Variable OO P&I',
      'Owner occupied variable',
      ['Available to self-employed and PAYG employees']
    ).special_eligibility,
    false
  );
});

test('selectRepresentativeProducts excludes special-eligibility by default', () => {
  const rows = [
    {
      bank_id: 'westpac',
      lender: 'Westpac',
      name: 'Sustainable Upgrades Home Loan',
      fixed_or_variable: 'variable',
      rate: 4.49,
      loan_purpose: 'OWNER_OCCUPIED',
      repayment_type: 'PRINCIPAL_AND_INTEREST',
      comparison_rate: 4.49,
      special_eligibility: true,
    },
    {
      bank_id: 'westpac',
      lender: 'Westpac',
      name: 'Flexi First Option',
      fixed_or_variable: 'variable',
      rate: 6.45,
      loan_purpose: 'OWNER_OCCUPIED',
      repayment_type: 'PRINCIPAL_AND_INTEREST',
      comparison_rate: 6.6,
      special_eligibility: false,
    },
    {
      bank_id: 'westpac',
      lender: 'Westpac',
      name: 'Fixed Rate Home Loan',
      fixed_or_variable: 'fixed',
      rate: 6.64,
      loan_purpose: 'OWNER_OCCUPIED',
      repayment_type: 'PRINCIPAL_AND_INTEREST',
      comparison_rate: 8.63,
      special_eligibility: false,
    },
    {
      bank_id: 'nab',
      lender: 'NAB',
      name: 'NAB Defence Force Home Loan',
      fixed_or_variable: 'variable',
      rate: 6.09,
      loan_purpose: 'OWNER_OCCUPIED',
      repayment_type: 'PRINCIPAL_AND_INTEREST',
      special_eligibility: true,
    },
  ];
  const picked = selectRepresentativeProducts(rows, 2);
  assert.ok(!picked.some((p) => /sustainable|defence/i.test(p.name)));
  assert.ok(picked.some((p) => p.name === 'Flexi First Option'));
  assert.ok(picked.some((p) => p.name === 'Fixed Rate Home Loan'));
  // NAB only had a special product → omit bank rather than show misleading defence rate
  assert.ok(!picked.some((p) => p.bank_id === 'nab'));
});

test('selectRepresentativeProducts prefers one variable + one fixed per bank', () => {
  const rows = [
    { bank_id: 'a', lender: 'A', fixed_or_variable: 'variable', rate: 6.1, loan_purpose: 'OWNER_OCCUPIED', repayment_type: 'PRINCIPAL_AND_INTEREST', comparison_rate: 6.2, special_eligibility: false },
    { bank_id: 'a', lender: 'A', fixed_or_variable: 'variable', rate: 6.5, loan_purpose: 'INVESTMENT', repayment_type: 'PRINCIPAL_AND_INTEREST', special_eligibility: false },
    { bank_id: 'a', lender: 'A', fixed_or_variable: 'fixed', rate: 5.9, loan_purpose: 'OWNER_OCCUPIED', repayment_type: 'PRINCIPAL_AND_INTEREST', comparison_rate: 6.0, special_eligibility: false },
    { bank_id: 'b', lender: 'B', fixed_or_variable: 'variable', rate: 5.8, loan_purpose: 'OWNER_OCCUPIED', repayment_type: 'PRINCIPAL_AND_INTEREST', special_eligibility: false },
  ];
  const picked = selectRepresentativeProducts(rows, 2);
  assert.strictEqual(picked.filter((p) => p.bank_id === 'a').length, 2);
  assert.ok(picked.some((p) => p.bank_id === 'a' && p.fixed_or_variable === 'variable' && p.rate === 6.1));
  assert.ok(picked.some((p) => p.bank_id === 'a' && p.fixed_or_variable === 'fixed'));
});

// GAP (Round 3 focus area #3): "bridging loan" style products were never explicitly
// tested for exclusion from the mainstream comparison table, despite being a short-term
// product type that would badly distort a headline-rate comparison if it slipped through.
test('classifySpecialPurpose excludes bridging loan products', () => {
  assert.strictEqual(
    classifySpecialPurpose('Residential Bridging Loan').special_eligibility,
    true
  );
  assert.strictEqual(
    classifySpecialPurpose('Bridge Finance Home Loan').special_eligibility,
    true
  );
  // Also reachable via eligibility text alone (title/description clean)
  assert.strictEqual(
    classifySpecialPurpose(
      'Flexi Variable Home Loan',
      'Owner occupied variable',
      ['Available as bridging finance for eligible customers']
    ).special_eligibility,
    true
  );
});

test('selectRepresentativeProducts excludes a bridging product from the comparison table', () => {
  const rows = [
    {
      bank_id: 'anz',
      lender: 'ANZ',
      name: 'ANZ Bridging Loan',
      fixed_or_variable: 'variable',
      rate: 8.5,
      loan_purpose: 'OWNER_OCCUPIED',
      repayment_type: 'PRINCIPAL_AND_INTEREST',
      special_eligibility: true,
    },
    {
      bank_id: 'anz',
      lender: 'ANZ',
      name: 'ANZ Standard Variable',
      fixed_or_variable: 'variable',
      rate: 6.2,
      loan_purpose: 'OWNER_OCCUPIED',
      repayment_type: 'PRINCIPAL_AND_INTEREST',
      comparison_rate: 6.3,
      special_eligibility: false,
    },
  ];
  const picked = selectRepresentativeProducts(rows, 2);
  assert.ok(!picked.some((p) => /bridging/i.test(p.name)));
  assert.ok(picked.some((p) => p.name === 'ANZ Standard Variable'));
});

// GAP (Round 3 focus area #3): a CDR product with a null/undefined rate must be entirely
// EXCLUDED from the normalized output (return null), never surfaced with rate: null or
// rate: NaN — either of those would silently break downstream comparison-table maths.
test('normalizeMortgageProduct excludes (returns null) a product whose chosen rate is null', () => {
  const row = normalizeMortgageProduct({
    productId: 'no_rate',
    productCategory: 'RESIDENTIAL_MORTGAGES',
    name: 'Mystery Rate Home Loan',
    lendingRates: [
      { lendingRateType: 'VARIABLE', rate: null, repaymentType: 'PRINCIPAL_AND_INTEREST', loanPurpose: 'OWNER_OCCUPIED' },
    ],
  }, { bankId: 'x', bankName: 'X' });
  assert.strictEqual(row, null);
});

test('normalizeMortgageProduct excludes a product when rate is undefined (field entirely missing)', () => {
  const row = normalizeMortgageProduct({
    productId: 'no_rate_2',
    productCategory: 'RESIDENTIAL_MORTGAGES',
    name: 'Undefined Rate Home Loan',
    lendingRates: [
      { lendingRateType: 'VARIABLE', repaymentType: 'PRINCIPAL_AND_INTEREST', loanPurpose: 'OWNER_OCCUPIED' },
    ],
  }, { bankId: 'x', bankName: 'X' });
  assert.strictEqual(row, null);
});

// GAP (Round 3 focus area #3): when lendingRates is empty or missing entirely, the product
// must be excluded (null) rather than falling back to any default rate value.
test('normalizeMortgageProduct excludes a product with empty lendingRates array', () => {
  const row = normalizeMortgageProduct({
    productId: 'empty_rates',
    productCategory: 'RESIDENTIAL_MORTGAGES',
    name: 'No Rates Listed Home Loan',
    lendingRates: [],
  }, { bankId: 'x', bankName: 'X' });
  assert.strictEqual(row, null);
});

test('normalizeMortgageProduct excludes a product missing the lendingRates field entirely', () => {
  const row = normalizeMortgageProduct({
    productId: 'missing_rates',
    productCategory: 'RESIDENTIAL_MORTGAGES',
    name: 'No Rates Field Home Loan',
  }, { bankId: 'x', bankName: 'X' });
  assert.strictEqual(row, null);
});

console.log(`\n${B}${passed} passed${X}, ${failed ? R : G}${failed} failed${X}`);
process.exit(failed ? 1 : 0);
