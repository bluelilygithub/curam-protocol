'use strict';

/**
 * Qualification Proforma — the "broker file review" layer on top of the
 * deterministic buyer-qualification engine.
 *
 * This module does NOT change the strict qualification numbers. It takes the
 * strict result and, separately, computes:
 *
 *   1. `levers`   — specific, legitimate presentation/structuring/timing/lender-
 *                    selection choices a broker might make to put a file in its
 *                    best light, each tagged with a risk level and a plain-English
 *                    explanation of why it is (or isn't) safely within bounds.
 *   2. `excluded` — a static list of things that are NOT modelled because they
 *                    would constitute misrepresentation to a lender (loan fraud
 *                    under the NCCP Act) — included for transparency about where
 *                    the line sits, not as a menu.
 *   3. `lenderFit`— a live, CDR-sourced view of which currently-published bank
 *                    products match the requested loan purpose/structure, using
 *                    only real lender-published fields (rate, fees, eligibility
 *                    text, special-purpose flags). This is deliberately NOT a
 *                    simulation of bank credit-policy decisions — those policies
 *                    (HEM multipliers, serviceability floors, casual-employment
 *                    windows, etc.) are commercial-in-confidence and not published
 *                    via Open Banking, so we do not fabricate them.
 *
 * Nothing here is legal or financial advice. It is educational context to help
 * a borrower understand what a broker legitimately does with a file, and where
 * "optimising" a loan application stops being optimisation and becomes fraud.
 */

const {
  assessBuyerQualification,
  maxLoanFromMonthlyRepayment,
} = require('./buyerQualification');
const { roundMoney } = require('./tables');
const { buildEligibleLenderProducts } = require('./eligibleProducts');
const { buildBankPostureFit, buildMergedBankPanel } = require('./bankPosture');
const { buildProformaSupplement } = require('./proformaSupplement');

/** Parse "+$123,456 indicative…" style lever impacts into a number. */
function parseLeverUplift(impact) {
  if (!impact || typeof impact !== 'string') return 0;
  const m = impact.match(/\+\$([\d,]+)/);
  if (!m) return 0;
  return Number(String(m[1]).replace(/,/g, '')) || 0;
}

function buildLeversDelta(strict, levers) {
  const base = Math.round(Number(strict?.summary?.max_borrowing_capacity) || 0);
  const loan = Math.round(Number(strict?.summary?.loan_requested) || 0);
  const items = (levers || [])
    .map((lv) => ({ id: lv.id, title: lv.title, uplift: parseLeverUplift(lv.impact), riskLevel: lv.riskLevel }))
    .filter((x) => x.uplift > 0)
    .sort((a, b) => b.uplift - a.uplift);
  // Uplifts are not strictly additive (overlapping levers) — present as a stacked
  // indicative range, not a guaranteed sum.
  const stacked = items.reduce((s, x) => s + x.uplift, 0);
  const optimistic = base + stacked;
  return {
    base_capacity: base,
    loan_requested: loan,
    items,
    stacked_uplift: stacked,
    optimistic_capacity: optimistic,
    note: items.length
      ? `Strict indicative capacity $${base.toLocaleString('en-AU')}. Stacking the lever uplifts below (indicative, not additive guarantees) points toward ~$${optimistic.toLocaleString('en-AU')}. Talk to a broker before treating any stack as real.`
      : `Strict indicative capacity $${base.toLocaleString('en-AU')}. No quantified structuring levers fired from these inputs.`,
  };
}

function getCheck(checks, id) {
  return (checks || []).find((c) => c.id === id) || null;
}

// ─── Levers ───────────────────────────────────────────────────────────────────

