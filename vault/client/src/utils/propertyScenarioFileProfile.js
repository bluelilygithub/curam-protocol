/**
 * Shared "your file" profile for Property Scenario modes.
 * Persists income/debts/deposit fields so buy / lite check / proforma don't re-type.
 */
const FILE_PROFILE_KEY = 'vault:propertyScenario:fileProfile';
const LAST_PROFORMA_KEY = 'vault:propertyScenario:lastProforma';

export function loadFileProfile() {
  try {
    const raw = localStorage.getItem(FILE_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveFileProfile(partial) {
  if (!partial || typeof partial !== 'object') return;
  try {
    const prev = loadFileProfile() || {};
    const next = { ...prev, ...partial, updatedAt: new Date().toISOString() };
    localStorage.setItem(FILE_PROFILE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

/** Map API-style snake_case payload into profile keys. */
export function saveFileProfileFromPayload(payload) {
  if (!payload) return null;
  const keys = [
    'property_value', 'deposit_amount', 'state', 'is_fhb', 'is_ppor',
    'gross_annual_income', 'partner_gross_income', 'household_type', 'dependents',
    'employment_type', 'months_in_current_role', 'has_hecs', 'is_new_build',
    'monthly_debt_repayments', 'monthly_expenses', 'credit_card_limits_total',
    'overtime_bonus_annual', 'overtime_bonus_regularity', 'self_employed_addbacks_annual',
    'genuine_savings_held_months', 'deposit_gift_amount', 'has_adverse_credit',
    'adverse_credit_severity', 'loan_term_years', 'target_rate_pct', 'applicant_age',
    'property_type_class', 'gross_rental_income', 'liabilities',
  ];
  const partial = {};
  keys.forEach((k) => {
    if (payload[k] !== undefined && payload[k] !== null && payload[k] !== '') partial[k] = payload[k];
  });
  return saveFileProfile(partial);
}

export function mergeInitialWithProfile(initialInputs) {
  const profile = loadFileProfile() || {};
  return { ...profile, ...(initialInputs || {}) };
}

export function saveLastProformaSummary(summary) {
  try {
    localStorage.setItem(LAST_PROFORMA_KEY, JSON.stringify({
      ...summary,
      savedAt: new Date().toISOString(),
    }));
  } catch { /* ignore */ }
}

export function loadLastProformaSummary() {
  try {
    const raw = localStorage.getItem(LAST_PROFORMA_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
