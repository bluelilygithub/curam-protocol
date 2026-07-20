'use strict';

/**
 * Supplementary analysis for the qualification proforma PDF/UI.
 * Extends the strict pass/fail review with rate stress, product-fit guidance,
 * and post-settlement cashflow notes. Indicative/educational only.
 */

const { monthlyRepayment } = require('./buyerQualification');
const { roundMoney } = require('./tables');

function buildProformaSupplement(strict, inputs = {}, bankPosture = null) {
  if (!strict?.ok || !strict.summary) return null;

  const s = strict.summary;
  const svc = (strict.checks || []).find((c) => c.id === 'serviceability');
  const netSurplus = Number(svc?.data?.net_surplus_monthly) || 0;
  const loan = Number(s.loan_requested) || 0;
  const targetRate = Number(s.target_rate_pct) || 0;
  const assessmentRate = Number(s.assessment_rate_pct) || 0;
  const termMonths = Math.round((Number(inputs.loanTermYears) || 30) * 12);
  const repaymentAtTarget = Number(s.monthly_repayment_estimate) || monthlyRepayment(loan, targetRate, termMonths) || 0;
  const employmentType = inputs.employmentType || s.employment_type || 'payg_fulltime';
  const isPpor = inputs.isPpor !== false;
  const overallPass = s.overall_status === 'pass';
  const propertyType = inputs.propertyType || inputs.property_type_class || null;
  const cardLimits = Number(inputs.creditCardLimitsTotal) || 0;

  // ── Rate stress table (product rates around target + APRA assessment) ─────
  const ratePoints = [
    { rate_pct: roundMoney(Math.max(0.1, targetRate - 1)), label: null },
    { rate_pct: targetRate, label: 'target rate' },
    { rate_pct: roundMoney(targetRate + 1), label: null },
    { rate_pct: roundMoney(targetRate + 2), label: null },
    { rate_pct: assessmentRate, label: 'APRA assessment floor' },
  ];
  // Dedupe if assessment equals one of the +N rates
  const seen = new Set();
  const rateStressRows = [];
  for (const pt of ratePoints) {
    const key = pt.rate_pct.toFixed(2);
    if (seen.has(key)) continue;
    seen.add(key);
    const repayment = monthlyRepayment(loan, pt.rate_pct, termMonths) || 0;
    const buffer = roundMoney(netSurplus - repayment);
    rateStressRows.push({
      rate_pct: pt.rate_pct,
      label: pt.label,
      monthly_repayment: repayment,
      buffer_vs_surplus: buffer,
      still_buffered: buffer > 0,
    });
  }

  const apraRow = rateStressRows.find((r) => r.label === 'APRA assessment floor') || rateStressRows[rateStressRows.length - 1];
  const rateStressNarrative = apraRow && apraRow.still_buffered
    ? `Even at the APRA assessment floor of ${apraRow.rate_pct}% — three points above a typical product rate — this loan still leaves a $${Math.round(apraRow.buffer_vs_surplus).toLocaleString('en-AU')}/month buffer against assessed surplus. That's the shock absorber already built into serviceability; a genuine rate rise would have to move a long way from here before this loan stopped fitting.`
    : `At the APRA assessment floor of ${apraRow?.rate_pct ?? assessmentRate}%, the repayment consumes most or all of the assessed surplus — treat rate rises as a live risk and confirm buffer with a broker.`;

  // ── Income stress (indicative only — not a re-assessment) ─────────────────
  const gross = Number(inputs.grossAnnualIncome) || 0;
  const partner = Number(inputs.partnerGrossIncome) || 0;
  const totalGross = gross + partner || Number(svc?.data?.base_gross_annual) || 0;
  const cut20 = roundMoney(totalGross * 0.8);
  const incomeStress = {
    title: 'Income stress test — indicative only',
    note: 'If gross income fell materially — reduced hours, parental leave, a career change — the whole serviceability calculation needs re-running, not scaling. HECS repayments, tax, and the surplus figure all move non-linearly with income, so a rough percentage cut does not map cleanly onto a new surplus number.',
    example: totalGross > 0
      ? `As an illustrative example only: a 20% gross income cut (roughly $${cut20.toLocaleString('en-AU')}/yr) would shrink the monthly surplus buffer well below the current $${netSurplus.toLocaleString('en-AU')} — likely by considerably more than 20%, since fixed expenses and existing debts don't move with income. This is not a re-assessment.`
      : null,
    brokerAsk: 'If you\'re genuinely considering a scenario like a career break or a single-income period, ask your broker to re-run full serviceability against that specific number before relying on any estimate.',
  };

  // ── Product-fit guidance (what actually differentiates lenders) ───────────
  const bullets = [];
  if (overallPass) {
    bullets.push({
      title: 'Digital-only vs manual underwriting',
      body: 'Your file is clean enough that approval risk isn\'t usually the deciding factor — product fit is. Digital lenders (e.g. Up, UBank) tend to sit at the lowest published rates but are often PAYG-only, owner-occupier-only, and less flexible if circumstances change. Manual-underwriting lenders (e.g. Bank of Queensland, Macquarie) sit slightly higher on rate but flex more if your situation shifts later (self-employment, casual hours, a future investment purpose).',
    });
  } else {
    bullets.push({
      title: 'Lender selection matters more than headline rate',
      body: 'This file has warnings or blocks on one or more lending checks. Shop lenders whose appetite matches the specific flag (casual tenure, high-density property, DTI, adverse credit) before chasing the lowest published rate — see the bank-posture section.',
    });
  }
  bullets.push({
    title: 'Offset availability',
    body: 'A bare low rate with no offset account can cost more over the life of the loan than a slightly higher rate that includes one — confirm this explicitly; it is not always on the rate table.',
  });
  bullets.push({
    title: 'Narrow before you apply',
    body: 'A credible broker shortlists two lenders on fit, then applies to one — protecting your credit file from unnecessary hard enquiries.',
  });
  if (!isPpor) {
    bullets.push({
      title: 'Investment purpose',
      body: 'Owner-occupier-only products (notably Up today) are out of scope. Confirm rental shading and IO/P&I policy before comparing headline rates.',
    });
  }
  if (propertyType === 'highrise' || propertyType === 'studio_small' || propertyType === 'rural_acreage') {
    bullets.push({
      title: 'Property-type LVR policy',
      body: 'High-rise, small apartments, and rural/acreage often attract tighter max LVRs. Use the bank-posture ranking and a broker who knows which lenders are active above 80% in your postcode/development.',
    });
  }
  if (cardLimits >= 10000) {
    bullets.push({
      title: 'Credit card limits',
      body: `$${cardLimits.toLocaleString('en-AU')} in card limits is assessed at 3.8%/month regardless of balance. Closing or reducing unused limits before applying is a legitimate structuring step (see levers) — reopening them immediately after settlement is not.`,
    });
  }

  const topBanks = (bankPosture?.banks || []).filter((b) => b.fit === 'strong' || b.fit === 'fair').slice(0, 3);
  const productFit = {
    title: 'Lender & product fit guidance',
    intro: overallPass
      ? 'What actually differentiates lenders for this file'
      : 'Where to focus lender shopping for this file',
    bullets,
    topBanks: topBanks.map((b) => ({ name: b.shortName || b.name, fit: b.fit, reason: (b.reasons || [])[0] || null })),
  };

  // ── Post-settlement cashflow ──────────────────────────────────────────────
  const headroom = roundMoney(netSurplus - repaymentAtTarget);
  const offsetExampleBalance = 20000;
  const offsetAnnualSaving = roundMoney(offsetExampleBalance * (targetRate / 100));
  const postSettlement = {
    title: 'Post-settlement cashflow & features',
    intro: 'Where the real buffer goes after settlement',
    headroom_note: repaymentAtTarget > 0
      ? `After the $${repaymentAtTarget.toLocaleString('en-AU')}/month repayment, the serviceability calculation implies roughly $${headroom.toLocaleString('en-AU')}/month of headroom against your assessed surplus — a lending construct, not guaranteed spare cash; your real household budget will differ once you add rates, insurance, maintenance, and everyday living costs that sit outside this assessment.`
      : null,
    offset_vs_redraw: `Offset vs redraw is worth pricing before choosing a lender. An offset account reduces interest immediately on whatever sits in it: $${offsetExampleBalance.toLocaleString('en-AU')} parked in offset saves roughly $${offsetAnnualSaving.toLocaleString('en-AU')}/year in interest at ${targetRate}% — sometimes worth more than a 0.1–0.2% lower headline rate. Redraw is usually simpler and sometimes fee-free, but withdrawn redraw funds can complicate tax treatment if you ever rent the property out; offset funds don't have this issue because they were never part of the loan.`,
    ask_lenders: 'Ask each shortlisted lender explicitly whether full, fee-free offset is included — some lower-rate products only bundle a partial or capped offset.',
    employment_note: employmentType === 'self_employed'
      ? 'Self-employed files should also confirm how the lender treats add-backs and income averaging before locking a product.'
      : null,
  };

  return {
    rateStress: {
      title: 'Rate stress test — modelled',
      subtitle: `Repayment sensitivity at $${loan.toLocaleString('en-AU')} over ${Math.round(termMonths / 12)} years`,
      intro: `Repayment on your $${loan.toLocaleString('en-AU')} loan over ${Math.round(termMonths / 12)} years, at rates around your ${targetRate}% target:`,
      rows: rateStressRows,
      surplus_monthly: netSurplus,
      narrative: rateStressNarrative,
    },
    incomeStress,
    productFit,
    postSettlement,
    caveat: 'This section is educational context, not legal, financial, or credit advice. Figures are modelled from the strict-check inputs using standard amortisation formulas; they are not a lender calculation and do not predict approval. Speak to a licensed mortgage broker before acting on anything here.',
  };
}

module.exports = { buildProformaSupplement };
