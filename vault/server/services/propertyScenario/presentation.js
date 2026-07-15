'use strict';

const { roundMoney } = require('./calc/tables');
const { paymentAmount, amortizeUntilPaid, periodRate } = require('./calc/loanMath');
const { calculateRepayment } = require('./calc/repayment');
const { calculateExtraRepayments } = require('./calc/extraRepayments');
const { calculateOffsetBenefit } = require('./calc/offset');
const { calculateBorrowingPower } = require('./calc/borrowingPower');
const { MOCK_LENDERS } = require('./mockLenders');

/**
 * Build follow-up questions + broker/tax checklist from Stage 4 caveats / assumptions.
 * @param {object} calculation — runScenario result
 */
function buildAdviceFromCalculation(calculation = {}) {
  const caveats = calculation.caveats || [];
  const assumptions = calculation.assumptions || [];
  const all = [...caveats, ...assumptions];
  const joined = all.join('\n').toLowerCase();

  const questions = [];
  const raise = [];

  const pushQ = (q) => {
    if (questions.length >= 3) return;
    if (questions.includes(q)) return;
    questions.push(q);
  };
  const pushRaise = (item) => {
    if (!raise.includes(item)) raise.push(item);
  };

  if (/cgt|capital gain|main residence|6-year|taxable capital/i.test(joined)) {
    pushQ('Want me to explore a 6-year rule / partial main-residence scenario for this sale?');
    pushRaise('Confirm CGT cost base and PPOR vs investment periods with a registered tax agent before settlement.');
  }
  if (/stamp duty|fhb|first.?home/i.test(joined)) {
    pushQ('Should we check first-home-buyer or off-the-plan duty concessions for the purchase state?');
    pushRaise('Verify stamp duty (and any concessions) with the state revenue office or conveyancer.');
  }
  if (/break cost|fixed-rate|ird|early.?repayment/i.test(joined)) {
    pushQ('Want a formal break-cost quote path before locking the refinance/switch timing?');
    pushRaise('Request a written payout/break-cost quote from the current lender (IRD estimates are not final).');
  }
  // Prefer first-class flags over loose text matching for bridging
  const bridgingFlag = Boolean(
    calculation.bridging_required
    || calculation.funding_alert?.bridging_required
    || calculation.totals?.bridging_required
    || (Number(calculation.deposit_shortfall || calculation.totals?.deposit_shortfall || 0) > 0)
  );
  if (bridgingFlag || /BRIDGING \/ FUNDING GAP|buy-before-sell|bridging finance/i.test(joined)) {
    pushQ(
      'Funding gap needs your decision first (default: do not treat as resolved) — delay the buy, use other cash, '
      + 'or only then explore indicative bridging cost with your broker?'
    );
    pushRaise(
      'Confirm settlement order and bridging eligibility with your broker before exchanging — '
      + 'eligibility is not modelled here; any in-app bridging figure is indicative interest only.'
    );
  }
  if (/lmi|lvr/i.test(joined)) {
    pushQ('Want to compare a higher deposit vs paying LMI on this purchase?');
    pushRaise('Confirm LMI pricing and LVR policy with the lender/insurer — estimates are order-of-magnitude only.');
  }
  if (/refinance|break-even|honeymoon|offset/i.test(joined)) {
    pushQ('Want to stress-test the refinance break-even if the rate rises again in 12 months?');
    pushRaise('Ask the broker which cashbacks, fee waivers, and offset features survive after any honeymoon period.');
  }

  // Always useful generic broker items from money totals
  if ((calculation.totals?.stamp_duty || 0) > 0) {
    pushRaise(`Budget ~$${Number(calculation.totals.stamp_duty).toLocaleString()} stamp duty from this scenario (confirm exact liability).`);
  }
  if ((calculation.totals?.selling_costs || 0) > 0) {
    pushRaise(`Confirm selling costs (~$${Number(calculation.totals.selling_costs).toLocaleString()} assumed) with the agent/conveyancer.`);
  }
  if ((calculation.totals?.refinance_fees || 0) > 0) {
    pushRaise(`Confirm refinance/switch fees (~$${Number(calculation.totals.refinance_fees).toLocaleString()} assumed).`);
  }

  // Fill to 2–3 questions if sparse
  if (questions.length < 2) {
    pushQ('Want a repayment / offset / extra-repayment walkthrough on the new loan using the Stage 5 calculators?');
  }
  if (questions.length < 3) {
    pushQ('Should we stress-test this against other CDR lender rates (variable vs fixed, with/without offset)?');
  }

  // Deduped caveat digest for the "raise with" list (top significant unique)
  all.forEach((c) => {
    const t = String(c).trim();
    if (!t) return;
    if (/as of |assumed |treated as |flagged as/i.test(t) && raise.length > 8) return;
    if (t.length > 220) pushRaise(`${t.slice(0, 200)}…`);
    else if (!/^\s*upfront refinance costs assumed/i.test(t)) pushRaise(t);
  });

  return {
    follow_up_questions: questions.slice(0, 3),
    raise_with_broker_or_tax_agent: raise.slice(0, 12),
    caveat_count: caveats.length,
    assumption_count: assumptions.length,
  };
}