function buildLevers(strict, inputs) {
  const levers = [];
  if (!strict?.ok) return levers;

  const checks = strict.checks || [];
  const summary = strict.summary || {};
  const svc = getCheck(checks, 'serviceability');
  const netSurplus = Number(svc?.data?.net_surplus_monthly) || 0;
  const assessmentRatePct = summary.assessment_rate_pct;
  const termMonths = Math.round((Number(inputs.loanTermYears) || 30) * 12);
  const baseCapacity = Number(summary.max_borrowing_capacity) || 0;

  function capacityWithExtraSurplus(extraMonthly) {
    const s = roundMoney(netSurplus + extraMonthly);
    return s > 0 ? (maxLoanFromMonthlyRepayment(s, assessmentRatePct, termMonths) || 0) : 0;
  }
  function upliftFor(extraMonthly) {
    return Math.max(0, Math.round(capacityWithExtraSurplus(extraMonthly) - baseCapacity));
  }

  // ── 1. Reduce / close credit cards before applying ──────────────────────
  const cardLimits = Number(inputs.creditCardLimitsTotal) || 0;
  if (cardLimits > 0) {
    const cardCommitment = roundMoney(cardLimits * 0.038);
    const uplift = upliftFor(cardCommitment);
    levers.push({
      id: 'reduce_card_limits',
      title: 'Close or reduce unused credit card / BNPL limits before applying',
      category: 'Structuring — timing',
      riskLevel: 'low',
      whatItIs: `$${cardLimits.toLocaleString('en-AU')} in card limits is assessed at 3.8%/month ($${cardCommitment.toLocaleString('en-AU')}/mo) regardless of balance carried. Closing unused cards or reducing limits removes this commitment.`,
      whyItsAllowed: 'The commitment genuinely disappears once the limit is reduced — this is standard broker advice, not misrepresentation. It has to happen before the application and stay that way; reopening the card straight after settlement, with no genuine change of intent, tips this into presenting a temporary snapshot as your real position.',
      impact: uplift > 0 ? `+$${uplift.toLocaleString('en-AU')} indicative borrowing capacity if limits are closed entirely.` : 'Removes a real monthly commitment from the serviceability calculation.',
    });
  }

  // ── 2. Overtime / bonus / commission crediting ──────────────────────────
  const overtime = Number(inputs.overtimeBonusAnnual) || 0;
  if (overtime > 0) {
    const regularity = inputs.overtimeBonusRegularity || 'irregular';
    const conservativeShade = regularity === 'two_year_history' ? 0.8 : 0;
    const generousShade = regularity === 'two_year_history' ? 1.0 : regularity === 'one_year_history' ? 0.8 : 0.5;
    const conservativeMonthly = roundMoney((overtime * conservativeShade) / 12);
    const generousMonthly = roundMoney((overtime * generousShade) / 12);
    const conservativeUplift = upliftFor(conservativeMonthly);
    const generousUplift = upliftFor(generousMonthly);
    levers.push({
      id: 'overtime_bonus_crediting',
      title: 'Choosing a lender/method that credits more of your overtime, bonus, or commission',
      category: 'Lender selection',
      riskLevel: 'medium',
      whatItIs: `$${overtime.toLocaleString('en-AU')}/yr in overtime/bonus/commission with ${regularity === 'two_year_history' ? '2 years' : regularity === 'one_year_history' ? '1 year' : 'no established'} history. Lenders differ on how much of this they'll credit and over what averaging period — this is a genuine, publicly-known policy difference, not a secret.`,
      whyItsAllowed: 'Selecting the lender whose stated policy best matches your actual income pattern is legitimate shopping — the income itself must still be real and evidenced by payslips/group certificates. It becomes a problem if the income is one-off, already ended, or presented as ongoing when it isn\'t.',
      impact: `Indicative range: +$${conservativeUplift.toLocaleString('en-AU')} (conservative lender) to +$${generousUplift.toLocaleString('en-AU')} (generous lender) borrowing capacity, depending purely on which lender's crediting policy applies.`,
      regulatoryNote: 'A lender must still be satisfied the income is likely to continue — presenting genuinely irregular income as regular risks a serviceability misrepresentation, not just an aggressive-but-fair reading.',
    });
  }

  // ── 3. Self-employed add-backs ────────────────────────────────────────────
  const addbacks = Number(inputs.selfEmployedAddbacksAnnual) || 0;
  if (inputs.employmentType === 'self_employed' && addbacks > 0) {
    const monthly = roundMoney(addbacks / 12);
    const uplift = upliftFor(monthly);
    levers.push({
      id: 'self_employed_addbacks',
      title: 'Adding back non-cash / one-off expenses to assessable business income',
      category: 'Documentation',
      riskLevel: 'medium',
      whatItIs: `$${addbacks.toLocaleString('en-AU')}/yr in add-backs (e.g. depreciation, one-off legal/relocation costs, owner's excess super contributions) added back to net profit for serviceability purposes.`,
      whyItsAllowed: 'Add-backs are a normal, accountant-verified accounting practice — the cash was never actually unavailable to the business. It requires a letter from your accountant itemising each add-back; lenders reject unverifiable or recurring "one-off" items presented as add-backs year after year.',
      impact: `+$${uplift.toLocaleString('en-AU')} indicative borrowing capacity — but only if your accountant will put their name to each item, and only some lenders accept the full add-back list.`,
      regulatoryNote: 'Add-backs for genuinely recurring costs (e.g. rent you\'ll keep paying) are not legitimate — that materially misstates ongoing cash flow.',
    });
  }

  // ── 4. Declared expenses vs HEM — NOT a lever (misrepresentation).
  // Educational note lives in EXCLUDED_LEVERS so we never attach a "$ you'd gain"
  // figure to under-declaring expenses on a regulated credit application.

  // ── 5. Timing around employment tenure thresholds ────────────────────────
  const emp = getCheck(checks, 'employment');
  const tenureAware = ['casual', 'contract', 'payg_parttime'].includes(inputs.employmentType);
  if (tenureAware && Number.isFinite(inputs.monthsInCurrentRole) && inputs.monthsInCurrentRole < 12) {
    const monthsToGo = Math.max(0, 12 - inputs.monthsInCurrentRole);
    levers.push({
      id: 'timing_tenure_threshold',
      title: 'Waiting for (or shopping to) a lender\'s tenure threshold',
      category: 'Structuring — timing',
      riskLevel: 'low',
      whatItIs: `At ${inputs.monthsInCurrentRole} months in your current role, ${emp?.status === 'fail' ? 'most lenders decline outright' : 'you sit in a narrower lender pool'}. Waiting ${monthsToGo} more month${monthsToGo === 1 ? '' : 's'} to reach 12 months opens the mainstream market; alternatively, a handful of lenders accept 6+ months with an employer letter today.`,
      whyItsAllowed: 'This is pure timing/lender-selection — nothing about your file changes except when you apply and who you ask. No figures are altered.',
      impact: `Employment check moves from "${emp?.status || 'warn'}" toward "pass" once the 12-month threshold is reached, without any other change to the file.`,
    });
  }

  // ── 6. Rental appraisal choice (investment purchases) ────────────────────
  if (inputs.isPpor === false && Number(inputs.grossRentalIncome) > 0) {
    const gross = Number(inputs.grossRentalIncome);
    const lowShade = roundMoney((gross * 0.70) / 12);
    const highShade = roundMoney((gross * 0.80) / 12);
    const lowUplift = upliftFor(lowShade);
    const highUplift = upliftFor(highShade);
    levers.push({
      id: 'rental_appraisal_shading',
      title: 'Getting a second rental appraisal and using the lender with the least conservative shading',
      category: 'Lender selection',
      riskLevel: 'low',
      whatItIs: `Gross rental income of $${gross.toLocaleString('en-AU')}/yr is shaded 70–80% by most lenders. Two independent agent appraisals plus choosing a lender at the 80% end of that range both legitimately lift the assessable rental figure.`,
      whyItsAllowed: 'Multiple genuine appraisals and lender-policy shopping are standard broker practice — the rent itself must still be realistic and evidenced (lease, rental appraisal letter), not invented.',
      impact: `Indicative range: +$${lowUplift.toLocaleString('en-AU')} (70% shading) to +$${highUplift.toLocaleString('en-AU')} (80% shading) borrowing capacity.`,
    });
  }

  // ── 7. Family guarantor to avoid LMI / genuine savings entirely ─────────
  const lvrCheck = getCheck(checks, 'lvr');
  const genuineCheck = getCheck(checks, 'genuine_savings');
  if ((lvrCheck?.status === 'warn' || lvrCheck?.status === 'fail') || genuineCheck?.status === 'fail') {
    levers.push({
      id: 'family_guarantor',
      title: 'Using a family guarantor to reach sufficient security',
      category: 'Structuring — third party',
      riskLevel: 'high',
      whatItIs: 'A parent (usually) offers equity in their own home as additional security, lifting effective security to avoid LMI and/or bypass the genuine savings requirement entirely.',
      whyItsAllowed: 'This is a real, commonly-used, fully legal lending structure — but it shifts real risk onto a third party, not a paperwork trick. The guarantor must get independent legal advice and genuinely understand they are liable if you default.',
      impact: 'Can remove the LMI/genuine-savings blocker entirely — but at the cost of a family member\'s house being on the line, which is why this sits at the higher end of risk here: the risk isn\'t regulatory, it\'s to the relationship and the guarantor\'s own home.',
      regulatoryNote: 'Lenders require independent legal advice for guarantors specifically because this arrangement has a history of being poorly understood by the guarantor — treat that requirement as a genuine safeguard, not a box-tick.',
    });
  }

  // ── 8. Sequencing applications to limit hard-enquiry damage ─────────────
  levers.push({
    id: 'sequence_applications',
    title: 'Running one broker panel comparison instead of multiple bank applications',
    category: 'Process',
    riskLevel: 'low',
    whatItIs: 'Every direct bank application is a hard credit enquiry. Multiple enquiries in a short window can itself trigger automated declines at some lenders, independent of your actual financial position. A broker comparing a panel of lenders before submitting narrows this to one, carefully-chosen application.',
    whyItsAllowed: 'This changes nothing about your financial position — it only changes the number of times it gets checked and by whom, and in what order.',
    impact: 'No dollar impact — reduces the chance of an unrelated credit-score-driven decline from your own rate-shopping.',
  });

  return levers;
}

