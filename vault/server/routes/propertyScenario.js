'use strict';

const express = require('express');
const router = express.Router();

const {
  scenarioSellBuySwitchValid,
} = require('../services/propertyScenario/fixtures');
const { runFromScenario } = require('../services/propertyScenario/runPipeline');
const { buildPresentationPayload } = require('../services/propertyScenario/presentation');
const { MOCK_LENDERS } = require('../services/propertyScenario/mockLenders');
const {
  getLiveMortgageLenders,
  peekLiveMortgageLenders,
  clearCdrCache,
  averageOwnerOccupiedVariableRate,
} = require('../services/propertyScenario/cdr');

/** Static fallback when CDR is unavailable — matches long-standing UI placeholder. */
const FALLBACK_MARKET_RATE_PCT = 6.1;
const { calculateRepayment } = require('../services/propertyScenario/calc/repayment');
const { calculateExtraRepayments } = require('../services/propertyScenario/calc/extraRepayments');
const { calculateOffsetBenefit } = require('../services/propertyScenario/calc/offset');
const { calculateBorrowingPower } = require('../services/propertyScenario/calc/borrowingPower');
const { assessBuyerQualification } = require('../services/propertyScenario/calc/buyerQualification');
const { buildEligibleLenderProducts } = require('../services/propertyScenario/calc/eligibleProducts');
const { buildQualificationProforma } = require('../services/propertyScenario/calc/qualificationProforma');
const { executeParse, executeClarify } = require('../services/propertyScenario/wireApi');
const {
  buildInsight,
  compareInsights,
  INSIGHT_DISCLAIMER,
} = require('../services/propertyScenario/insights');

async function loadLiveLenders(req) {
  const force = req.query.refresh === '1' || req.query.force === '1'
    || req.body?.refresh === true || req.body?.refresh === 1;
  try {
    const live = await getLiveMortgageLenders({ forceRefresh: force });
    return { live, error: null };
  } catch (err) {
    return { live: null, error: err.message || String(err) };
  }
}

function httpStatusForWireError(result) {
  if (!result || result.ok) return 200;
  if (result.error === 'invalid_request') return 400;
  // parse_failed / clarify_failed — structured client errors, not unhandled 500s
  return 422;
}

/**
 * GET /api/property-scenario/demo
 * Compound sell→buy→switch + Stage 6 presentation, with live CDR rates when available.
 * Query: refresh=1 to bypass CDR cache.
 */
router.get('/demo', async (req, res) => {
  try {
    const scenario = scenarioSellBuySwitchValid();
    const { calculation, scenario: resolved } = runFromScenario(scenario, {
      clarifications: {
        selling_cost_pct: 0.025,
        resolve_optional: true,
        clear_assumptions: true,
      },
    });

    const { live, error: lenderFetchError } = await loadLiveLenders(req);
    const presentation = buildPresentationPayload({
      scenario: resolved,
      calculation,
      liveLenders: live?.ok ? live.lenders : null,
      coverage: live?.coverage || null,
      lenderFetchError: live?.ok ? null : (lenderFetchError || live?.coverage?.summary || 'no usable live rates'),
    });

    res.json({
      ok: true,
      demo: 'compound_sell_buy_switch',
      ...presentation,
      cdr_fetched_at: live?.fetched_at || null,
      cdr_cache: live?.cache || null,
    });
  } catch (err) {
    console.error('[property-scenario] demo', err);
    res.status(500).json({ error: err.message || 'Failed to build demo presentation' });
  }
});

/**
 * POST /api/property-scenario/parse
 * Body: { text: string, asOf?: string, clarifications?: object, refresh?: boolean }
 * Runs Stage 2–4 via runFromText. LLM/JSON failures return structured { ok:false }.
 */