/**
 * Summary table rows from orchestrator totals + events.
 */
function buildScenarioSummaryTable(calculation = {}) {
  const t = calculation.totals || {};
  const rows = [
    { key: 'total_costs', label: 'Total modelled costs', value: t.total_costs, kind: 'cost' },
    { key: 'selling_costs', label: 'Selling costs', value: t.selling_costs, kind: 'cost' },
    { key: 'stamp_duty', label: 'Stamp duty', value: t.stamp_duty, kind: 'cost' },
    { key: 'lmi', label: 'LMI estimate', value: t.lmi, kind: 'cost' },
    { key: 'refinance_fees', label: 'Refinance / switch fees', value: t.refinance_fees, kind: 'cost' },
    { key: 'break_costs', label: 'Break costs', value: t.break_costs, kind: 'cost' },
    { key: 'sale_proceeds', label: 'Net sale proceeds generated', value: t.sale_proceeds_generated, kind: 'in' },
    { key: 'deposit_from_sale', label: 'Deposit funded from sale', value: t.deposit_funded_from_sale, kind: 'transfer' },
    { key: 'deposit_shortfall', label: 'Deposit shortfall (bridging need)', value: t.deposit_shortfall, kind: 'cost' },
    { key: 'unused_proceeds', label: 'Unused sale proceeds', value: t.unused_sale_proceeds, kind: 'in' },
    { key: 'monthly_saving', label: 'Monthly repayment saving (after switch)', value: t.monthly_repayment_saving, kind: 'benefit' },
    { key: 'annual_saving', label: 'Annualised repayment saving', value: t.annualised_repayment_saving, kind: 'benefit' },
    { key: 'mre_gain', label: 'MRE-exempt capital gain (memo)', value: t.main_residence_exempt_gain, kind: 'memo' },
    { key: 'taxable_cgt', label: 'Taxable CGT estimate', value: t.taxable_cgt_estimate, kind: 'memo' },
  ];

  const eventRows = (calculation.event_results || []).map((e) => ({
    key: `event_${e.event_id}`,
    label: `${e.sequence}. ${e.label || e.type} (${e.type})`,
    value: e.costs,
    kind: 'event',
    meta: {
      date: e.date,
      ok: e.ok,
      benefits: e.benefits,
    },
  }));

  return { totals: rows, events: eventRows };
}

/**
 * Lender comparison grid + chart bars for a given loan amount / term.
 * Pass `lenders` from CDR PRD (Stage 7); falls back to MOCK_LENDERS.
 */