// ─── Where the line sits (not modelled — deliberately excluded) ─────────────

const EXCLUDED_LEVERS = [
  {
    id: 'undisclosed_debts',
    title: 'Omitting an existing credit card, BNPL account, or personal loan from the application',
    why: 'This is misrepresentation of your actual liabilities. It is also easily discovered — lenders and credit bureaus see undisclosed accounts, and bank statement checks reveal repayments you didn\'t declare.',
  },
  {
    id: 'overstating_income',
    title: 'Declaring income above what payslips, tax returns, or BAS can verify',
    why: 'Income must be evidenced. Lenders verify against payslips, group certificates, ATO income statements, or tax returns — a figure that can\'t be verified is fabricated, not "optimised."',
  },
  {
    id: 'underdeclaring_expenses',
    title: 'Declaring living expenses at the HEM floor when you know your actual spending is higher',
    why: 'HEM is a regulatory floor lenders apply when declared expenses are lower — not a licence to under-declare. Responsible lending obligations (NCCP Act) require honest disclosure. Bank statements often reveal the gap. This is a compliance breach, not a structuring choice — we deliberately do not quantify any borrowing-capacity "upside" for it.',
  },
  {
    id: 'false_occupancy',
    title: 'Declaring a property as owner-occupied to get a better rate/LVR when you intend to rent it out',
    why: 'Owner-occupier vs investment is a loan contract term, not a preference. Misrepresenting it is a breach of contract that can trigger loan recall, and it is routinely checked (rates notices, insurance, tenancy databases).',
  },
  {
    id: 'temporary_reversal',
    title: 'Paying down debt or reducing card limits purely for the application, with a plan to reverse it right after settlement',
    why: 'Presenting a deliberately temporary snapshot as your ongoing financial position is materially misleading, even though each individual action (paying down debt) is legal on its own. Intent is what separates this from the legitimate "close unused cards before applying" structuring step.',
  },
  {
    id: 'disguised_borrowed_deposit',
    title: 'Dressing up borrowed funds (an undisclosed personal loan) as a "gift" to satisfy genuine savings',
    why: 'Genuine savings rules exist specifically to test that a deposit isn\'t itself borrowed money creating hidden leverage. Mischaracterising a loan as a gift defeats the purpose of the check and is a false statement on the application.',
  },
  {
    id: 'coached_omission',
    title: 'Coaching a co-borrower or guarantor to omit their own debts from a joint application',
    why: 'Every applicant\'s declaration is made under their own name and, typically, a statutory declaration or signed application warning about false statements — this exposes the co-borrower personally, not just the primary applicant.',
  },
];

