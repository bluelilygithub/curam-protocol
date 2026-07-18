'use strict';

const { orderedEvents } = require('./scenario');
const { validateScenario } = require('./validate');
const { calculateStampDutyLmi } = require('./calc/stampDutyLmi');
const { calculateCgt } = require('./calc/cgt');
const { calculateRefinanceBreakEven } = require('./calc/refinanceBreakEven');
const { calculateEarlyPayoutBreakCost } = require('./calc/earlyPayout');
const {
  calculateBridgingCost,
  resolveBridgingGapFromScenario,
} = require('./calc/bridgingCost');
const { roundMoney } = require('./calc/tables');
const { cloneScenario } = require('./clarify');

const DEFAULT_SELLING_COST_PCT = 0.025;

/**
 * @typedef {object} CashFlowEntry
 * @property {string} date — ISO date or sequence placeholder
 * @property {string} event_id
 * @property {string} label
 * @property {'in'|'out'|'transfer'} direction
 * @property {number} amount
 * @property {string} category
 * @property {string} [note]
 */

/**
 * Build a mutable ownership / loan ledger from starting_properties.
 * @param {import('./scenario').Scenario} scenario
 */
function buildLedger(scenario) {
  /** @type {Map<string, object>} */
  const properties = new Map();
  (scenario.starting_properties || []).forEach((p) => {
    properties.set(p.id, {
      ...p,
      current_loan: p.current_loan ? { ...p.current_loan } : null,
    });
  });
  return {
    properties,
    /** Remaining net proceeds by originating sell event id */
    proceedsBySellEvent: /** @type {Map<string, number>} */ (new Map()),
    /** Cash pool of sale proceeds available for deposits (sum of unused proceeds) */
    cashFromSales: 0,
  };
}

function eventDate(event, fallbackIndex) {
  const f = event.fields || {};
  return f.settlement_date || f.payout_date || `sequence:${event.sequence || fallbackIndex}`;
}

function propertyMeta(ledger, propertyId) {
  return propertyId ? ledger.properties.get(propertyId) : null;
}

function enrichSellFields(fields, prop) {
  const out = { ...fields };
  if (prop) {
    if (out.purchase_price == null && prop.purchase_price != null) out.purchase_price = prop.purchase_price;
    if (out.purchase_date == null && prop.purchase_date != null) out.purchase_date = prop.purchase_date;
    if (out.was_ever_investment_property == null && typeof prop.was_ever_investment_property === 'boolean') {
      out.was_ever_investment_property = prop.was_ever_investment_property;
    }
    if (out.state == null && prop.state) out.state = prop.state;
    if (out.property_value == null && prop.estimated_value != null) out.property_value = prop.estimated_value;
  }
  return out;
}

/**
 * Resolve deposit for a buy event using funds_deposit dependencies — proceeds must flow
 * from prior sell event results, not be recalculated ad hoc on the buy alone.
 *
 * @returns {{
 *   deposit_amount: number|null,
 *   funded_from_sale_proceeds: number,
 *   proceeds_sources: object[],
 *   shortfall: number,
 *   bridging_required: boolean,
 *   buy_before_sell: boolean,
 *   funding_not_yet_available: boolean,
 *   notes: string[],
 * }}
 */
