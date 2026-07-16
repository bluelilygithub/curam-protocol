'use strict';

const express = require('express');
const router = express.Router();

const {
  scenarioSellBuySwitchValid,
} = require('../services/propertyScenario/fixtures');
const { runFromScenario } = require('../services/propertyScenario/runPipeline');
const { buildPresentationPayload } = require('../services/propertyScenario/presentation');
const { MOCK_LENDERS } = require('../services/propertyScenario/mockLenders');
const { getLiveMortgageLenders, clearCdrCache } = require('../services/propertyScenario/cdr');
const { calculateRepayment } = require('../services/propertyScenario/calc/repayment');
const { calculateExtraRepayments } = require('../services/propertyScenario/calc/extraRepayments');
const { calculateOffsetBenefit } = require('../services/propertyScenario/calc/offset');
const { calculateBorrowingPower } = require('../services/propertyScenario/calc/borrowingPower');
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

module.exports = router;
