'use strict';

/**
 * Canonical category labels for document-redaction candidates.
 * Free-form LLM output is mapped here so HITL filters stay consistent.
 */

const CANONICAL = {
  email: 'Email',
  phone: 'Phone',
  national_id: 'National ID',
  date_of_birth: 'Date of birth',
  date: 'Date',
  address: 'Address',
  person_name: 'Person name',
  organisation: 'Organisation',
  bank_name: 'Bank name',
  banking_product: 'Banking product',
  interest_rate: 'Interest rate',
  financial_figure: 'Financial figure',
  capacity_amount: 'Capacity amount',
  credit_card_limit: 'Credit card limit',
  loan_amount: 'Loan amount',
  repayment: 'Repayment',
  buffer: 'Buffer',
  account_number: 'Account number',
  abn: 'ABN',
  sensitive: 'Sensitive',
  residual_risk: 'Residual risk',
  user_added: 'User added',
};

/** Lowercased / spaced aliases → canonical id */
const ALIASES = {
  email: 'email',
  'e-mail': 'email',
  'email address': 'email',
  phone: 'phone',
  'phone number': 'phone',
  telephone: 'phone',
  mobile: 'phone',
  national_id: 'national_id',
  'national id': 'national_id',
  ssn: 'national_id',
  tfn: 'national_id',
  'tax file number': 'national_id',
  date_of_birth: 'date_of_birth',
  'date of birth': 'date_of_birth',
  dob: 'date_of_birth',
  date: 'date',
  address: 'address',
  'street address': 'address',
  person_name: 'person_name',
  'person name': 'person_name',
  person: 'person_name',
  name: 'person_name',
  'client name': 'person_name',
  organisation: 'organisation',
  organization: 'organisation',
  org: 'organisation',
  company: 'organisation',
  'company name': 'organisation',
  bank_name: 'bank_name',
  'bank name': 'bank_name',
  bank: 'bank_name',
  lender: 'bank_name',
  banking_product: 'banking_product',
  'banking product': 'banking_product',
  product: 'banking_product',
  interest_rate: 'interest_rate',
  'interest rate': 'interest_rate',
  rate: 'interest_rate',
  financial_figure: 'financial_figure',
  'financial figure': 'financial_figure',
  'financial figures': 'financial_figure',
  amount: 'financial_figure',
  figure: 'financial_figure',
  currency: 'financial_figure',
  money: 'financial_figure',
  capacity_amount: 'capacity_amount',
  'capacity amount': 'capacity_amount',
  capacity: 'capacity_amount',
  'borrowing capacity': 'capacity_amount',
  credit_card_limit: 'credit_card_limit',
  'credit card limit': 'credit_card_limit',
  'card limit': 'credit_card_limit',
  loan_amount: 'loan_amount',
  'loan amount': 'loan_amount',
  'loan balance': 'loan_amount',
  repayment: 'repayment',
  repayments: 'repayment',
  'monthly repayment': 'repayment',
  buffer: 'buffer',
  'surplus buffer': 'buffer',
  account_number: 'account_number',
  'account number': 'account_number',
  bsb: 'account_number',
  abn: 'abn',
  sensitive: 'sensitive',
  other: 'sensitive',
  pii: 'sensitive',
  residual_risk: 'residual_risk',
  'residual risk': 'residual_risk',
  user_added: 'user_added',
  'user added': 'user_added',
};

const GENERIC_IDS = new Set([
  'financial_figure',
  'sensitive',
  'other',
  'pii',
  'numeric',
  'amount',
  'figure',
]);

function slugifyCategory(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[_/|]+/g, ' ')
    .replace(/[^a-z0-9%\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function categoryId(raw) {
  const slug = slugifyCategory(raw);
  if (!slug) return 'sensitive';
  if (ALIASES[slug]) return ALIASES[slug];
  const underscored = slug.replace(/\s+/g, '_');
  if (CANONICAL[underscored]) return underscored;
  if (ALIASES[underscored]) return ALIASES[underscored];
  return underscored;
}

function titleCaseWords(slug) {
  return String(slug || '')
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Map free-form LLM / pattern category → stable display label.
 * Known ids use the enum; unknowns are Title Cased so casing variants collapse.
 */
function normalizeCategoryLabel(raw) {
  const id = categoryId(raw);
  if (CANONICAL[id]) return CANONICAL[id];
  return titleCaseWords(id) || CANONICAL.sensitive;
}

function isGenericCategory(raw) {
  return GENERIC_IDS.has(categoryId(raw));
}

/**
 * Prefer a specific category over a generic fallback (e.g. Capacity amount > Financial figure).
 */
function pickPreferredCategory(a, b) {
  const labelA = a ? normalizeCategoryLabel(a) : '';
  const labelB = b ? normalizeCategoryLabel(b) : '';
  if (!labelA) return labelB || CANONICAL.sensitive;
  if (!labelB) return labelA;
  const genA = isGenericCategory(labelA);
  const genB = isGenericCategory(labelB);
  if (genA && !genB) return labelB;
  if (genB && !genA) return labelA;
  if (labelB.length > labelA.length) return labelB;
  return labelA;
}

module.exports = {
  CANONICAL,
  ALIASES,
  GENERIC_IDS,
  categoryId,
  normalizeCategoryLabel,
  isGenericCategory,
  pickPreferredCategory,
};