function resolveDepositFromDependencies(event, scenario, ledger, eventResultsById) {
  const notes = [];
  const proceeds_sources = [];
  const deps = (scenario.dependencies || []).filter(
    (d) => d.to_event_id === event.id && d.kind === 'funds_deposit'
  );

  let available = 0;
  let funding_not_yet_available = false;
  let buy_before_sell = false;

  deps.forEach((d) => {
    const fromEvent = (scenario.events || []).find((e) => e.id === d.from_event_id);
    const fromResult = eventResultsById.get(d.from_event_id);

    if (!fromResult) {
      funding_not_yet_available = true;
      if (
        fromEvent
        && Number.isFinite(Number(fromEvent.sequence))
        && Number.isFinite(Number(event.sequence))
        && Number(fromEvent.sequence) > Number(event.sequence)
      ) {
        buy_before_sell = true;
        notes.push(
          `Buy (${event.id}) is sequenced before funding sell (${d.from_event_id}) — sale proceeds are not available at buy time (bridging / other funds needed).`
        );
      } else {
        notes.push(
          `funds_deposit from ${d.from_event_id}: prior sell has not run yet — deposit cannot be funded from that event at this step.`
        );
      }
    }

    const fromProceeds = fromResult?.outputs?.net_sale_proceeds;
    // Prefer unused remainder on that sell event’s pool; fall back to ledger map
    let remaining = ledger.proceedsBySellEvent.has(d.from_event_id)
      ? ledger.proceedsBySellEvent.get(d.from_event_id)
      : fromProceeds;
    if (remaining == null || !Number.isFinite(Number(remaining))) {
      if (fromResult) {
        notes.push(
          `funds_deposit from ${d.from_event_id}: prior sell net_sale_proceeds unavailable — deposit cannot be funded from that event.`
        );
      }
      remaining = 0;
    }
    available += Number(remaining);
    proceeds_sources.push({
      from_event_id: d.from_event_id,
      dependency_id: d.id,
      available: roundMoney(Number(remaining)),
      note: d.note || null,
      sell_completed: Boolean(fromResult),
    });
  });

  const stated = event.fields?.deposit_amount != null ? Number(event.fields.deposit_amount) : null;
  let deposit_amount = stated;
  let funded_from_sale_proceeds = 0;

  if (deps.length) {
    if (!Number.isFinite(deposit_amount) || deposit_amount == null) {
      // No stated deposit — use all available proceeds as deposit fuel (capped later by price)
      deposit_amount = available > 0 ? roundMoney(available) : null;
      if (available > 0) {
        notes.push(
          'deposit_amount was not stated; used net sale proceeds flowing through funds_deposit dependency.'
        );
      } else if (funding_not_yet_available || buy_before_sell) {
        notes.push(
          'deposit_amount was not stated and no sale proceeds are available yet — cannot fund deposit from this sale without bridging or other cash.'
        );
      }
    }
    if (Number.isFinite(deposit_amount) && deposit_amount > 0) {
      funded_from_sale_proceeds = roundMoney(Math.min(deposit_amount, available));
      // Draw down pools in dependency order
      let need = funded_from_sale_proceeds;
      deps.forEach((d) => {
        if (need <= 0) return;
        const have = ledger.proceedsBySellEvent.get(d.from_event_id) || 0;
        const take = Math.min(have, need);
        ledger.proceedsBySellEvent.set(d.from_event_id, roundMoney(have - take));
        ledger.cashFromSales = roundMoney(Math.max(0, ledger.cashFromSales - take));
        need = roundMoney(need - take);
      });
      notes.push(
        `Deposit $${deposit_amount.toLocaleString()} funded $${funded_from_sale_proceeds.toLocaleString()} from prior sale proceeds (dependency flow).`
      );
    }
  }

  let shortfall =
    Number.isFinite(deposit_amount) && deposit_amount > available && deps.length
      ? roundMoney(deposit_amount - available)
      : 0;

  // Buy-before-sell with no stated deposit: still flag bridging (unknown deposit need)
  if (deps.length && (buy_before_sell || funding_not_yet_available) && shortfall <= 0 && available <= 0) {
    if (Number.isFinite(deposit_amount) && deposit_amount > 0) {
      shortfall = roundMoney(deposit_amount);
    } else {
      // deposit_amount was never stated (not even inferred from proceeds, since none are
      // available) — do not silently report a $0 funding gap. Infer the real cash needed
      // at settlement from purchase price minus the new loan amount (deposit ≈ price − loan);
      // fall back to the full purchase price if no loan is stated (assume all-cash).
      const impliedPropertyValue = event.fields?.property_value != null
        ? Number(event.fields.property_value)
        : null;
      const impliedLoanAmount = event.fields?.loan?.balance != null
        ? Number(event.fields.loan.balance)
        : null;
      if (Number.isFinite(impliedPropertyValue) && impliedPropertyValue > 0) {
        const impliedDeposit = Number.isFinite(impliedLoanAmount)
          ? Math.max(0, roundMoney(impliedPropertyValue - impliedLoanAmount))
          : roundMoney(impliedPropertyValue);
        if (impliedDeposit > 0) {
          deposit_amount = impliedDeposit;
          shortfall = impliedDeposit;
          notes.push(
            'deposit_amount was not stated; inferred required cash at settlement as '
            + `property_value ($${impliedPropertyValue.toLocaleString()})`
            + (Number.isFinite(impliedLoanAmount)
              ? ` minus loan amount ($${impliedLoanAmount.toLocaleString()})`
              : ' (no loan amount stated — assumed full cash purchase)')
            + ` = $${impliedDeposit.toLocaleString()}, since sale proceeds are not available at buy time.`
          );
        }
      }
    }
  }

  if (shortfall > 0) {
    notes.push(
      `Sale proceeds shortfall of $${shortfall.toLocaleString()} vs stated deposit — gap must be funded from other sources.`
    );
  }

  const bridging_required = Boolean(
    deps.length && (shortfall > 0 || buy_before_sell || funding_not_yet_available)
  );

  return {
    deposit_amount: Number.isFinite(deposit_amount) ? deposit_amount : null,
    funded_from_sale_proceeds,
    proceeds_sources,
    shortfall,
    bridging_required,
    buy_before_sell,
    funding_not_yet_available,
    notes,
  };
}