router.post('/parse', async (req, res) => {
  try {
    const livePack = await loadLiveLenders(req);
    const result = await executeParse(
      {
        text: req.body?.text,
        asOf: req.body?.asOf,
        userId: req.user?.id,
        modelId: req.body?.modelId,
        clarifications: req.body?.clarifications,
      },
      { livePack }
    );

    if (!result.ok) {
      return res.status(httpStatusForWireError(result)).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error('[property-scenario] parse', err);
    return res.status(422).json({
      ok: false,
      error: 'parse_failed',
      message: err.message || 'Failed to parse scenario',
    });
  }
});

/**
 * POST /api/property-scenario/clarify
 * Body: { scenario, answers?, selling_cost_pct?, resolve_optional?, scenario_patch?, ... }
 * Continues the parse → clarify → calculate loop until ready_for_calculations.
 */
router.post('/clarify', async (req, res) => {
  try {
    const livePack = await loadLiveLenders(req);
    const result = await executeClarify(
      {
        scenario: req.body?.scenario,
        answers: req.body?.answers,
        free_text_clarifications: req.body?.free_text_clarifications,
        selling_cost_pct: req.body?.selling_cost_pct,
        resolve_optional: req.body?.resolve_optional,
        clear_assumptions: req.body?.clear_assumptions,
        scenario_patch: req.body?.scenario_patch,
        replace_scenario: req.body?.replace_scenario,
        source_text: req.body?.source_text,
      },
      { livePack }
    );

    if (!result.ok) {
      return res.status(httpStatusForWireError(result)).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error('[property-scenario] clarify', err);
    return res.status(422).json({
      ok: false,
      error: 'clarify_failed',
      message: err.message || 'Failed to apply clarifications',
    });
  }
});

/**
 * GET /api/property-scenario/market-rate
 * Prevailing average owner-occupier variable rate for form defaults.
 * Uses warm CDR cache when available; otherwise stub/fallback immediately.
 * Does not wait on a cold multi-bank CDR fetch (that left rate fields empty).
 */
router.get('/market-rate', async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.force === '1';
    let live = null;
    let error = null;

    if (force) {
      const fetched = await loadLiveLenders(req);
      live = fetched.live;
      error = fetched.error;
    } else {
      live = peekLiveMortgageLenders();
      if (!live?.ok) {
        // Warm cache for later without blocking this response.
        getLiveMortgageLenders().catch(() => {});
      }
    }

    const usingLive = Boolean(live?.ok && (live.lenders || []).length);
    const lenders = usingLive ? live.lenders : MOCK_LENDERS;
    const { rate_pct, sample_size } = averageOwnerOccupiedVariableRate(lenders);
    const rate = rate_pct != null ? rate_pct : FALLBACK_MARKET_RATE_PCT;
    return res.json({
      ok: true,
      rate_pct: rate,
      sample_size: rate_pct != null ? sample_size : 0,
      source: usingLive && rate_pct != null
        ? 'cdr_prd_average'
        : (rate_pct != null ? 'stub_average' : 'fallback'),
      fetched_at: live?.fetched_at || null,
      note: usingLive && rate_pct != null
        ? `Average of ${sample_size} live owner-occupier variable CDR products.`
        : (error
          ? `CDR unavailable (${error}) — using ${rate}%.`
          : `Using ${rate}% (${rate_pct != null ? 'stub average' : 'static fallback'}).`),
    });
  } catch (err) {
    return res.json({
      ok: true,
      rate_pct: FALLBACK_MARKET_RATE_PCT,
      sample_size: 0,
      source: 'fallback',
      fetched_at: null,
      note: err.message || 'Failed to load market rate — using fallback.',
    });
  }
});

/**
 * GET /api/property-scenario/lenders
 * Query: live=1 (default) for CDR PRD; live=0 for stubs; refresh=1 bypass cache.
 */