function buildLenderComparison(opts = {}) {
  const loanAmount = Number(opts.loan_amount) || 1_200_000;
  const termMonths = Number(opts.term_months) || 360;
  const source = Array.isArray(opts.lenders) && opts.lenders.length
    ? opts.lenders
    : MOCK_LENDERS;
  const usingLive = Array.isArray(opts.lenders) && opts.lenders.length > 0;

  const rows = source.map((l) => {
    const monthly = paymentAmount(loanAmount, l.rate, termMonths, 'monthly');
    const periods = termMonths;
    const totalRepaid = roundMoney(monthly * periods);
    const interest = roundMoney(totalRepaid - loanAmount);
    const feesLife = roundMoney(
      (l.upfront_fees || 0) + ((l.ongoing_annual_fees || 0) * (termMonths / 12))
    );
    const totalCostWithFees = roundMoney(interest + feesLife);
    const isStub = l.stub != null ? Boolean(l.stub) : !usingLive;
    return {
      ...l,
      loan_amount: loanAmount,
      term_months: termMonths,
      monthly_repayment: monthly,
      total_interest: interest,
      fees_over_term: feesLife,
      total_cost_interest_plus_fees: totalCostWithFees,
      stub: isStub,
      // Explicit per-row provenance — never silent-blend live + mock without a badge
      provenance: isStub ? 'mock' : (l.source === 'cdr_prd' ? 'cdr_prd' : 'live'),
      provenance_label: isStub ? 'MOCK' : 'CDR',
      fees_estimated: l.fees_estimated != null ? Boolean(l.fees_estimated) : !isStub,
      upfront_fees_estimated: l.upfront_fees_estimated != null
        ? Boolean(l.upfront_fees_estimated)
        : !isStub,
    };
  });

  const rateComparison = rows.map((r) => ({
    name: r.name,
    rate: r.rate,
    comparison_rate: r.comparison_rate,
    monthly_repayment: r.monthly_repayment,
    total_cost: r.total_cost_interest_plus_fees,
  }));

  const data_note = opts.data_note
    || (usingLive
      ? 'Live rates from Australia’s CDR Product Reference Data (public, unauthenticated). Fee/feature fields vary by bank completeness.'
      : 'Stub lender rates — live CDR PRD unavailable; using Stage 6 mocks.');

  return { lenders: rows, rate_comparison: rateComparison, data_note, source: usingLive ? 'cdr_prd' : 'stub' };
}

/**
 * Cumulative cost: advertised-rate interest path vs interest + fees (first two stub lenders by cost).
 */
function buildCumulativeCostSeries(loanAmount, termMonths, lenders) {
  const horizonYears = Math.min(30, Math.ceil(termMonths / 12));
  const series = [];
  const top = [...lenders].slice(0, 3);

  for (let y = 0; y <= horizonYears; y += 1) {
    const point = { year: y };
    top.forEach((l) => {
      const monthly = paymentAmount(loanAmount, l.rate, termMonths, 'monthly');
      const monthsElapsed = Math.min(y * 12, termMonths);
      // Approximate cumulative interest by simulating briefly
      let bal = loanAmount;
      let interestPaid = 0;
      const r = periodRate(l.rate, 12);
      for (let m = 0; m < monthsElapsed; m += 1) {
        const interest = roundMoney(bal * r);
        interestPaid += interest;
        bal = roundMoney(bal + interest - monthly);
        if (bal <= 0) break;
      }
      const feesToDate = roundMoney(
        (l.upfront_fees || 0) + ((l.ongoing_annual_fees || 0) * y)
      );
      point[`${l.id}_rate_only`] = roundMoney(interestPaid);
      point[`${l.id}_with_fees`] = roundMoney(interestPaid + feesToDate);
    });
    series.push(point);
  }

  return {
    series,
    lenders: top.map((l) => ({ id: l.id, name: l.name })),
    note: 'Cumulative interest from rate alone vs interest + fees over time.',
  };
}

/**
 * Yearly amortisation principal vs interest for a loan.
 */
function buildAmortizationSeries(loanAmount, ratePct, termMonths) {
  const monthly = paymentAmount(loanAmount, ratePct, termMonths, 'monthly');
  const r = periodRate(ratePct, 12);
  let bal = loanAmount;
  const byYear = [];
  let yearPrincipal = 0;
  let yearInterest = 0;
  let year = 1;

  for (let m = 1; m <= termMonths && bal > 0.01; m += 1) {
    const interest = roundMoney(bal * r);
    const principal = roundMoney(Math.min(bal, monthly - interest));
    bal = roundMoney(bal - principal);
    yearInterest += interest;
    yearPrincipal += principal;
    if (m % 12 === 0 || m === termMonths) {
      byYear.push({
        year,
        principal: roundMoney(yearPrincipal),
        interest: roundMoney(yearInterest),
        balance: Math.max(0, bal),
      });
      year += 1;
      yearPrincipal = 0;
      yearInterest = 0;
    }
  }

  return {
    monthly_repayment: monthly,
    schedule: byYear,
    loan_amount: loanAmount,
    rate: ratePct,
    term_months: termMonths,
  };
}