function pushFlows(flows, entries) {
  entries.forEach((e) => {
    if (e.amount == null || !Number.isFinite(e.amount) || e.amount === 0) return;
    flows.push({ ...e, amount: roundMoney(Math.abs(e.amount)) });
  });
}

function processSell(event, scenario, ledger, opts) {
  const caveats = [];
  const assumptions = [];
  const errors = [];
  const cash_flows = [];
  const propId = event.fields?.property_id;
  const prop = propertyMeta(ledger, propId);
  const fields = enrichSellFields(event.fields || {}, prop);
  const date = eventDate(event);

  const cgt = calculateCgt(fields, { sale_date: fields.settlement_date });
  caveats.push(...(cgt.caveats || []));
  assumptions.push(...(cgt.assumptions || []));
  errors.push(...(cgt.errors || []));

  const salePrice = Number(fields.property_value);
  const loanBal = Number(prop?.current_loan?.balance);
  const discharge = Number.isFinite(loanBal) && loanBal > 0 ? loanBal : 0;

  let sellingCosts = fields.selling_costs != null ? Number(fields.selling_costs) : null;
  if (!Number.isFinite(sellingCosts)) {
    const pct = opts.selling_cost_pct != null ? Number(opts.selling_cost_pct) : DEFAULT_SELLING_COST_PCT;
    if (Number.isFinite(salePrice) && salePrice > 0) {
      sellingCosts = roundMoney(salePrice * pct);
      assumptions.push(
        `Selling costs not provided — assumed ${(pct * 100).toFixed(1)}% of sale price = $${sellingCosts.toLocaleString()}.`
      );
    } else {
      sellingCosts = 0;
      caveats.push('Could not estimate selling costs (missing sale price).');
    }
  }

  let netProceeds = null;
  if (Number.isFinite(salePrice)) {
    netProceeds = roundMoney(salePrice - discharge - sellingCosts);
    if (netProceeds < 0) {
      caveats.push('Net sale proceeds negative after loan discharge and selling costs — check sale price / balance.');
    }
  } else {
    errors.push('sell.property_value required to compute net proceeds');
  }

  pushFlows(cash_flows, [
    {
      date,
      event_id: event.id,
      label: event.label || 'Sell',
      direction: 'in',
      amount: salePrice,
      category: 'sale_price',
      note: 'Gross sale consideration',
    },
    {
      date,
      event_id: event.id,
      label: event.label || 'Sell',
      direction: 'out',
      amount: discharge,
      category: 'loan_discharge',
      note: prop?.current_loan?.lender
        ? `Discharge ${prop.current_loan.lender} mortgage`
        : 'Discharge existing mortgage',
    },
    {
      date,
      event_id: event.id,
      label: event.label || 'Sell',
      direction: 'out',
      amount: sellingCosts,
      category: 'selling_costs',
      note: 'Agent / conveyancing / marketing (estimate)',
    },
  ]);

  if (cgt.ok && cgt.taxable_capital_gain_estimate > 0) {
    pushFlows(cash_flows, [
      {
        date,
        event_id: event.id,
        label: event.label || 'Sell',
        direction: 'out',
        amount: cgt.taxable_capital_gain_estimate,
        category: 'cgt_taxable_gain_estimate',
        note: 'Taxable capital gain estimate (not cash at settlement — tax payable later; not final CGT liability)',
      },
    ]);
    caveats.push(
      'Taxable CGT estimate is listed on the cash-flow timeline for visibility; actual tax cash timing and rate depend on the taxpayer.'
    );
  }

  if (Number.isFinite(netProceeds)) {
    ledger.proceedsBySellEvent.set(event.id, netProceeds);
    ledger.cashFromSales = roundMoney(ledger.cashFromSales + netProceeds);
  }

  if (propId && ledger.properties.has(propId)) {
    ledger.properties.delete(propId);
  }

  return {
    ok: cgt.ok && errors.length === 0,
    module: 'cgt+proceeds',
    outputs: {
      cgt,
      sale_price: Number.isFinite(salePrice) ? salePrice : null,
      loan_discharged: discharge,
      selling_costs: sellingCosts,
      net_sale_proceeds: netProceeds,
    },
    cash_flows,
    caveats,
    assumptions,
    errors,
    // Selling costs are settlement cash costs; taxable CGT estimate is tracked but not
    // treated as cash-at-settlement tax (rate unknown) — listed under cost_breakdown only.
    costs: roundMoney(sellingCosts),
    cost_breakdown: {
      selling_costs: sellingCosts,
      taxable_cgt_estimate: cgt.taxable_capital_gain_estimate || 0,
    },
    benefits: {
      main_residence_exempt_gain: cgt.main_residence_exempt ? (cgt.capital_gain_gross || 0) : 0,
    },
  };
}