router.get('/lenders', async (req, res) => {
  const loan = Number(req.query.loan_amount) || 1_200_000;
  const term = Number(req.query.term_months) || 360;
  const wantLive = req.query.live !== '0' && req.query.live !== 'false';
  const { buildLenderComparison } = require('../services/propertyScenario/presentation');

  if (!wantLive) {
    const pack = buildLenderComparison({ loan_amount: loan, term_months: term });
    return res.json({
      ok: true,
      stub: true,
      source: 'stub',
      lenders: pack.lenders,
      note: pack.data_note,
      catalog: MOCK_LENDERS,
    });
  }

  const { live, error } = await loadLiveLenders(req);
  if (!live?.ok) {
    const pack = buildLenderComparison({ loan_amount: loan, term_months: term });
    return res.json({
      ok: true,
      stub: true,
      source: 'stub',
      lenders: pack.lenders,
      note: pack.data_note,
      coverage: live?.coverage || null,
      error: error || live?.coverage?.summary || 'CDR PRD unavailable',
      catalog: MOCK_LENDERS,
    });
  }

  const pack = buildLenderComparison({
    loan_amount: loan,
    term_months: term,
    lenders: live.lenders,
    data_note: live.coverage?.summary,
  });

  res.json({
    ok: true,
    stub: false,
    source: 'cdr_prd',
    lenders: pack.lenders,
    average_variable_rate_pct: averageOwnerOccupiedVariableRate(live.lenders).rate_pct,
    note: pack.data_note,
    coverage: live.coverage,
    fetched_at: live.fetched_at,
    cache: live.cache,
    all_count: live.all_normalized?.length || 0,
  });
});

/** POST /api/property-scenario/cdr/refresh — clear cache and refetch */
router.post('/cdr/refresh', async (_req, res) => {
  try {
    clearCdrCache();
    const live = await getLiveMortgageLenders({ forceRefresh: true });
    res.json({
      ok: live.ok,
      coverage: live.coverage,
      lenders: live.lenders,
      fetched_at: live.fetched_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'CDR refresh failed' });
  }
});

/**
 * Resolve a product from the request body or live CDR cache by id.
 * Insights never touch Scenario/calc — product is CDR-normalized lender row only.
 */
async function resolveInsightProducts(body = {}, req) {
  const livePack = await loadLiveLenders(req);
  const catalog = [
    ...(livePack.live?.lenders || []),
    ...(livePack.live?.all_normalized || []),
  ];
  const byId = new Map();
  catalog.forEach((p) => {
    if (p?.id) byId.set(p.id, p);
    if (p?.product_id) byId.set(String(p.product_id), p);
  });

  const fromBody = [];
  if (body.product && typeof body.product === 'object') fromBody.push(body.product);
  if (Array.isArray(body.products)) {
    body.products.forEach((p) => {
      if (p && typeof p === 'object') fromBody.push(p);
    });
  }

  const ids = []
    .concat(body.product_id ? [body.product_id] : [])
    .concat(Array.isArray(body.product_ids) ? body.product_ids : []);

  const resolved = [...fromBody];
  ids.forEach((id) => {
    const hit = byId.get(id) || byId.get(String(id));
    if (hit && !resolved.some((p) => p.id === hit.id)) resolved.push(hit);
  });

  return { products: resolved, livePack };
}

/**
 * POST /api/property-scenario/insights
 * Body: { question, product? | product_id?, forceRefresh? }
 * Document Q&A — structurally separate from scenario/calc totals.
 */
router.post('/insights', async (req, res) => {
  try {
    const question = req.body?.question;
    const { products } = await resolveInsightProducts(req.body || {}, req);
    const product = products[0];
    if (!product) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_request',
        message: 'product or product_id is required',
        disclaimer: INSIGHT_DISCLAIMER,
      });
    }
    const result = await buildInsight({
      product,
      question,
      userId: req.user?.id,
      modelId: req.body?.modelId,
      forceRefresh: Boolean(req.body?.forceRefresh || req.body?.refresh),
    });
    const status = result.ok ? 200 : (result.error === 'invalid_request' ? 400 : 422);
    return res.status(status).json(result);
  } catch (err) {
    console.error('[property-scenario] insights', err);
    return res.status(422).json({
      ok: false,
      error: 'insight_failed',
      message: err.message || 'Insight request failed',
      disclaimer: INSIGHT_DISCLAIMER,
      findings: [],
      uncited_gaps: [],
    });
  }
});

/**
 * POST /api/property-scenario/insights/compare
 * Body: { question, products? | product_ids? }
 */
