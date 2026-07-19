/**
 * Static editorial profiles for the Australian lenders covered by our CDR integration.
 * These describe product characteristics and target borrower profiles — not rates.
 * Rates are fetched live via the CDR refinance comparison.
 *
 * Last reviewed: July 2026. Product details change frequently — always direct users
 * to the lender or a licensed broker for current terms.
 */

export const LENDER_PROFILES = [
  {
    id: 'commbank',
    name: 'Commonwealth Bank',
    shortName: 'CommBank',
    type: 'Major bank (Big 4)',
    serviceModel: 'Branch + digital',
    website: 'https://www.commbank.com.au/home-loans.html',
    offsetAvailable: true,
    redraw: true,
    extraRepayments: true,
    annualFee: '$0 (basic) · $395/yr Wealth Package (includes offset + rate discount)',
    bestFor: [
      'First home buyers',
      'Branch access important',
      'Wealth Package bundlers',
    ],
    restrictions: [],
    summary:
      "Australia's largest lender with the widest branch network. Extra Home Loan is a fee-free variable with redraw. Wealth Package adds a 100% offset account and rate discount for a $395/yr fee. Strong digital app (CommBank app / NetBank).",
  },
  {
    id: 'westpac',
    name: 'Westpac',
    shortName: 'Westpac',
    type: 'Major bank (Big 4)',
    serviceModel: 'Branch + digital',
    website: 'https://www.westpac.com.au/personal-banking/home-loans/',
    offsetAvailable: true,
    redraw: true,
    extraRepayments: true,
    annualFee: '$0 (Flexi First) · $395/yr Premier Advantage Package (offset + discount)',
    bestFor: [
      'Owner-occupiers wanting a Big 4',
      'Customers who also bank with St.George / BoM / BankSA',
    ],
    restrictions: [],
    summary:
      'Flexi First Option is a no-frills variable with redraw and no annual fee. Premier Advantage Package adds a 100% offset and rate discount. Westpac Group also includes St.George, Bank of Melbourne, and BankSA — policies can differ between brands.',
  },
  {
    id: 'anz',
    name: 'ANZ',
    shortName: 'ANZ',
    type: 'Major bank (Big 4)',
    serviceModel: 'Branch + digital (ANZ Plus)',
    website: 'https://www.anz.com.au/personal/home-loans/',
    offsetAvailable: true,
    redraw: true,
    extraRepayments: true,
    annualFee: '$0 (Simplicity PLUS) · $395/yr Breakfree Package (offset + discount)',
    bestFor: [
      'Digital-first borrowers (ANZ Plus)',
      'Those wanting a Breakfree package discount',
    ],
    restrictions: [],
    summary:
      'Simplicity PLUS is a competitive fee-free variable with redraw. ANZ Plus is a separate digital-only product with higher ongoing rate but no annual fee and a savings account that works like an offset. Breakfree Package adds offset and rate discount.',
  },
  {
    id: 'nab',
    name: 'NAB',
    shortName: 'NAB',
    type: 'Major bank (Big 4)',
    serviceModel: 'Branch + digital',
    website: 'https://www.nab.com.au/personal/home-loans',
    offsetAvailable: true,
    redraw: true,
    extraRepayments: true,
    annualFee: '$0 (Base Variable) · $395/yr Choice Package (offset + discount)',
    bestFor: [
      'Medical professionals (NAB MedPlus)',
      'Those wanting a strong broker network',
    ],
    restrictions: [],
    summary:
      'Base Variable Rate is NAB\'s competitive fee-free option with redraw. Choice Package adds a 100% offset and rate discount for $395/yr. MedPlus offers specific lending conditions for eligible medical practitioners. Strong mortgage broker distribution.',
  },
  {
    id: 'ing',
    name: 'ING',
    shortName: 'ING',
    type: 'Online bank',
    serviceModel: 'Digital + phone (no branches)',
    website: 'https://www.ing.com.au/home-loans.html',
    offsetAvailable: true,
    redraw: true,
    extraRepayments: true,
    annualFee: '$0',
    bestFor: [
      'Rate-focused borrowers',
      'Digital-only banking comfortable',
      'Existing ING Orange Everyday customers',
    ],
    restrictions: [
      'No physical branches — all servicing online or by phone',
    ],
    summary:
      'Dutch-owned online bank consistently competitive on rate. Orange Advantage includes a 100% offset account at no annual fee. All servicing is digital and phone-based — no branch network. Works well for existing ING banking customers.',
  },
  {
    id: 'macquarie',
    name: 'Macquarie Bank',
    shortName: 'Macquarie',
    type: 'Specialist bank',
    serviceModel: 'Digital + broker (primarily)',
    website: 'https://www.macquarie.com.au/home-loans.html',
    offsetAvailable: true,
    redraw: true,
    extraRepayments: true,
    annualFee: '$0',
    bestFor: [
      'Self-employed borrowers',
      'Investors',
      'Complex income structures',
    ],
    restrictions: [
      'Primarily broker-only — limited direct application',
    ],
    summary:
      'Competitive variable rates with a 100% offset account. Known for more flexible policy on self-employed and investment lending compared to the Big 4. Generally available through mortgage brokers rather than direct applications.',
  },
  {
    id: 'ubank',
    name: 'UBank',
    shortName: 'UBank',
    type: 'Online bank (NAB subsidiary)',
    serviceModel: 'Digital + phone (no branches)',
    website: 'https://www.ubank.com.au/home-loans',
    offsetAvailable: true,
    redraw: true,
    extraRepayments: true,
    annualFee: '$0',
    bestFor: [
      'Rate-first borrowers',
      'PAYG employees with straightforward finances',
      'Digital banking users',
    ],
    restrictions: [
      'No physical branches — fully digital onboarding',
      'Best suited to clean, simple income structures',
    ],
    summary:
      'Consistently among Australia\'s lowest published variable rates. UHomeLoan includes an offset account and free redraw at $0 annual fee. NAB-backed but independently operated. Best suited to straightforward PAYG borrowers with clean credit.',
  },
  {
    id: 'up',
    name: 'Up Bank',
    shortName: 'Up',
    type: 'Neobank (Bendigo Bank backed)',
    serviceModel: 'App-only (no branch, limited phone)',
    website: 'https://up.com.au/home-loans/',
    offsetAvailable: false,
    redraw: true,
    extraRepayments: true,
    annualFee: '$0',
    bestFor: [
      'Digitally-native younger buyers',
      'Existing Up banking customers',
      'Owner-occupier P&I purchases',
    ],
    restrictions: [
      'Owner-occupier principal & interest only — no interest-only or investor loans',
      'App-only — support via in-app chat',
    ],
    summary:
      "Australia's newest home loan from the popular neobank, backed by Bendigo Bank. Competitive variable rate, transparent $0 fee structure, and excellent app experience. Currently limited to owner-occupier P&I — no investor or IO options.",
  },
  {
    id: 'boq',
    name: 'Bank of Queensland',
    shortName: 'BOQ',
    type: 'Regional bank',
    serviceModel: 'Branch + digital + broker',
    website: 'https://www.boq.com.au/personal/home-loans',
    offsetAvailable: true,
    redraw: true,
    extraRepayments: true,
    annualFee: '$0 (BOQ Blue Basic Variable) · ~$395/yr (BOQ Economy/Package with offset)',
    bestFor: [
      'Queensland buyers',
      'Casual and contract workers',
      'Borrowers wanting personal service over a major bank',
      'FHBG-eligible buyers',
    ],
    restrictions: [
      'Branch presence primarily in QLD and northern NSW',
    ],
    summary:
      'Queensland-based regional bank with manual underwriting and more flexible credit assessment than the Big 4. BOQ Blue Basic Variable is a no-annual-fee product with redraw; their Economy/Package adds offset. A participating First Home Guarantee (FHBG) lender. Known for more pragmatic treatment of casual employment in healthcare, education, and hospitality.',
  },
];