function processBuy(event, scenario, ledger, eventResultsById, opts) {
  const caveats = [];
  const assumptions = [];
  const errors = [];
  const cash_flows = [];
  const date = eventDate(event);
  const fields = { ...(event.fields || {}) };

  const depositFlow = resolveDepositFromDependencies(event, scenario, ledger, eventResultsById);
  assumptions.push(...depositFlow.notes);
  if (depositFlow.bridging_required) {
    const shortMsg = depositFlow.shortfall > 0
      ? `Deposit shortfall $${depositFlow.shortfall.toLocaleString()}. `
      : '';
    caveats.push(
      `BRIDGING / FUNDING GAP: ${shortMsg}`
      + (depositFlow.buy_before_sell
        ? 'Buy settles (or is sequenced) before the funding sale — sale proceeds are not available at buy time. '
        : 'Sale proceeds cannot fully fund the stated deposit at this step. ')
      + 'Do not treat this purchase as fully funded from the linked sale without bridging finance or other cash. '
      + 'See bridging_modeling: default path is refuse-until-clarified; any bridging cost figure is indicative only.'
    );
  } else if (depositFlow.shortfall > 0) {
    caveats.push(
      `Deposit shortfall $${depositFlow.shortfall.toLocaleString()} after applying funds_deposit proceeds.`
    );
  }

  if (depositFlow.deposit_amount != null) {
    fields.deposit_amount = depositFlow.deposit_amount;
  }

  const stamp = calculateStampDutyLmi(fields, {
    loan_amount: fields.loan?.balance,
  });
  caveats.push(...(stamp.caveats || []));
  assumptions.push(...(stamp.assumptions || []));
  errors.push(...(stamp.errors || []));

  const purchasePrice = Number(fields.property_value);
  const loanAmt = fields.loan?.balance != null ? Number(fields.loan.balance) : null;
  const deposit = depositFlow.deposit_amount;
  const stampDuty = stamp.stamp_duty_payable || 0;
  const lmi = stamp.lmi_estimate || 0;

  // Settlement cash view: purchase funded by deposit + loan; stamp/LMI are extra cash out
  pushFlows(cash_flows, [
    {
      date,
      event_id: event.id,
      label: event.label || 'Buy',
      direction: 'out',
      amount: purchasePrice,
      category: 'purchase_price',
      note: 'Purchase consideration',
    },
    {
      date,
      event_id: event.id,
      label: event.label || 'Buy',
      direction: 'in',
      amount: loanAmt,
      category: 'loan_drawdown',
      note: fields.loan?.lender ? `New loan — ${fields.loan.lender}` : 'New loan drawdown',
    },
    {
      date,
      event_id: event.id,
      label: event.label || 'Buy',
      direction: 'transfer',
      amount: depositFlow.funded_from_sale_proceeds,
      category: 'deposit_from_sale_proceeds',
      note: 'Deposit funded from prior sale proceeds (dependency flow — not new cash)',
    },
    {
      date,
      event_id: event.id,
      label: event.label || 'Buy',
      direction: 'out',
      amount:
        Number.isFinite(deposit) && deposit > depositFlow.funded_from_sale_proceeds
          ? roundMoney(deposit - depositFlow.funded_from_sale_proceeds)
          : 0,
      category: 'deposit_other_funds',
      note: 'Deposit portion from savings / other (beyond sale proceeds)',
    },
    {
      date,
      event_id: event.id,
      label: event.label || 'Buy',
      direction: 'out',
      amount: stampDuty,
      category: 'stamp_duty',
      note: `Stamp duty (${fields.state || 'state TBD'})`,
    },
    {
      date,
      event_id: event.id,
      label: event.label || 'Buy',
      direction: 'out',
      amount: lmi,
      category: 'lmi',
      note: 'Lenders Mortgage Insurance estimate',
    },
  ]);

  const newId = fields.property_id;
  if (newId) {
    ledger.properties.set(newId, {
      id: newId,
      label: event.label || newId,
      state: fields.state,
      estimated_value: purchasePrice,
      purchase_price: purchasePrice,
      purchase_date: fields.settlement_date,
      was_ever_investment_property: false,
      current_loan: fields.loan ? { ...fields.loan, property_id: newId } : null,
    });
  }

  const upfront = roundMoney(stampDuty + lmi);
  return {
    ok: stamp.ok && errors.length === 0,
    module: 'stampDutyLmi',
    outputs: {
      stamp_duty_lmi: stamp,
      deposit_flow: depositFlow,
      deposit_amount: deposit,
      funded_from_sale_proceeds: depositFlow.funded_from_sale_proceeds,
      deposit_shortfall: depositFlow.shortfall,
      bridging_required: depositFlow.bridging_required,
      buy_before_sell: depositFlow.buy_before_sell,
    },
    cash_flows,
    caveats,
    assumptions,
    errors,
    costs: upfront,
    cost_breakdown: {
      stamp_duty: stampDuty,
      lmi,
    },
    benefits: {
      fhb_concession_amount: stamp.fhb_concession_amount || 0,
    },
    dependencies_applied: depositFlow.proceeds_sources.map((s) => ({
      ...s,
      to_event_id: event.id,
      kind: 'funds_deposit',
      amount_flowed: depositFlow.funded_from_sale_proceeds,
    })),
  };
}