router.post('/insights/compare', async (req, res) => {
  try {
    const { products } = await resolveInsightProducts(req.body || {}, req);
    const result = await compareInsights({
      products,
      question: req.body?.question,
      userId: req.user?.id,
      modelId: req.body?.modelId,
      forceRefresh: Boolean(req.body?.forceRefresh || req.body?.refresh),
    });
    const status = result.ok ? 200 : (result.error === 'invalid_request' ? 400 : 422);
    return res.status(status).json(result);
  } catch (err) {
    console.error('[property-scenario] insights/compare', err);
    return res.status(422).json({
      ok: false,
      error: 'insight_failed',
      message: err.message || 'Compare insight failed',
      disclaimer: INSIGHT_DISCLAIMER,
      findings: [],
      uncited_gaps: [],
      disagreements: [],
    });
  }
});

/**
 * POST /api/property-scenario/calculate
 * Body: { scenario: Scenario, selling_cost_pct?: number }
 * Direct orchestration from a pre-built (structured-form) scenario — no LLM parse.
 * Used by single-event structured inputs (refinance, sell, buy) that bypass NLP.
 */
router.post('/calculate', async (req, res) => {
  try {
    const scenario = req.body?.scenario;
    if (!scenario || typeof scenario !== 'object') {
      return res.status(400).json({ ok: false, error: 'invalid_request', message: 'scenario is required' });
    }

    // Load live CDR lenders first — used both for rate substitution and the comparison table
    const { live, error: lenderFetchError } = await loadLiveLenders(req);
    const liveLenders = live?.ok ? live.lenders : null;

    // CDR rate substitution: for switch_lender events where target rate = current rate
    // (CDR comparison mode from the structured form), inject the best live CDR rate.
    let cdrRateUsed = null;
    if (Array.isArray(scenario.events)) {
      for (const event of scenario.events) {
        if (!['switch_lender', 'refinance'].includes(event.type)) continue;
        const fields = event.fields || {};
        const currentRate = fields.current_loan?.rate;
        const targetRate = fields.target_loan?.rate;
        if (!currentRate || (targetRate && targetRate !== currentRate)) continue;

        // target rate same as current — use best CDR rate
        const candidates = (liveLenders || [])
          .filter((l) => Number.isFinite(Number(l.rate)) && Number(l.rate) > 0 && Number(l.rate) < currentRate)
          .sort((a, b) => Number(a.rate) - Number(b.rate));

        if (candidates.length) {
          const best = candidates[0];
          if (!fields.target_loan) fields.target_loan = {};
          fields.target_loan = { ...fields.target_loan, rate: Number(best.rate) };
          // Return full lender objects so the UI can show product name, comparison rate, links
          cdrRateUsed = {
            best: {
              rate: Number(best.rate),
              comparison_rate: best.comparison_rate || null,
              lender: best.lender,
              product: best.name || best.product || null,
              fixed_or_variable: best.fixed_or_variable || null,
              offset: best.offset || false,
              redraw: best.redraw || false,
              upfront_fees: best.upfront_fees || null,
              links: best.links || {},
            },
            // top alternatives (up to 3 more, excluding best)
            alternatives: candidates.slice(1, 4).map((l) => ({
              rate: Number(l.rate),
              comparison_rate: l.comparison_rate || null,
              lender: l.lender,
              product: l.name || l.product || null,
              fixed_or_variable: l.fixed_or_variable || null,
              links: l.links || {},
            })),
          };
        }
      }
    }

    // If CDR substitution found a lender, use its actual published fees for the
    // establishment cost instead of the hardcoded $600 default. Discharge fee
    // is always from the user's current (outgoing) lender — CDR doesn't know
    // that, so it stays at the default $350.
    const cdrEstablishment = cdrRateUsed?.best?.upfront_fees;

    // Pass state so the calc can look up government mortgage registration fees
    // (land titles office fees are state-specific and are a real, certain cost).
    const rfState = req.body?.state || null;

    const refinanceFeeOverrides = {
      ...(cdrEstablishment != null ? { establishment_fee: Number(cdrEstablishment) } : {}),
      ...(rfState ? { state: rfState } : {}),
    };

    const { calculation, scenario: resolved } = runFromScenario(scenario, {
      clarifications: {
        selling_cost_pct: req.body?.selling_cost_pct ?? 0.025,
        resolve_optional: true,
        clear_assumptions: true,
      },
      refinance_fees: refinanceFeeOverrides,
    });
    const presentation = buildPresentationPayload({
      scenario: resolved,
      calculation,
      liveLenders,
      coverage: live?.coverage || null,
      lenderFetchError: live?.ok ? null : (lenderFetchError || live?.coverage?.summary || 'CDR unavailable'),
    });
    return res.json({
      ok: true,
      ready_for_calculations: true,
      scenario: resolved,
      ...presentation,
      cdr_fetched_at: live?.fetched_at || null,
      cdr_rate_used: cdrRateUsed, // null if user supplied their own rate
    });
  } catch (err) {
    console.error('[property-scenario] calculate', err);
    return res.status(422).json({
      ok: false,
      error: 'calculate_failed',
      message: err.message || 'Calculation failed',
    });
  }
});