// ─── Live lender fit (CDR-derived only — no policy speculation) ─────────────

function buildLenderFit(allNormalized, opts = {}) {
  const pack = buildEligibleLenderProducts(allNormalized, opts);
  const products = (pack.products || []).map((p) => {
    let fit = 'available';
    let fitNote = 'Matches the requested loan purpose based on this bank\'s published product data.';
    if (p.special_eligibility) {
      fit = 'restricted';
      fitNote = p.special_eligibility_label || 'This product has a restricted-eligibility flag published by the bank — confirm directly whether you qualify.';
    } else if (p.eligibility && p.eligibility.length > 0) {
      fit = 'check';
      fitNote = p.eligibility.join(' · ');
    }
    return { ...p, fit, fit_note: fitNote };
  });
  return {
    ...pack,
    products,
    basis: 'cdr_prd_only',
    note: `${pack.note} This reflects live product publication only (CDR Product Reference Data) — not a credit or serviceability decision. Whether you would specifically be approved depends on each lender's own credit assessment, which is not published via Open Banking and cannot be simulated here.`,
  };
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * @param {object} inputs — assessBuyerQualification inputs plus:
 *   overtimeBonusAnnual, overtimeBonusRegularity ('two_year_history'|'one_year_history'|'irregular'),
 *   selfEmployedAddbacksAnnual, genuineSavingsHeldMonths, depositGiftAmount,
 *   liabilities (itemised [{ type, label, monthlyRepayment }])
 * @param {object[]} [allNormalized] — live CDR-normalized product rows (optional; omit for strict-only)
 * @returns {{ ok: boolean, strict: object, levers: object[], excluded: object[], lenderFit: object|null, bankPosture: object|null }}
 */
function buildQualificationProforma(inputs = {}, allNormalized = null) {
  const strict = assessBuyerQualification(inputs);
  if (!strict.ok) {
    return {
      ok: false,
      errors: strict.errors,
      strict,
      levers: [],
      excluded: EXCLUDED_LEVERS,
      lenderFit: null,
      bankPosture: null,
      bankPanel: null,
      leversDelta: null,
      supplement: null,
    };
  }

  const levers = buildLevers(strict, inputs);
  const leversDelta = buildLeversDelta(strict, levers);
  const bankPosture = buildBankPostureFit(inputs, strict.summary || {}, strict.checks || []);
  const supplement = buildProformaSupplement(strict, inputs, bankPosture);
  const lenderFit = Array.isArray(allNormalized) && allNormalized.length > 0
    ? buildLenderFit(allNormalized, {
      loanAmount: strict.summary.loan_requested,
      termMonths: Math.round((Number(inputs.loanTermYears) || 30) * 12),
      isPpor: inputs.isPpor !== false,
      maxPerBank: 2,
    })
    : null;
  const bankPanel = buildMergedBankPanel(bankPosture, lenderFit);

  // Adverse credit simulation — run scoring a second time with hasAdverseCredit forced on.
  // Only generated when the actual file does NOT already declare adverse credit, so the
  // broker can see the "what if a default surfaces" scenario without re-submitting.
  const bankPostureAdverse = inputs.hasAdverseCredit
    ? null
    : buildBankPostureFit({ ...inputs, hasAdverseCredit: true }, strict.summary || {}, strict.checks || []);
  const bankPanelAdverse = bankPostureAdverse ? buildMergedBankPanel(bankPostureAdverse, lenderFit) : null;

  return {
    ok: true,
    strict,
    levers,
    leversDelta,
    excluded: EXCLUDED_LEVERS,
    lenderFit,
    bankPosture,
    bankPanel,
    bankPostureAdverse,
    bankPanelAdverse,
    supplement,
    meta: {
      caveat: 'Levers describe legitimate presentation, timing, documentation, and lender-selection choices only — none of them involve changing a true fact about income, debts, or employment. The "excluded" list exists to show where that line sits. Bank posture and per-bank capacity use curated policy knobs through the same surplus engine — indicative only, not credit decisions. The supplement adds rate stress, product-fit guidance, and post-settlement cashflow notes.',
    },
  };
}

module.exports = {
  buildQualificationProforma,
  buildLenderFit,
  EXCLUDED_LEVERS,
};