function processRefinanceLike(event, ledger, opts) {
  const caveats = [];
  const assumptions = [];
  const errors = [];
  const cash_flows = [];
  const date = eventDate(event);
  const fields = { ...(event.fields || {}) };
  const prop = propertyMeta(ledger, fields.property_id);

  // Prefer ledger loan as current if event omitted balances
  if (prop?.current_loan && !fields.current_loan) {
    fields.current_loan = { ...prop.current_loan };
  }

  const refi = calculateRefinanceBreakEven(fields, opts.refinance_fees || {});
  caveats.push(...(refi.caveats || []));
  assumptions.push(...(refi.assumptions || []));
  errors.push(...(refi.errors || []));

  let breakCostResult = null;
  const current = fields.current_loan || {};
  if (current.fixed_or_variable === 'fixed') {
    const comparison =
      opts.comparison_rate != null
        ? Number(opts.comparison_rate)
        : fields.target_loan?.rate != null
          ? Number(fields.target_loan.rate)
          : null;
    breakCostResult = calculateEarlyPayoutBreakCost(
      { current_loan: current, fixed_period_remaining_months: current.fixed_period_remaining_months },
      {
        comparison_rate: comparison,
        was_ever_investment_property: prop?.was_ever_investment_property,
      }
    );
    caveats.push(...(breakCostResult.caveats || []));
    assumptions.push(...(breakCostResult.assumptions || []));
    errors.push(...(breakCostResult.errors || []));
    assumptions.push(
      'Fixed→refi/switch: break cost estimated using target rate as comparison_rate when not overridden.'
    );
  }

  const upfront = refi.upfront_cost || 0;
  const breakCost = breakCostResult?.break_cost_estimate || 0;

  pushFlows(cash_flows, [
    {
      date,
      event_id: event.id,
      label: event.label || event.type,
      direction: 'out',
      amount: upfront,
      category: 'refinance_fees',
      note: 'Discharge / establishment / other refinance costs',
    },
    {
      date,
      event_id: event.id,
      label: event.label || event.type,
      direction: 'out',
      amount: breakCost,
      category: 'break_cost',
      note: 'Fixed-rate early-repayment / IRD estimate',
    },
  ]);

  if (fields.property_id && ledger.properties.has(fields.property_id) && fields.target_loan) {
    const p = ledger.properties.get(fields.property_id);
    p.current_loan = { ...fields.target_loan, property_id: fields.property_id };
  }

  const monthlySaving = refi.monthly_saving > 0 ? refi.monthly_saving : 0;

  return {
    ok: refi.ok && (!breakCostResult || breakCostResult.ok) && errors.length === 0,
    module: event.type === 'switch_lender' ? 'switch_lender' : 'refinance',
    outputs: {
      refinance_break_even: refi,
      break_cost: breakCostResult,
    },
    cash_flows,
    caveats,
    assumptions,
    errors,
    costs: roundMoney(upfront + breakCost),
    cost_breakdown: {
      refinance_fees: upfront,
      break_cost: breakCost,
    },
    benefits: {
      monthly_repayment_saving: monthlySaving,
      break_even_months: refi.break_even_months,
    },
  };
}