/**
 * Break-even chart: cumulative refinance costs vs cumulative monthly savings.
 */
function buildBreakEvenSeries(calculation = {}) {
  const switchEv = (calculation.event_results || []).find((e) => e.type === 'switch_lender' || e.type === 'refinance');
  const refi = switchEv?.outputs?.refinance_break_even;
  if (!refi || !refi.ok) {
    return { series: [], note: 'No refinance/switch break-even available in this scenario.' };
  }

  const upfront = Number(refi.upfront_cost) || 0;
  const breakCost = Number(switchEv?.outputs?.break_cost?.break_cost_estimate) || 0;
  const totalCost = roundMoney(upfront + breakCost);
  const monthlySaving = Number(refi.monthly_saving) || 0;
  const beMonths = refi.break_even_months != null
    ? Number(refi.break_even_months)
    : (monthlySaving > 0 ? Math.ceil(totalCost / monthlySaving) : null);

  const horizon = Math.max(24, (beMonths || 12) * 2);
  const series = [];
  for (let m = 0; m <= horizon; m += 1) {
    series.push({
      month: m,
      cumulative_cost: totalCost,
      cumulative_savings: roundMoney(Math.max(0, monthlySaving) * m),
    });
  }

  return {
    series,
    break_even_months: beMonths,
    upfront_cost: totalCost,
    monthly_saving: monthlySaving,
    note: monthlySaving > 0
      ? `Savings overtake switch costs around month ${beMonths}.`
      : 'No modelled monthly saving — break-even not reached on repayment maths alone.',
  };
}

/**
 * Stage 5 calculator snapshots for the new loan in the compound scenario.
 */
function buildCalculatorSnapshots(loanAmount = 1_200_000, rate = 5.29, termMonths = 360) {
  return {
    repayment: calculateRepayment({
      loan_amount: loanAmount,
      annual_rate_pct: rate,
      term_months: termMonths,
      frequency: 'monthly',
    }),
    extra_repayments: calculateExtraRepayments({
      loan_amount: loanAmount,
      annual_rate_pct: rate,
      term_months: termMonths,
      extra_per_period: 200,
      frequency: 'monthly',
    }),
    offset: calculateOffsetBenefit({
      loan_amount: loanAmount,
      annual_rate_pct: rate,
      term_months: termMonths,
      offset_balance: 50_000,
      frequency: 'monthly',
    }),
    borrowing_power: calculateBorrowingPower({
      annual_gross_income: 180_000,
      annual_living_expenses: 55_000,
      monthly_existing_debt_repayments: 0,
      annual_rate_pct: rate,
      term_years: Math.round(termMonths / 12),
    }),
  };
}

/**
 * First-class funding alert for Stage 6 UI — never rely on the client to infer from buried notes.
 * @param {object} calculation
 * @returns {object|null}
 */