router.post('/calculators/repayment', (req, res) => {
  res.json(calculateRepayment(req.body || {}));
});

router.post('/calculators/extra-repayments', (req, res) => {
  res.json(calculateExtraRepayments(req.body || {}));
});

router.post('/calculators/offset', (req, res) => {
  res.json(calculateOffsetBenefit(req.body || {}));
});

router.post('/calculators/borrowing-power', (req, res) => {
  res.json(calculateBorrowingPower(req.body || {}));
});

/**
 * POST /api/property-scenario/calculators/buyer-qualify
 * Body matches assessBuyerQualification inputs.
 * Returns deterministic AU mortgage qualification checks — not a credit decision.
 */
router.post('/calculators/buyer-qualify', (req, res) => {
  const body = req.body || {};
  const result = assessBuyerQualification({
    propertyValue:         Number(body.property_value),
    depositAmount:         Number(body.deposit_amount),
    state:                 body.state || null,
    isFhb:                 body.is_fhb === true || body.is_fhb === 'true',
    isPpor:                body.is_ppor !== false && body.is_ppor !== 'false',
    grossAnnualIncome:     Number(body.gross_annual_income),
    partnerGrossIncome:    body.partner_gross_income ? Number(body.partner_gross_income) : 0,
    householdType:         body.household_type || 'single',
    employmentType:        body.employment_type || 'payg_fulltime',
    hasHecs:               body.has_hecs === true || body.has_hecs === 'true',
    monthlyDebtRepayments: body.monthly_debt_repayments ? Number(body.monthly_debt_repayments) : 0,
    monthlyExpenses:       body.monthly_expenses ? Number(body.monthly_expenses) : undefined,
    loanTermYears:         body.loan_term_years ? Number(body.loan_term_years) : 30,
    targetRatePct:         Number(body.target_rate_pct),
    isNewBuild:            body.is_new_build === true || body.is_new_build === 'true',
    applicantAge:          body.applicant_age ? Number(body.applicant_age) : undefined,
    propertyType:          body.property_type_class || undefined,
    grossRentalIncome:     body.gross_rental_income ? Number(body.gross_rental_income) : undefined,
  });
  res.json(result);
});

/**
 * GET /api/property-scenario/calculators/buyer-qualify/eligible-lenders
 * Live CDR products ranked for a buyer who has passed lending checks.
 * Query: loan_amount, term_months, is_ppor=true|false, refresh=1
 */