function processEarlyPayout(event, ledger, opts) {
  const caveats = [];
  const assumptions = [];
  const errors = [];
  const cash_flows = [];
  const date = eventDate(event);
  const fields = { ...(event.fields || {}) };
  const prop = propertyMeta(ledger, fields.property_id);

  if (prop?.current_loan && !fields.current_loan) {
    fields.current_loan = { ...prop.current_loan };
  }

  const comparisonProvided = opts.comparison_rate != null;
  const comparison =
    opts.comparison_rate != null
      ? Number(opts.comparison_rate)
      : fields.current_loan?.rate != null
        ? Number(fields.current_loan.rate)
        : null;

  const payout = calculateEarlyPayoutBreakCost(fields, {
    comparison_rate: comparison,
    remaining_fixed_months: fields.fixed_period_remaining_months,
    was_ever_investment_property: prop?.was_ever_investment_property,
  });
  caveats.push(...(payout.caveats || []));
  assumptions.push(...(payout.assumptions || []));
  errors.push(...(payout.errors || []));

  // BUG (Round 3): when no comparison_rate was supplied, the orchestrator silently
  // defaulted it to the loan's OWN contract rate — always yielding IRD=0 with a caveat
  // ("Comparison rate ≥ contract rate — IRD estimated at $0") that reads like a real
  // market comparison was made, when in fact no market rate was ever supplied. Mirror
  // processRefinanceLike's existing disclosure pattern so this default is visible.
  if (!comparisonProvided && fields.current_loan?.fixed_or_variable === 'fixed' && comparison != null) {
    assumptions.push(
      'No market comparison_rate was supplied for this early payout — defaulted to the loan\'s own contract rate, '
      + 'which always shows $0 IRD break cost. This does NOT mean breaking the fixed loan is free; '
      + 'provide a real comparison/market rate for an accurate break-cost estimate.'
    );
  }

  const principal = Number(fields.current_loan?.balance) || 0;
  const breakCost = payout.break_cost_estimate || 0;

  pushFlows(cash_flows, [
    {
      date,
      event_id: event.id,
      label: event.label || 'Early payout',
      direction: 'out',
      amount: principal,
      category: 'loan_payout_principal',
      note: 'Principal repaid to clear loan',
    },
    {
      date,
      event_id: event.id,
      label: event.label || 'Early payout',
      direction: 'out',
      amount: breakCost,
      category: 'break_cost',
      note: 'Break cost / discharge estimate',
    },
  ]);

  if (fields.property_id && ledger.properties.has(fields.property_id)) {
    ledger.properties.get(fields.property_id).current_loan = null;
  }

  return {
    ok: payout.ok && errors.length === 0,
    module: 'earlyPayout',
    outputs: { early_payout: payout },
    cash_flows,
    caveats,
    assumptions,
    errors,
    costs: roundMoney(breakCost),
    cost_breakdown: {
      break_cost: breakCost,
      principal_repaid: principal,
    },
    benefits: {
      loan_cleared: principal,
    },
  };
}

/**
 * Run Stage 3 modules across a fully-resolved Scenario in event order.
 *
 * @param {import('./scenario').Scenario} inputScenario
 * @param {object} [opts]
 * @param {boolean} [opts.force] — run even with required unresolved assumptions
 * @param {number} [opts.selling_cost_pct]
 * @param {number} [opts.comparison_rate]
 * @param {object} [opts.refinance_fees]
 * @returns {object} combined result
 */