function buildFundingAlert(calculation = {}) {
  if (calculation.funding_alert && calculation.funding_alert.bridging_required) {
    return {
      ...calculation.funding_alert,
      requires_user_decision: calculation.funding_alert.requires_user_decision !== false,
      default_path: calculation.funding_alert.default_path || 'refuse_until_clarified',
      bridging_modeling:
        calculation.funding_alert.bridging_modeling
        || calculation.bridging_modeling
        || null,
    };
  }
  const shortfall = Number(
    calculation.deposit_shortfall
    ?? calculation.totals?.deposit_shortfall
    ?? 0
  );
  const required = Boolean(
    calculation.bridging_required
    || calculation.totals?.bridging_required
    || shortfall > 0
  );
  if (!required) return null;
  return {
    bridging_required: true,
    deposit_shortfall: shortfall,
    buy_before_sell: Boolean(calculation.funding_alert?.buy_before_sell),
    severity: 'warning',
    requires_user_decision: true,
    default_path: 'refuse_until_clarified',
    title: 'Funding gap — your decision needed',
    message:
      'This scenario is not fully resolved. Confirm bridging (or other cash) is arranged, '
      + 'or change the timeline / deposit so sale proceeds fund the buy. '
      + (shortfall > 0
        ? `Deposit shortfall: $${shortfall.toLocaleString()}. `
        : 'Sale proceeds are not available when the buy needs them. ')
      + 'Any bridging cost shown is informative only — not a recommendation to bridge.',
    bridging_modeling: calculation.bridging_modeling || null,
  };
}

/**
 * Assemble the Stage 6 presentation payload for a Stage 4 calculation.
 * Optional `liveLenders` / `coverage` from Stage 7 CDR PRD fetch.
 */
function buildPresentationPayload({
  scenario,
  calculation,
  loanAmount,
  rate,
  termMonths,
  liveLenders,
  coverage,
  lenderFetchError,
}) {
  const loan = loanAmount
    || scenario?.events?.find((e) => e.type === 'buy')?.fields?.loan?.balance
    || 1_200_000;
  const term = termMonths
    || scenario?.events?.find((e) => e.type === 'switch_lender')?.fields?.target_loan?.term_remaining_months
    || scenario?.events?.find((e) => e.type === 'buy')?.fields?.loan?.term_remaining_months
    || 360;
  const productRate = rate
    || scenario?.events?.find((e) => e.type === 'switch_lender')?.fields?.target_loan?.rate
    || scenario?.events?.find((e) => e.type === 'buy')?.fields?.loan?.rate
    || 5.29;

  const hasLive = Array.isArray(liveLenders) && liveLenders.length > 0;
  const lenderPack = buildLenderComparison({
    loan_amount: loan,
    term_months: term,
    lenders: hasLive ? liveLenders : undefined,
    data_note: hasLive
      ? (coverage?.summary
        ? `Live CDR PRD: ${coverage.summary}`
        : undefined)
      : (lenderFetchError
        ? `Stub fallback — CDR fetch failed: ${lenderFetchError}`
        : undefined),
  });
  const advice = buildAdviceFromCalculation(calculation);
  const summary = buildScenarioSummaryTable(calculation);
  const funding_alert = buildFundingAlert(calculation);
  const requires_user_decision = Boolean(
    calculation.requires_user_decision || funding_alert?.requires_user_decision
  );

  return {
    scenario_meta: {
      id: scenario?.id,
      title: scenario?.title,
    },
    calculation,
    requires_user_decision,
    ready: calculation.ready === true && !requires_user_decision,
    funding_alert,
    summary_table: summary,
    lenders: {
      rows: lenderPack.lenders,
      data_note: lenderPack.data_note,
      source: lenderPack.source,
    },
    charts: {
      rate_comparison: lenderPack.rate_comparison,
      cumulative_cost: buildCumulativeCostSeries(loan, term, lenderPack.lenders),
      amortization: buildAmortizationSeries(loan, productRate, term),
      break_even: buildBreakEvenSeries(calculation),
    },
    advice,
    calculators: buildCalculatorSnapshots(loan, productRate, term),
    coverage: coverage || null,
    stub_notice: hasLive
      ? null
      : (lenderFetchError
        ? `Lender comparison is using stub data (CDR PRD unavailable: ${lenderFetchError}).`
        : 'Lender rate comparison uses mock/stub data. Pass live=1 / demo refreshes to load CDR PRD.'),
    lender_source: lenderPack.source,
  };
}

module.exports = {
  buildAdviceFromCalculation,
  buildFundingAlert,
  buildScenarioSummaryTable,
  buildLenderComparison,
  buildCumulativeCostSeries,
  buildAmortizationSeries,
  buildBreakEvenSeries,
  buildCalculatorSnapshots,
  buildPresentationPayload,
};