router.get('/calculators/buyer-qualify/eligible-lenders', async (req, res) => {
  try {
    const loanAmount = Number(req.query.loan_amount) || 0;
    const termMonths = Number(req.query.term_months) || 360;
    const isPpor = req.query.is_ppor !== 'false' && req.query.is_ppor !== '0';
    const { live, error } = await loadLiveLenders(req);

    if (!live?.ok) {
      return res.json({
        ok: false,
        stub: true,
        products: [],
        error: error || live?.coverage?.summary || 'CDR PRD unavailable',
        coverage: live?.coverage || null,
        note: 'Live lender rates unavailable — try again shortly or use Compare live CDR rates.',
      });
    }

    const pack = buildEligibleLenderProducts(live.all_normalized || live.lenders || [], {
      loanAmount,
      termMonths,
      isPpor,
      maxPerBank: 2,
    });

    res.json({
      ok: true,
      stub: false,
      source: 'cdr_prd',
      fetched_at: live.fetched_at,
      cache: live.cache,
      coverage: live.coverage,
      ...pack,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Eligible lenders fetch failed' });
  }
});

/**
 * POST /api/property-scenario/calculators/qualification-proforma
 * Body matches assessBuyerQualification inputs, plus broker-realism fields:
 *   overtime_bonus_annual, overtime_bonus_regularity, self_employed_addbacks_annual,
 *   dependents, credit_card_limits_total, months_in_current_role,
 *   has_adverse_credit, adverse_credit_severity,
 *   genuine_savings_held_months, deposit_gift_amount, liabilities[].
 * Returns { strict, levers, excluded, lenderFit, bankPosture }.
 * Query: live=1 to include a live CDR lender-fit table (default on; live=0 to skip).
 */
router.post('/calculators/qualification-proforma', async (req, res) => {
  const body = req.body || {};
  const liabilities = Array.isArray(body.liabilities)
    ? body.liabilities.map((row) => ({
      type: row.type || 'other',
      label: row.label || row.type || 'Liability',
      monthlyRepayment: row.monthly_repayment != null ? Number(row.monthly_repayment) : Number(row.monthlyRepayment) || 0,
    }))
    : null;
  const inputs = {
    propertyValue:         Number(body.property_value),
    depositAmount:         Number(body.deposit_amount),
    state:                 body.state || null,
    isFhb:                 body.is_fhb === true || body.is_fhb === 'true',
    isPpor:                body.is_ppor !== false && body.is_ppor !== 'false',
    grossAnnualIncome:     Number(body.gross_annual_income),
    partnerGrossIncome:    body.partner_gross_income ? Number(body.partner_gross_income) : 0,
    householdType:         body.household_type || 'single',
    employmentType:        body.employment_type || 'payg_fulltime',
    hasHecs:               body.has_hecs === true || body.has_hecs === 'true',
    monthlyDebtRepayments: body.monthly_debt_repayments ? Number(body.monthly_debt_repayments) : 0,
    monthlyExpenses:       body.monthly_expenses ? Number(body.monthly_expenses) : undefined,
    loanTermYears:         body.loan_term_years ? Number(body.loan_term_years) : 30,
    targetRatePct:         Number(body.target_rate_pct),
    isNewBuild:            body.is_new_build === true || body.is_new_build === 'true',
    applicantAge:          body.applicant_age ? Number(body.applicant_age) : undefined,
    propertyType:          body.property_type_class || undefined,
    grossRentalIncome:     body.gross_rental_income ? Number(body.gross_rental_income) : undefined,
    dependents:            body.dependents ? Number(body.dependents) : 0,
    creditCardLimitsTotal: body.credit_card_limits_total ? Number(body.credit_card_limits_total) : 0,
    monthsInCurrentRole:   body.months_in_current_role != null && body.months_in_current_role !== '' ? Number(body.months_in_current_role) : undefined,
    hasAdverseCredit:      body.has_adverse_credit === true || body.has_adverse_credit === 'true',
    adverseCreditSeverity: body.adverse_credit_severity || undefined,
    overtimeBonusAnnual:        body.overtime_bonus_annual ? Number(body.overtime_bonus_annual) : 0,
    overtimeBonusRegularity:    body.overtime_bonus_regularity || 'irregular',
    selfEmployedAddbacksAnnual: body.self_employed_addbacks_annual ? Number(body.self_employed_addbacks_annual) : 0,
    genuineSavingsHeldMonths: body.genuine_savings_held_months != null && body.genuine_savings_held_months !== ''
      ? Number(body.genuine_savings_held_months) : undefined,
    depositGiftAmount: body.deposit_gift_amount ? Number(body.deposit_gift_amount) : 0,
    liabilities,
  };

  const wantLive = req.query.live !== '0' && req.query.live !== 'false';
  let allNormalized = null;
  let liveError = null;
  if (wantLive) {
    const { live, error } = await loadLiveLenders(req);
    if (live?.ok) allNormalized = live.all_normalized || live.lenders || [];
    else liveError = error || live?.coverage?.summary || null;
  }

  const result = buildQualificationProforma(inputs, allNormalized);
  res.json({ ...result, live_lender_error: liveError });
});

/**
 * POST /api/property-scenario/advice/ask
 * Body: { question: string, calcResult: object, scenarioType: string }
 *
 * Asks a follow-up question grounded in the deterministic calculation results.
 * LLM has the scenario totals and caveats as context. It cannot change numbers —
 * it can only explain and contextualise them.
 */
router.post('/advice/ask', async (req, res) => {
  try {
    const { question, calcResult, scenarioType } = req.body || {};
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ ok: false, error: 'invalid_request', message: 'question is required' });
    }

    const { callModel } = require('../services/callModel');
    const { getModelsForUser } = require('../services/modelResolver');
    const models = await getModelsForUser(req.user?.id);
    const modelId = models.standard || models.light;
    if (!modelId) throw new Error('No model configured');

    const totals = calcResult?.calculation?.totals || {};
    const caveats = (calcResult?.calculation?.caveats || []).slice(0, 5);
    const assumptions = (calcResult?.calculation?.assumptions || []).slice(0, 4);
    const eventSummary = (calcResult?.calculation?.event_results || [])
      .map((e) => `  ${e.sequence}. ${e.type}: costs $${Number(e.costs || 0).toLocaleString('en-AU')}`)
      .join('\n');
    const cdrBank = calcResult?.cdr_rate_used?.best;

    const system = [
      'You are a financial scenario assistant. The user has run a deterministic Australian property',
      'scenario calculation. Your job is to explain and contextualise the results for the specific',
      'question asked. Rules:',
      '1. Ground every answer in the provided numbers — do not invent figures.',
      '2. Be concise: 2–4 short paragraphs unless the question genuinely requires more.',
      '3. Clearly separate what the calculator has already accounted for from what it has not.',
      '4. When relevant, name the specific Australian concept (e.g. "the 50% CGT discount", "APRA',
      '   serviceability buffer") rather than vague descriptions.',
      '5. End every answer with exactly: "This is not financial advice — verify with a licensed',
      '   mortgage broker, accountant, or financial adviser before acting."',
    ].join(' ');

    const prompt = [
      `Scenario type: ${scenarioType || 'property'}`,
      '',
      'Calculation totals (all amounts AUD):',
      Object.entries(totals)
        .filter(([, v]) => v != null && v !== 0)
        .map(([k, v]) => `  ${k}: ${typeof v === 'number' ? `$${Number(v).toLocaleString('en-AU')}` : v}`)
        .join('\n'),
      eventSummary ? `\nEvents:\n${eventSummary}` : '',
      cdrBank ? `\nBest CDR rate: ${cdrBank.rate}% p.a. — ${cdrBank.lender} (${cdrBank.product || 'variable'})` : '',
      caveats.length ? `\nCaveats:\n${caveats.map((c) => `  · ${c}`).join('\n')}` : '',
      assumptions.length ? `\nAssumptions:\n${assumptions.map((a) => `  · ${a}`).join('\n')}` : '',
      '',
      `Question: ${question.trim()}`,
    ].filter((l) => l !== null).join('\n');

    const answer = await callModel(modelId, prompt, { system, maxTokens: 600 });
    return res.json({ ok: true, answer: String(answer).trim() });
  } catch (err) {
    console.error('[property-scenario] advice/ask', err);
    return res.status(422).json({ ok: false, error: 'ask_failed', message: err.message || 'Ask failed' });
  }
});

module.exports = router;