function runScenario(inputScenario, opts = {}) {
  const scenario = cloneScenario(inputScenario);
  const caveats = [];
  const assumptions = [];
  const blocking_errors = [];

  const requiredOpen = (scenario.unresolved_assumptions || []).filter(
    (a) => a.severity !== 'optional'
  );
  if (requiredOpen.length && !opts.force) {
    return {
      ok: false,
      ready: false,
      requires_user_decision: false,
      scenario_id: scenario.id,
      title: scenario.title,
      currency: scenario.currency || 'AUD',
      blocking_errors: [
        `Scenario has ${requiredOpen.length} required unresolved assumption(s) — answer clarifying questions before calculation.`,
      ],
      unresolved_assumptions: requiredOpen,
      event_results: [],
      cash_flow_timeline: [],
      totals: emptyTotals(),
      caveats: [],
      assumptions: [],
      dependencies_applied: [],
    };
  }

  if (requiredOpen.length && opts.force) {
    caveats.push(
      `force=true: running with ${requiredOpen.length} required assumption(s) still open — results may be incomplete.`
    );
  }

  const structural = validateScenario(scenario, { draft: false });
  if (!structural.ok && !opts.force) {
    return {
      ok: false,
      ready: false,
      requires_user_decision: false,
      scenario_id: scenario.id,
      title: scenario.title,
      currency: scenario.currency || 'AUD',
      blocking_errors: structural.errors.map(
        (e) => `[${e.code}] ${e.path || ''}: ${e.message}`
      ),
      validation: structural,
      event_results: [],
      cash_flow_timeline: [],
      totals: emptyTotals(),
      caveats: [],
      assumptions: [],
      dependencies_applied: [],
    };
  }
  if (!structural.ok && opts.force) {
    blocking_errors.push(...structural.errors.map((e) => `[${e.code}] ${e.path || ''}: ${e.message}`));
    caveats.push('force=true: structural validation failed — orchestrator continued anyway.');
  }

  const ledger = buildLedger(scenario);
  const events = orderedEvents(scenario);
  /** @type {Map<string, object>} */
  const eventResultsById = new Map();
  const event_results = [];
  const cash_flow_timeline = [];
  const dependencies_applied = [];

  let totalCosts = 0;
  let totalBenefitsCash = 0;
  let monthlySaving = 0;
  let stampDutyTotal = 0;
  let lmiTotal = 0;
  let refinanceFeesTotal = 0;
  let breakCostsTotal = 0;
  let sellingCostsTotal = 0;
  let taxableCgtTotal = 0;
  let mreExemptGain = 0;
  let saleProceedsGenerated = 0;
  let depositFromSale = 0;
  let depositShortfallTotal = 0;
  let bridgingRequired = false;
  let buyBeforeSellDetected = false;

  events.forEach((event, idx) => {
    let result;
    switch (event.type) {
      case 'sell':
        result = processSell(event, scenario, ledger, opts);
        break;
      case 'buy':
        result = processBuy(event, scenario, ledger, eventResultsById, opts);
        break;
      case 'refinance':
      case 'switch_lender':
        result = processRefinanceLike(event, ledger, opts);
        break;
      case 'early_payout':
        result = processEarlyPayout(event, ledger, opts);
        break;
      default:
        result = {
          ok: false,
          module: 'unknown',
          outputs: {},
          cash_flows: [],
          caveats: [],
          assumptions: [],
          errors: [`Unsupported event type: ${event.type}`],
          costs: 0,
          cost_breakdown: {},
          benefits: {},
        };
    }

    caveats.push(...(result.caveats || []));
    assumptions.push(...(result.assumptions || []));
    if (result.dependencies_applied) {
      dependencies_applied.push(...result.dependencies_applied);
    }

    const entry = {
      event_id: event.id,
      type: event.type,
      sequence: event.sequence,
      label: event.label || null,
      date: eventDate(event, idx + 1),
      ok: result.ok,
      module: result.module,
      outputs: result.outputs,
      cash_flows: result.cash_flows,
      costs: result.costs || 0,
      cost_breakdown: result.cost_breakdown || {},
      benefits: result.benefits || {},
      errors: result.errors || [],
    };
    event_results.push(entry);
    eventResultsById.set(event.id, entry);
    cash_flow_timeline.push(...result.cash_flows);

    totalCosts = roundMoney(totalCosts + (result.costs || 0));
    const cb = result.cost_breakdown || {};
    stampDutyTotal = roundMoney(stampDutyTotal + (cb.stamp_duty || 0));
    lmiTotal = roundMoney(lmiTotal + (cb.lmi || 0));
    refinanceFeesTotal = roundMoney(refinanceFeesTotal + (cb.refinance_fees || 0));
    breakCostsTotal = roundMoney(breakCostsTotal + (cb.break_cost || 0));
    sellingCostsTotal = roundMoney(sellingCostsTotal + (cb.selling_costs || 0));
    taxableCgtTotal = roundMoney(taxableCgtTotal + (cb.taxable_cgt_estimate || 0));

    const ben = result.benefits || {};
    if (ben.main_residence_exempt_gain) {
      mreExemptGain = roundMoney(mreExemptGain + ben.main_residence_exempt_gain);
      totalBenefitsCash = roundMoney(totalBenefitsCash + ben.main_residence_exempt_gain);
    }
    if (ben.fhb_concession_amount) {
      totalBenefitsCash = roundMoney(totalBenefitsCash + ben.fhb_concession_amount);
    }
    if (ben.monthly_repayment_saving) {
      monthlySaving = roundMoney(monthlySaving + ben.monthly_repayment_saving);
    }
    if (result.outputs?.net_sale_proceeds) {
      saleProceedsGenerated = roundMoney(saleProceedsGenerated + result.outputs.net_sale_proceeds);
    }
    if (result.outputs?.funded_from_sale_proceeds) {
      depositFromSale = roundMoney(depositFromSale + result.outputs.funded_from_sale_proceeds);
    }
    if (result.outputs?.deposit_shortfall) {
      depositShortfallTotal = roundMoney(depositShortfallTotal + result.outputs.deposit_shortfall);
    }
    if (result.outputs?.bridging_required) bridgingRequired = true;
    if (result.outputs?.buy_before_sell) buyBeforeSellDetected = true;

    if (!result.ok) {
      blocking_errors.push(
        `Event ${event.id} (${event.type}): ${(result.errors || []).join('; ') || 'module returned ok=false'}`
      );
    }
  });

  // Remaining unused sale proceeds
  let unusedProceeds = 0;
  ledger.proceedsBySellEvent.forEach((v) => {
    unusedProceeds = roundMoney(unusedProceeds + (v || 0));
  });

  let bridging_modeling = null;
  let requires_user_decision = false;

  if (bridgingRequired) {
    requires_user_decision = true;
    const gap = resolveBridgingGapFromScenario(scenario, event_results);
    // Prefer the scenario's own loan rate as the SVR reference when available
    const buyEv = event_results.find((e) => e.type === 'buy' && e.outputs?.bridging_required);
    const buyFields = (scenario.events || []).find((e) => e.id === buyEv?.event_id)?.fields;
    const refRate = buyFields?.loan?.rate != null
      ? Number(buyFields.loan.rate)
      : opts.bridging_base_rate_pct;

    bridging_modeling = calculateBridgingCost({
      shortfall_amount: depositShortfallTotal,
      gap_days: gap.gap_days,
      gap_assumed: gap.gap_assumed,
      buy_before_sell: buyBeforeSellDetected,
      base_variable_rate_pct: Number.isFinite(refRate) ? refRate : opts.bridging_base_rate_pct,
      bridge_margin_pp: opts.bridging_margin_pp,
    });
    caveats.push(...(bridging_modeling.caveats || []));
    assumptions.push(...(bridging_modeling.assumptions || []));
    assumptions.push(...(gap.notes || []));
  }

  const funding_alert = bridgingRequired
    ? {
        bridging_required: true,
        deposit_shortfall: depositShortfallTotal,
        buy_before_sell: buyBeforeSellDetected,
        severity: 'warning',
        requires_user_decision: true,
        default_path: 'refuse_until_clarified',
        title: 'Funding gap — your decision needed',
        message:
          'This scenario is not fully resolved. Confirm bridging (or other cash) is arranged, '
          + 'or change the timeline / deposit so sale proceeds fund the buy — before treating '
          + 'the combined result as complete. '
          + (depositShortfallTotal > 0
            ? `Deposit shortfall: $${depositShortfallTotal.toLocaleString()}. `
            : 'Sale proceeds are not available when the buy needs them. ')
          + (buyBeforeSellDetected
            ? 'Buy is sequenced before the funding sell (buy-before-sell). '
            : '')
          + 'Any bridging cost shown is informative only — not a recommendation to bridge.',
        bridging_modeling,
      }
    : null;

  return {
    ok: blocking_errors.length === 0,
    // Modules may have run, but a funding gap means the combined result is not final
    // until the user decides (mirrors Stage 2 ready_for_calculations discipline).
    ready: blocking_errors.length === 0 && !requires_user_decision,
    requires_user_decision,
    scenario_id: scenario.id,
    title: scenario.title,
    currency: scenario.currency || 'AUD',
    event_results,
    cash_flow_timeline,
    bridging_required: bridgingRequired,
    deposit_shortfall: depositShortfallTotal,
    bridging_modeling,
    funding_alert,
    totals: {
      total_costs: totalCosts,
      total_savings_benefits: roundMoney(totalBenefitsCash + monthlySaving),
      /** One-off modelled benefits (MRE-exempt gain display, FHB concession) */
      one_off_benefits: totalBenefitsCash,
      monthly_repayment_saving: monthlySaving,
      annualised_repayment_saving: roundMoney(monthlySaving * 12),
      stamp_duty: stampDutyTotal,
      lmi: lmiTotal,
      selling_costs: sellingCostsTotal,
      refinance_fees: refinanceFeesTotal,
      break_costs: breakCostsTotal,
      taxable_cgt_estimate: taxableCgtTotal,
      main_residence_exempt_gain: mreExemptGain,
      sale_proceeds_generated: saleProceedsGenerated,
      deposit_funded_from_sale: depositFromSale,
      unused_sale_proceeds: unusedProceeds,
      deposit_shortfall: depositShortfallTotal,
      bridging_required: bridgingRequired,
    },
    caveats: uniqueStrings(caveats),
    assumptions: uniqueStrings(assumptions),
    dependencies_applied,
    blocking_errors,
    remaining_owned_properties: [...ledger.properties.values()].map((p) => ({
      id: p.id,
      label: p.label,
      state: p.state,
      loan_balance: p.current_loan?.balance ?? null,
      lender: p.current_loan?.lender ?? null,
    })),
  };
}

function emptyTotals() {
  return {
    total_costs: 0,
    total_savings_benefits: 0,
    one_off_benefits: 0,
    monthly_repayment_saving: 0,
    annualised_repayment_saving: 0,
    stamp_duty: 0,
    lmi: 0,
    selling_costs: 0,
    refinance_fees: 0,
    break_costs: 0,
    taxable_cgt_estimate: 0,
    main_residence_exempt_gain: 0,
    sale_proceeds_generated: 0,
    deposit_funded_from_sale: 0,
    unused_sale_proceeds: 0,
    deposit_shortfall: 0,
    bridging_required: false,
  };
}

function uniqueStrings(arr) {
  const seen = new Set();
  const out = [];
  (arr || []).forEach((s) => {
    const key = String(s);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
}

module.exports = {
  runScenario,
  resolveDepositFromDependencies,
  DEFAULT_SELLING_COST_PCT,
};
