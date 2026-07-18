import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { startPropertyScenarioTour, TOUR_KEY as PS_TOUR_KEY } from '../utils/tours/propertyScenarioTour';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
// Lazy-loaded to avoid blocking Vite build if @react-pdf/renderer has compat issues
async function downloadPdf(calcResult, inputs, scenarioType, tabFilter, followUpAnswers) {
  const { downloadPropertyScenarioPdf } = await import('../utils/propertyScenarioPdf');
  return downloadPropertyScenarioPdf(calcResult, inputs, scenarioType, tabFilter, followUpAnswers);
}

async function downloadQualifyPdf(result, inputs) {
  const { downloadQualificationPdf } = await import('../utils/propertyScenarioPdf');
  return downloadQualificationPdf(result, inputs);
}

async function downloadCalcsPdf(calcInputs, calcResults) {
  const { downloadCalculatorsPdf } = await import('../utils/propertyScenarioPdf');
  return downloadCalculatorsPdf(calcInputs, calcResults);
}
import {
  RateComparisonChart,
  CumulativeCostChart,
  AmortizationChart,
  BreakEvenChart,
  LenderComparisonTable,
  LenderTermsInsight,
  ScenarioSummaryTable,
  AdvicePanel,
  FollowUpPanel,
  CalculatorSnapshots,
  CashFlowTimeline,
  FundingAlertBanner,
} from '../components/propertyScenario/PropertyScenarioViews';

const TABS = [
  { id: 'overview', label: 'Scenario' },
  { id: 'charts', label: 'Charts' },
  { id: 'lenders', label: 'Lenders' },
  { id: 'calculators', label: 'Calculators' },
  { id: 'advice', label: 'Follow-ups' },
];

const MODES = [
  { id: 'describe', label: 'Describe your situation' },
  { id: 'example', label: 'See an example' },
];

const FIELD = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  fontSize: 14,
  outline: 'none',
};

function Section({ title, hint, children }) {
  return (
    <section className="rounded-2xl border p-5 sm:p-6 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
        {hint && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function fmt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `$${Math.round(Number(n)).toLocaleString('en-AU')}`;
}

function RefinanceInterpretation({ calcResult, rfRateType, rfState }) {
  if (!calcResult?.ready_for_calculations) return null;

  const refi = calcResult.calculation?.event_results?.[0]?.outputs?.refinance_break_even;
  const breakCostData = calcResult.calculation?.event_results?.[0]?.outputs?.break_cost;
  const totals = calcResult.calculation?.totals || {};
  const cdrData = calcResult.cdr_rate_used; // { best: {...}, alternatives: [...] } or legacy { rate, lender }
  // Support both old shape (rate/lender) and new shape (best/alternatives)
  const best = cdrData?.best || (cdrData?.rate ? cdrData : null);
  const alternatives = cdrData?.alternatives || [];

  if (!refi) return null;

  const monthlySaving = Number(refi.monthly_saving ?? totals.monthly_repayment_saving ?? 0);
  const breakEvenMonths = refi.break_even_months;
  const upfront = Number(refi.upfront_cost ?? 0);
  const breakCost = Number(totals.break_costs ?? breakCostData?.break_cost_estimate ?? 0);
  const totalCost = upfront + breakCost;
  const discharge = Number(refi.discharge_fee ?? 350);
  const establishment = Number(refi.establishment_fee ?? 600);
  const valuationFee = Number(refi.valuation_fee ?? 250);
  const legalFee = Number(refi.legal_fee ?? 400);
  const govtFees = Number(refi.govt_fees ?? 340);
  const govtFeesSource = refi.govt_fees_source || 'State land titles office fees';
  const currentRepayment = Number(refi.monthly_repayment_current ?? 0);
  const targetRepayment = Number(refi.monthly_repayment_target ?? 0);
  const isVariable = rfRateType === 'variable';

  const positive = monthlySaving > 0;
  const borderColor = positive ? '#22c55e' : '#ef4444';
  const verdictColor = positive ? '#16a34a' : '#ef4444';
  const breakEvenYears = breakEvenMonths ? (breakEvenMonths / 12).toFixed(1) : null;

  return (
    <div className="rounded-xl border-l-4 p-4 sm:p-5 space-y-4" style={{ borderLeftColor: borderColor, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderLeft: `4px solid ${borderColor}` }}>

      {/* Verdict */}
      <div className="space-y-1">
        {positive ? (
          <p className="text-base font-semibold" style={{ color: verdictColor }}>
            Switching saves {fmt(monthlySaving)}/month
          </p>
        ) : monthlySaving < 0 ? (
          <p className="text-base font-semibold" style={{ color: verdictColor }}>
            Switching increases repayments by {fmt(Math.abs(monthlySaving))}/month
          </p>
        ) : (
          <p className="text-base font-semibold" style={{ color: 'var(--color-muted)' }}>
            No monthly saving at this rate
          </p>
        )}
        {currentRepayment > 0 && targetRepayment > 0 && (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Current repayment {fmt(currentRepayment)}/month → new repayment {fmt(targetRepayment)}/month
          </p>
        )}
      </div>

      {/* Named bank + product */}
      {best && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {best.lender} — {best.rate}% p.a.
                {best.fixed_or_variable ? ` (${best.fixed_or_variable})` : ''}
              </p>
              {best.product && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{best.product}</p>
              )}
              {best.comparison_rate != null && (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Comparison rate: {best.comparison_rate}% p.a.
                  <span className="ml-1" style={{ color: '#f59e0b' }}>†</span>
                </p>
              )}
              <div className="flex gap-3 mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                {best.offset && <span>✓ Offset</span>}
                {best.redraw && <span>✓ Redraw</span>}
                {best.upfront_fees != null && <span>Upfront fees est. {fmt(best.upfront_fees)}</span>}
              </div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              {best.links?.application && (
                <a href={best.links.application} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-center transition-opacity duration-200 hover:opacity-70"
                  style={{ background: 'var(--color-primary)', color: '#fff' }}>
                  Apply →
                </a>
              )}
              {best.links?.overview && (
                <a href={best.links.overview} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-center transition-opacity duration-200 hover:opacity-70"
                  style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                  Product details
                </a>
              )}
            </div>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            † The advertised rate ({best.rate}%) is used for repayment calculations above. The comparison rate ({best.comparison_rate}%) is a standardised figure that includes fees and is based on a 25-year/$150,000 loan — it may not reflect your actual cost over your remaining term.
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#f59e0b' }}>
            Advertised rates are not guaranteed — the rate you receive depends on your LVR, loan size, credit profile, and lender assessment. Source: CDR Open Banking live data.
          </p>
        </div>
      )}

      {/* Alternatives */}
      {alternatives.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Other options below your current rate</p>
          {alternatives.map((alt) => (
            <div key={`${alt.lender}-${alt.rate}`} className="flex items-center justify-between gap-2 py-1.5 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
              <div>
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{alt.lender}</span>
                {alt.product && <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>{alt.product}</span>}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{alt.rate}%</span>
                {alt.comparison_rate && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>cr {alt.comparison_rate}%</span>}
                {alt.links?.overview && (
                  <a href={alt.links.overview} target="_blank" rel="noopener noreferrer"
                    className="text-xs transition-opacity duration-200 hover:opacity-70"
                    style={{ color: 'var(--color-primary)' }}>View →</a>
                )}
              </div>
            </div>
          ))}
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>All rates are lowest available from CDR for owner-occupied P&amp;I. Switch to the Lenders tab for the full comparison including fees.</p>
        </div>
      )}

      {/* Cost breakdown */}
      <div className="space-y-1.5 pt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>All switching costs: {fmt(totalCost)}</p>
        <ul className="text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
          <li className="flex items-start gap-1">
            <span className="shrink-0">Discharge fee (paying out your current lender) — {fmt(discharge)}</span>
            <span className="shrink-0" style={{ color: '#f59e0b' }}>estimate $150–$500 · confirm with your current lender</span>
          </li>
          <li className="flex items-start gap-1">
            <span className="shrink-0">Establishment fee (new lender setup) — {fmt(establishment)}</span>
            {best?.upfront_fees != null
              ? <span className="shrink-0" style={{ color: '#16a34a' }}>from {best.lender} CDR data</span>
              : <span className="shrink-0" style={{ color: '#f59e0b' }}>estimate $0–$1,000 · check new lender's fee schedule</span>}
          </li>
          <li className="flex items-start gap-1">
            <span className="shrink-0">Valuation fee — {fmt(valuationFee)}</span>
            <span className="shrink-0" style={{ color: '#f59e0b' }}>estimate $0–$600 · many lenders waive on refinance</span>
          </li>
          <li className="flex items-start gap-1">
            <span className="shrink-0">Legal / conveyancing — {fmt(legalFee)}</span>
            <span className="shrink-0" style={{ color: '#f59e0b' }}>estimate $300–$800</span>
          </li>
          <li className="flex items-start gap-1">
            <span className="shrink-0">Government fees (mortgage discharge + re-registration) — {fmt(govtFees)}</span>
            <span className="shrink-0" style={{ color: rfState ? '#16a34a' : '#f59e0b' }}>
              {rfState ? `${rfState} land titles office · confirm fee schedule` : 'national average · varies $240–$440 by state'}
            </span>
          </li>
          {breakCost > 0 && (
            <li className="flex items-start gap-1" style={{ color: '#ef4444' }}>
              <span>Fixed-rate break cost (IRD estimate) — {fmt(breakCost)}</span>
            </li>
          )}
        </ul>
        {breakCost === 0 && isVariable && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Break cost: $0 — variable rate loans carry no early repayment penalty under Australian law.
          </p>
        )}
        {breakCost === 0 && !isVariable && (
          <p className="text-xs mt-1" style={{ color: '#f59e0b' }}>
            Break cost shown as $0 — actual IRD depends on your lender's comparison rate in the original contract. Confirm with your lender before switching.
          </p>
        )}
        <p className="text-xs pt-0.5" style={{ color: 'var(--color-muted)' }}>
          All cost figures are estimates. Get itemised quotes from both lenders before committing to a switch.
        </p>
      </div>

      {/* Break-even */}
      {positive && breakEvenMonths != null && (
        <div className="pt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Break-even: {breakEvenMonths} months{breakEvenYears ? ` (${breakEvenYears} years)` : ''}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            After {breakEvenMonths} months of lower repayments, the {fmt(totalCost)} switching cost is fully recovered.
            {breakEvenMonths > 60 ? ' Break-even exceeds 5 years — consider whether you\'ll hold this loan that long.' : ''}
          </p>
        </div>
      )}

      {!positive && (
        <div className="pt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            The {fmt(totalCost)} switching cost isn't recovered through repayment savings at this rate differential.
            Switching may still make sense for product features (offset, redraw, flexibility) — check the Lenders tab.
          </p>
        </div>
      )}
    </div>
  );
}

// Australian individual income tax brackets 2025-26 (incl. 2% Medicare levy)
const AU_MARGINAL_RATES = [
  { threshold: 190001, label: 'top bracket (190k+)', rate: 0.47 },
  { threshold: 135001, label: '$135k–$190k', rate: 0.39 },
  { threshold: 45001,  label: '$45k–$135k', rate: 0.345 },
  { threshold: 18201,  label: '$18.2k–$45k', rate: 0.21 },
  { threshold: 0,      label: 'below $18.2k', rate: 0.02 },
];

function fmtCgtTax(gain) {
  // Show indicative tax range at three common brackets
  const brackets = [
    { label: '32.5%+Medi bracket', rate: 0.345 },
    { label: '37%+Medi bracket', rate: 0.39 },
    { label: 'top bracket (47%)', rate: 0.47 },
  ];
  return brackets.map((b) => `${fmt(Math.round(gain * b.rate))} (${b.label})`).join(' · ');
}

function SellInterpretation({ calcResult, sellPpor }) {
  if (!calcResult?.ready_for_calculations) return null;
  const ev = calcResult.calculation?.event_results?.[0];
  const out = ev?.outputs;
  if (!out) return null;

  const salePrice = Number(out.sale_price ?? 0);
  const sellingCosts = Number(out.selling_costs ?? 0);
  const netProceeds = Number(out.net_sale_proceeds ?? 0);
  const cgt = out.cgt || {};
  const taxableCgt = Number(cgt.taxable_capital_gain_estimate ?? 0);
  const isMreExempt = Boolean(cgt.main_residence_exempt);
  const grossGain = Number(cgt.capital_gain_gross ?? 0);
  const discountApplied = Boolean(cgt.cgt_discount_applied);
  const partialFlagged = Boolean(cgt.partial_exemption_flagged);
  const isMixed = sellPpor === 'mixed';

  const sellingCostPct = salePrice > 0 ? ((sellingCosts / salePrice) * 100).toFixed(1) : null;

  return (
    <div className="rounded-xl border-l-4 p-4 sm:p-5 space-y-4" style={{ borderLeftColor: 'var(--color-primary)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderLeft: '4px solid var(--color-primary)' }}>
      {/* Net proceeds */}
      <div className="space-y-1">
        <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
          Net proceeds: {fmt(netProceeds)}
        </p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Sale price {fmt(salePrice)} minus selling costs {fmt(sellingCosts)}{sellingCostPct ? ` (${sellingCostPct}% of sale price)` : ''}.
        </p>
      </div>

      {/* Selling costs */}
      <div className="space-y-1">
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Selling costs breakdown</p>
        <ul className="text-xs space-y-0.5" style={{ color: 'var(--color-muted)' }}>
          <li>Real estate agent commission: typically 1.5%–2.5% of sale price — varies by agent and location</li>
          <li>Advertising / marketing: $2,000–$15,000 — depends on campaign type and suburb</li>
          <li>Vendor conveyancing / legal: $1,000–$2,500</li>
          <li>Styling, cleaning and minor repairs: varies — often $2,000–$10,000+</li>
        </ul>
        <p className="text-xs" style={{ color: '#f59e0b' }}>
          The 2.5% assumption is an estimate. Get itemised quotes from your agent and conveyancer.
        </p>
      </div>

      {/* CGT — the most important and most misunderstood section */}
      <div className="pt-2 border-t space-y-3" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Capital gains tax (CGT)</p>

        {isMreExempt ? (
          /* PPOR — full main residence exemption */
          <div className="rounded-lg p-3 space-y-1" style={{ background: '#f0fdf4', border: '1px solid #86efac' }}>
            <p className="text-sm font-medium" style={{ color: '#15803d' }}>
              Main residence exemption applies — CGT is $0.
            </p>
            {grossGain > 0 && (
              <p className="text-xs" style={{ color: '#166534' }}>
                Gross gain on simplified cost base: {fmt(grossGain)} — fully exempt because this was your principal place of residence.
              </p>
            )}
            <p className="text-xs mt-1" style={{ color: '#166534' }}>
              Under Australian tax law, a property that was your main residence for the entire ownership period generates no taxable gain — no 50% discount is even needed, because there is no taxable event at all.
            </p>
          </div>
        ) : taxableCgt > 0 ? (
          /* Investment / mixed — CGT applies */
          <div className="space-y-3">
            {/* What the numbers mean — critical context */}
            <div className="rounded-lg p-3 space-y-2" style={{ background: '#fef2f2', border: '1px solid #fca5a5' }}>
              <p className="text-sm font-medium" style={{ color: '#b91c1c' }}>
                Taxable gain: {fmt(taxableCgt)}
              </p>
              <p className="text-xs" style={{ color: '#991b1b' }}>
                {discountApplied
                  ? `This is the gain after the 50% CGT discount (gross gain ${fmt(grossGain)} ÷ 2). The 50% discount applies because the asset was held more than 12 months.`
                  : `This is the full gross gain (${fmt(grossGain)}). The 50% discount does not apply — either the asset was held ≤12 months or the holding period is unknown.`}
              </p>
              <p className="text-xs font-medium" style={{ color: '#991b1b' }}>
                Important: this is the amount added to your taxable income — not the tax itself. There is no separate flat CGT rate in Australia. Your actual tax liability depends on your total income in the year of sale.
              </p>
            </div>

            {/* Indicative tax range */}
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Indicative tax on the gain at common marginal rates (2025–26 incl. Medicare levy):</p>
              <table className="text-xs w-full" style={{ color: 'var(--color-muted)', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th className="text-left py-1 pr-4" style={{ color: 'var(--color-muted)', fontWeight: 500 }}>Income bracket</th>
                    <th className="text-left py-1 pr-4" style={{ color: 'var(--color-muted)', fontWeight: 500 }}>Rate</th>
                    <th className="text-left py-1" style={{ color: 'var(--color-muted)', fontWeight: 500 }}>Est. tax on gain</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: '$45k–$135k', rate: 0.325, medi: 0.02 },
                    { label: '$135k–$190k', rate: 0.37, medi: 0.02 },
                    { label: '$190k+', rate: 0.45, medi: 0.02 },
                  ].map((b) => (
                    <tr key={b.label}>
                      <td className="py-0.5 pr-4">{b.label}</td>
                      <td className="py-0.5 pr-4">{Math.round((b.rate + b.medi) * 100)}%</td>
                      <td className="py-0.5" style={{ color: 'var(--color-text)' }}>{fmt(Math.round(taxableCgt * (b.rate + b.medi)))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                These are estimates only. Your actual liability depends on your total income that year, other deductions, offsets, and whether you have capital losses to apply. CGT is reported in your tax return — it is not deducted at settlement.
              </p>
            </div>

            {/* Partial exemption flag for mixed-use properties */}
            {(partialFlagged || isMixed) && (
              <div className="rounded-lg p-3" style={{ background: '#fefce8', border: '1px solid #fde047' }}>
                <p className="text-xs font-medium" style={{ color: '#92400e' }}>
                  {isMixed
                    ? 'This property was flagged as having been both a residence and an investment. A partial main residence exemption may apply — the calculation above shows full investment CGT, which is conservative.'
                    : 'Partial main residence exemption may apply.'}
                </p>
                <p className="text-xs mt-1" style={{ color: '#92400e' }}>
                  The 6-year rule and partial exemption can significantly reduce or eliminate CGT depending on occupancy dates. This tool does not calculate partial exemptions — you need a tax agent with the full timeline to get an accurate figure.
                </p>
              </div>
            )}

            {/* PPOR re-confirmation — the highest-leverage clarification */}
            <div className="rounded-lg p-3" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                The single most important check: was this your primary residence?
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                If this property was your genuine principal place of residence for the entire period you owned it — and was never rented out or used to produce income — CGT would be $0 under the main residence exemption. That is the difference between this {fmt(taxableCgt)} taxable gain and a $0 liability. Verify that you answered the "property type" question correctly before relying on this estimate.
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            CGT: $0 — no capital gain on this simplified cost base.
          </p>
        )}

        <p className="text-xs" style={{ color: '#f59e0b' }}>
          Cost base uses purchase price only. Your actual ATO cost base also includes: stamp duty paid at purchase, acquisition conveyancing fees, capital improvements, and some borrowing costs — all of which reduce taxable gain. This is not tax advice — confirm with a registered tax agent.
        </p>
      </div>
    </div>
  );
}

function BuyInterpretation({ calcResult }) {
  if (!calcResult?.ready_for_calculations) return null;
  const ev = calcResult.calculation?.event_results?.[0];
  const out = ev?.outputs;
  const totals = calcResult.calculation?.totals || {};
  if (!out) return null;

  const purchasePrice = Number(out.purchase_price ?? 0);
  const stampDuty = Number(totals.stamp_duty ?? out.stamp_duty ?? 0);
  const lmi = Number(totals.lmi ?? out.lmi ?? 0);
  const deposit = Number(out.deposit ?? 0);
  const loanAmount = purchasePrice > 0 && deposit > 0 ? purchasePrice - deposit : 0;
  const lvr = purchasePrice > 0 && loanAmount > 0 ? ((loanAmount / purchasePrice) * 100).toFixed(1) : null;
  const totalUpfront = stampDuty + lmi;

  return (
    <div className="rounded-xl border-l-4 p-4 sm:p-5 space-y-3" style={{ borderLeftColor: 'var(--color-primary)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderLeft: '4px solid var(--color-primary)' }}>
      <div className="space-y-1">
        <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
          Total upfront costs: {fmt(totalUpfront)}
        </p>
        {lvr && (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Loan-to-value ratio: {lvr}% ({loanAmount > 0 ? `${fmt(loanAmount)} loan on ${fmt(purchasePrice)} property` : ''}).
          </p>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Stamp duty: {fmt(stampDuty)}</p>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Calculated using your state's published thresholds and rates. Payable at settlement — budget this separately from your deposit.
        </p>
      </div>

      {lmi > 0 ? (
        <div className="space-y-1 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm font-medium" style={{ color: '#f59e0b' }}>LMI: {fmt(lmi)}</p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Lenders Mortgage Insurance applies because your LVR exceeds 80%. LMI protects the lender, not you — it adds to your loan cost.
            This estimate uses indicative premium tables; actual LMI is priced by the insurer (Helia or QBE) and varies by lender, loan amount, postcode, and credit profile.
          </p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            To avoid LMI: increase deposit to {purchasePrice > 0 ? fmt(purchasePrice * 0.2) : '20% of purchase price'} (20% LVR) or explore a family guarantee arrangement.
          </p>
        </div>
      ) : (
        <div className="pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm" style={{ color: '#16a34a' }}>No LMI — deposit is 20% or more of purchase price.</p>
        </div>
      )}

      {/* Additional certain costs not included in the calculation */}
      <div className="pt-2 border-t space-y-1" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Additional costs not included in this estimate</p>
        <ul className="text-xs space-y-0.5" style={{ color: 'var(--color-muted)' }}>
          <li>Conveyancing / legal (buyer): $1,500–$3,000 — required for every purchase</li>
          <li>Building and pest inspection: $400–$800 — strongly recommended before exchange</li>
          <li>Loan application / establishment fee: $0–$600 — check your lender's fee schedule</li>
          <li>Title insurance: $250–$500 (optional but recommended)</li>
          <li>Council rates / water adjustment at settlement: varies by property and timing</li>
          <li>Moving costs: varies</li>
        </ul>
        <p className="text-xs" style={{ color: '#f59e0b' }}>
          Budget an additional $3,000–$6,000 above stamp duty and LMI for these transaction costs.
        </p>
      </div>
    </div>
  );
}

const STATUS_COLOR = { pass: '#16a34a', warn: '#b45309', fail: '#b91c1c', info: '#1d4ed8' };
const STATUS_BG    = { pass: '#f0fdf4', warn: '#fefce8', fail: '#fef2f2', info: '#eff6ff' };
const STATUS_BORDER= { pass: '#86efac', warn: '#fde047', fail: '#fca5a5', info: '#93c5fd' };
const STATUS_LABEL = { pass: 'Pass', warn: 'Check required', fail: 'Likely blocked', info: 'Note' };

function QualifyCheck({ check, expanded, onToggle }) {
  const col   = STATUS_COLOR[check.status]  || 'var(--color-muted)';
  const bg    = STATUS_BG[check.status]    || 'var(--color-surface)';
  const bord  = STATUS_BORDER[check.status] || 'var(--color-border)';
  const label = STATUS_LABEL[check.status] || check.status;
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: bord }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-4 text-left transition-opacity duration-200 hover:opacity-80"
        style={{ background: bg }}
      >
        <span className="text-lg shrink-0 mt-0.5" style={{ color: col }}>
          {check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : check.status === 'info' ? 'ℹ' : '⚠'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{check.label}</span>
            <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: col, color: '#fff' }}>{label}</span>
          </div>
          <p className="text-sm font-medium mt-0.5" style={{ color: 'var(--color-text)' }}>{check.headline}</p>
        </div>
        <span className="text-xs shrink-0 mt-1" style={{ color: 'var(--color-muted)' }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && check.detail && (
        <div className="px-4 pb-4 pt-0 text-sm leading-relaxed" style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderTop: `1px solid ${bord}` }}>
          {check.detail}
        </div>
      )}
    </div>
  );
}

function BuyerQualifyForm({ getIcon, addToast }) {
  const FIELD = {
    borderColor: 'var(--color-border)', background: 'var(--color-bg)',
    color: 'var(--color-text)', borderRadius: 8, border: '1px solid',
    padding: '8px 12px', fontSize: 14, width: '100%', outline: 'none',
  };

  // Property
  const [qPrice, setQPrice]     = useState('');
  const [qDeposit, setQDeposit] = useState('');
  const [qState, setQState]     = useState('');
  const [qFhb, setQFhb]         = useState('');
  const [qPpor, setQPpor]       = useState('ppor');
  // Income & household
  const [qIncome, setQIncome]     = useState('');
  const [qPartner, setQPartner]   = useState('');
  const [qHousehold, setQHousehold] = useState('single');
  const [qEmployment, setQEmployment] = useState('payg_fulltime');
  // Debts
  const [qHecs, setQHecs]       = useState('no');
  const [qDebts, setQDebts]     = useState('');
  const [qExpenses, setQExpenses] = useState('');
  // Loan
  const [qTerm, setQTerm]       = useState('30');
  const [qRate, setQRate]       = useState('');
  // Results
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [expanded, setExpanded] = useState({});

  async function runQualify() {
    const price = parseFloat(qPrice);
    const deposit = parseFloat(qDeposit);
    const income = parseFloat(qIncome);
    const rate = parseFloat(qRate);
    if (!price || !deposit || !income || !rate || !qState) {
      setError('Property price, deposit, state, gross income, and interest rate are required.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await api.post('/api/property-scenario/calculators/buyer-qualify', {
        property_value:          price,
        deposit_amount:          deposit,
        state:                   qState,
        is_fhb:                  qFhb === 'yes',
        is_ppor:                 qPpor === 'ppor',
        gross_annual_income:     income,
        partner_gross_income:    qPartner ? parseFloat(qPartner) : 0,
        household_type:          qHousehold,
        employment_type:         qEmployment,
        has_hecs:                qHecs === 'yes',
        monthly_debt_repayments: qDebts ? parseFloat(qDebts) : 0,
        monthly_expenses:        qExpenses ? parseFloat(qExpenses) : undefined,
        loan_term_years:         parseFloat(qTerm) || 30,
        target_rate_pct:         rate,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.errors?.[0] || 'Qualification check failed');
      setResult(data);
      // Auto-expand fails first
      const init = {};
      (data.checks || []).forEach((c) => { if (c.status === 'fail') init[c.id] = true; });
      setExpanded(init);
    } catch (err) {
      setError(err.message || 'Request failed');
      addToast(err.message || 'Qualification check failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  const [pdfBusy, setPdfBusy] = useState(false);

  async function handleQualifyPdf() {
    setPdfBusy(true);
    try {
      await downloadQualifyPdf(result, {
        property_value: parseFloat(qPrice),
        deposit_amount: parseFloat(qDeposit),
        state: qState,
        is_fhb: qFhb === 'yes',
        is_ppor: qPpor === 'ppor',
        gross_annual_income: parseFloat(qIncome),
        partner_gross_income: qPartner ? parseFloat(qPartner) : 0,
        household_type: qHousehold,
        employment_type: qEmployment,
        has_hecs: qHecs === 'yes',
        monthly_debt_repayments: qDebts ? parseFloat(qDebts) : 0,
        monthly_expenses: qExpenses ? parseFloat(qExpenses) : undefined,
        loan_term_years: parseFloat(qTerm) || 30,
        target_rate_pct: parseFloat(qRate),
      });
    } catch (err) {
      console.error('[PDF] qualification failed:', err);
      addToast('PDF generation failed — ' + (err?.message || 'unknown error'), 'error');
    } finally {
      setPdfBusy(false);
    }
  }

  const s = result?.summary;
  const overallColor = s ? STATUS_COLOR[s.overall_status] : null;
  const overallBg    = s ? STATUS_BG[s.overall_status] : null;
  const overallBord  = s ? STATUS_BORDER[s.overall_status] : null;

  return (
    <div className="space-y-5">
      {/* Form */}
      <div className="rounded-xl border p-4 sm:p-5 space-y-5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Mortgage qualification check</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Deterministic Australian checks: serviceability (APRA buffer), LVR, debt-to-income, genuine savings, First Home Guarantee eligibility, and HECS/HELP impact. Not a credit decision — for indicative purposes only.
          </p>
        </div>

        {/* Property */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Property</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Purchase price ($)</span>
              <input type="text" inputMode="numeric" value={qPrice} onChange={(e) => setQPrice(e.target.value)} placeholder="e.g. 850000" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Deposit ($)</span>
              <input type="text" inputMode="numeric" value={qDeposit} onChange={(e) => setQDeposit(e.target.value)} placeholder="e.g. 170000" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>State</span>
              <select value={qState} onChange={(e) => setQState(e.target.value)} style={FIELD}>
                <option value="">Select…</option>
                {['NSW','VIC','QLD','SA','WA','TAS','ACT','NT'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>First home buyer?</span>
              <select value={qFhb} onChange={(e) => setQFhb(e.target.value)} style={FIELD}>
                <option value="">Select…</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Property purpose</span>
              <select value={qPpor} onChange={(e) => setQPpor(e.target.value)} style={FIELD}>
                <option value="ppor">Primary residence (PPOR)</option>
                <option value="investment">Investment</option>
              </select>
            </label>
          </div>
        </div>

        {/* Income */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Income &amp; household</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Gross annual income ($)</span>
              <input type="text" inputMode="numeric" value={qIncome} onChange={(e) => setQIncome(e.target.value)} placeholder="e.g. 95000" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Partner income ($ — joint only)</span>
              <input type="text" inputMode="numeric" value={qPartner} onChange={(e) => setQPartner(e.target.value)} placeholder="leave blank if solo" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Household type</span>
              <select value={qHousehold} onChange={(e) => setQHousehold(e.target.value)} style={FIELD}>
                <option value="single">Single (no dependants)</option>
                <option value="couple">Couple (no kids)</option>
                <option value="family">Family (with children)</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Employment type</span>
              <select value={qEmployment} onChange={(e) => setQEmployment(e.target.value)} style={FIELD}>
                <option value="payg_fulltime">PAYG full-time</option>
                <option value="payg_parttime">PAYG part-time</option>
                <option value="casual">Casual</option>
                <option value="contract">Contract</option>
                <option value="self_employed">Self-employed</option>
              </select>
            </label>
          </div>
        </div>

        {/* Debts */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Debts &amp; expenses</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>HECS / HELP debt outstanding?</span>
              <select value={qHecs} onChange={(e) => setQHecs(e.target.value)} style={FIELD}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Existing monthly debt repayments ($)</span>
              <input type="text" inputMode="numeric" value={qDebts} onChange={(e) => setQDebts(e.target.value)} placeholder="loans, credit cards (3.8%×limit)" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Monthly living expenses ($, optional)</span>
              <input type="text" inputMode="numeric" value={qExpenses} onChange={(e) => setQExpenses(e.target.value)} placeholder="leave blank to use HEM benchmark" style={FIELD} />
            </label>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Credit card debt: lenders typically treat 3.8% of the total card limit as a monthly commitment — e.g. a $10,000 limit = $380/mo, even if you pay it off each month.
          </p>
        </div>

        {/* Loan */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Loan</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Target interest rate (% p.a.)</span>
              <input type="text" inputMode="decimal" value={qRate} onChange={(e) => setQRate(e.target.value)} placeholder="e.g. 6.10 (see Lenders tab for live rates)" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Loan term (years)</span>
              <select value={qTerm} onChange={(e) => setQTerm(e.target.value)} style={FIELD}>
                <option value="25">25 years</option>
                <option value="30">30 years</option>
              </select>
            </label>
          </div>
        </div>

        {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}

        <button
          type="button"
          disabled={loading}
          onClick={runQualify}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          {getIcon('check-circle', { size: 14 })}
          {loading ? 'Running checks…' : 'Run qualification check'}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Overall verdict */}
          <div className="rounded-xl border p-4" style={{ borderColor: overallBord, background: overallBg }}>
            <p className="text-base font-semibold" style={{ color: overallColor }}>
              {s.overall_status === 'pass' && 'Looks broadly serviceable — no hard blocks found'}
              {s.overall_status === 'warn' && `${s.warn_count} area${s.warn_count !== 1 ? 's' : ''} to check — may face conditions or reduced choice`}
              {s.overall_status === 'fail' && `${s.fail_count} likely block${s.fail_count !== 1 ? 's' : ''} — most lenders would not proceed as-is`}
            </p>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              {[
                { label: 'Loan requested', value: `$${s.loan_requested?.toLocaleString('en-AU') ?? '—'}` },
                { label: 'Max indicative capacity', value: s.max_borrowing_capacity != null ? `$${s.max_borrowing_capacity.toLocaleString('en-AU', { maximumFractionDigits: 0 })}` : '—' },
                { label: 'Est. monthly repayment', value: s.monthly_repayment_estimate != null ? `$${s.monthly_repayment_estimate.toLocaleString('en-AU')}/mo` : '—' },
                { label: 'Assessment rate', value: `${s.assessment_rate_pct}%` },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</p>
                  <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Individual checks */}
          <div className="space-y-2">
            {(result.checks || []).map((check) => (
              <QualifyCheck
                key={check.id}
                check={check}
                expanded={!!expanded[check.id]}
                onToggle={() => setExpanded((prev) => ({ ...prev, [check.id]: !prev[check.id] }))}
              />
            ))}
          </div>

          {/* Lender guidance — only shown when there are fails/warns */}
          {(result.lender_guidance || []).length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Lenders likely to discuss your situation</h3>
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>Not endorsements — verify with a broker</span>
              </div>
              {(result.lender_guidance || []).map((g, gi) => (
                <div key={gi} className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="px-4 py-3" style={{ background: 'var(--color-surface)' }}>
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{g.barrier}</p>
                    <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--color-text)' }}>{g.intro}</p>
                  </div>
                  <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                    {(g.lenders || []).map((l, li) => (
                      <div key={li} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{l.name}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>{l.category}</span>
                          </div>
                          <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{l.flexible_on}</p>
                        </div>
                        <div className="shrink-0 text-right sm:text-left">
                          {l.rate_premium && l.rate_premium !== 'Standard rates' && l.rate_premium !== 'Competitive' && l.rate_premium !== 'Standard' && (
                            <p className="text-xs" style={{ color: '#b45309' }}>Rate: {l.rate_premium}</p>
                          )}
                          {l.contact && (
                            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{l.contact}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {g.broker_note && (
                    <div className="px-4 py-3" style={{ background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)' }}>
                      <p className="text-xs leading-relaxed" style={{ color: '#1d4ed8' }}>
                        <span className="font-medium">Broker tip: </span>{g.broker_note}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Caveats */}
          <div className="rounded-xl border px-4 py-3 space-y-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Important caveats</p>
            {(result.caveats || []).map((c, i) => (
              <p key={i} className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>· {c}</p>
            ))}
          </div>

          {/* PDF download */}
          <button
            type="button"
            disabled={pdfBusy}
            onClick={handleQualifyPdf}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}
          >
            {getIcon('download', { size: 13 })}
            {pdfBusy ? 'Generating…' : 'Download qualification report (PDF)'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Standalone Calculators — lets users enter their own loan numbers and instantly
 * see repayment, extra repayments, offset benefit, and borrowing power estimates.
 * Calls the four /api/property-scenario/calculators/* endpoints directly.
 * These results are completely independent of any scenario — they never feed back
 * into scenario totals, CGT, stamp duty, or any other calculation.
 */
function StandaloneCalculators({ getIcon }) {
  const [loanAmount, setLoanAmount] = useState('');
  const [rate, setRate] = useState('');
  const [termYears, setTermYears] = useState('');
  const [extra, setExtra] = useState('200');
  const [offsetBalance, setOffsetBalance] = useState('50000');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [monthlyExpenses, setMonthlyExpenses] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  async function runCalcs() {
    const amount = parseFloat(loanAmount);
    const r = parseFloat(rate);
    const months = Math.round(parseFloat(termYears) * 12);
    if (!amount || !r || !months) {
      setError('Loan amount, interest rate, and term are required.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      async function callCalc(path, body) {
        const res = await api.post(path, body);
        return res.json();
      }
      const [rep, xRep, off, bp] = await Promise.all([
        callCalc('/api/property-scenario/calculators/repayment', { loan_amount: amount, annual_rate_pct: r, term_months: months }),
        callCalc('/api/property-scenario/calculators/extra-repayments', { loan_amount: amount, annual_rate_pct: r, term_months: months, extra_monthly: parseFloat(extra) || 200 }),
        callCalc('/api/property-scenario/calculators/offset', { loan_amount: amount, annual_rate_pct: r, term_months: months, offset_balance: parseFloat(offsetBalance) || 50000 }),
        monthlyIncome
          ? callCalc('/api/property-scenario/calculators/borrowing-power', { monthly_income: parseFloat(monthlyIncome), monthly_expenses: parseFloat(monthlyExpenses) || 0, term_months: months, annual_rate_pct: r })
          : Promise.resolve(null),
      ]);
      setResults({ repayment: rep, extra_repayments: xRep, offset: off, borrowing_power: bp });
    } catch (err) {
      setError(err.message || 'Calculation failed');
    } finally {
      setLoading(false);
    }
  }

  const FIELD = {
    borderColor: 'var(--color-border)', background: 'var(--color-bg)',
    color: 'var(--color-text)', borderRadius: 8, border: '1px solid',
    padding: '8px 12px', fontSize: 14, width: '100%', outline: 'none',
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border p-4 sm:p-5 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Loan details</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Enter your own numbers to get instant estimates. These calculators are standalone — they do not create a scenario and have no connection to stamp duty, CGT, or lender comparisons.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Loan amount ($)</span>
            <input type="text" inputMode="numeric" value={loanAmount} onChange={(e) => setLoanAmount(e.target.value)} placeholder="e.g. 500000" style={FIELD} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Interest rate (% p.a.)</span>
            <input type="text" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 6.10" style={FIELD} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Loan term (years)</span>
            <input type="text" inputMode="numeric" value={termYears} onChange={(e) => setTermYears(e.target.value)} placeholder="e.g. 25" style={FIELD} />
          </label>
        </div>

        <div className="pt-2 border-t space-y-1" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Optional — used for specific calculators</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs" style={{ color: 'var(--color-text)' }}>Extra monthly repayment ($)</span>
              <input type="text" inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. 200" style={FIELD} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs" style={{ color: 'var(--color-text)' }}>Offset account balance ($)</span>
              <input type="text" inputMode="numeric" value={offsetBalance} onChange={(e) => setOffsetBalance(e.target.value)} placeholder="e.g. 50000" style={FIELD} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs" style={{ color: 'var(--color-text)' }}>Monthly income ($) — for borrowing power</span>
              <input type="text" inputMode="numeric" value={monthlyIncome} onChange={(e) => setMonthlyIncome(e.target.value)} placeholder="e.g. 8000 (leave blank to skip)" style={FIELD} />
            </label>
          </div>
        </div>

        {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}

        <button
          type="button"
          disabled={loading}
          onClick={runCalcs}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          {getIcon('calculator', { size: 14 })}
          {loading ? 'Calculating…' : 'Calculate'}
        </button>
      </div>

      {results && (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { key: 'repayment', title: 'Monthly repayment', result: results.repayment },
              { key: 'extra_repayments', title: `Extra repayments (+$${extra || 200}/mo)`, result: results.extra_repayments },
              { key: 'offset', title: `Offset account ($${Number(offsetBalance || 50000).toLocaleString('en-AU')})`, result: results.offset },
              results.borrowing_power ? { key: 'borrowing_power', title: 'Borrowing power', result: results.borrowing_power } : null,
            ].filter(Boolean).map((c) => (
              <div key={c.key} className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{c.title}</p>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
                  {c.result?.explanation || (c.result?.ok === false ? `Error: ${c.result?.errors?.[0] || 'calculation failed'}` : '—')}
                </p>
                {c.key === 'borrowing_power' && c.result?.caveats?.[0] && (
                  <p className="text-xs leading-relaxed" style={{ color: '#b45309' }}>{c.result.caveats[0]}</p>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={pdfBusy}
            onClick={async () => {
              setPdfBusy(true);
              try {
                await downloadCalcsPdf(
                  { loanAmount: parseFloat(loanAmount), rate: parseFloat(rate), termYears: parseFloat(termYears), extra: parseFloat(extra) || 200, offsetBalance: parseFloat(offsetBalance) || 50000 },
                  results
                );
              } catch (err) {
                console.error('[PDF] calculators failed:', err);
              } finally {
                setPdfBusy(false);
              }
            }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}
          >
            {getIcon('download', { size: 13 })}
            {pdfBusy ? 'Generating…' : 'Download calculator report (PDF)'}
          </button>
        </div>
      )}
    </div>
  );
}

function PdfDownloadButtons({ calcResult, scenarioType, inputs, getIcon, addToast, followUpAnswers }) {
  const [busy, setBusy] = React.useState(null);

  const options = [
    { key: 'overview', label: 'This tab' },
    { key: 'lenders', label: 'Lenders' },
    { key: 'followups', label: 'Follow-ups' },
    { key: 'all', label: 'Full report' },
  ];

  async function handleDownload(key) {
    setBusy(key);
    try {
      await downloadPdf(calcResult, inputs, scenarioType, key, followUpAnswers);
    } catch (err) {
      // Log the full error so it's visible in browser DevTools console
      console.error('[PDF] generation failed:', err);
      const msg = err?.message || String(err) || 'unknown error';
      addToast('PDF generation failed — ' + msg, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-1.5 ml-auto flex-wrap">
      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Download PDF</span>
      {options.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          disabled={busy !== null}
          onClick={() => handleDownload(key)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
          style={{
            borderColor: 'var(--color-border)',
            color: key === 'all' ? '#fff' : 'var(--color-text)',
            background: key === 'all' ? 'var(--color-primary)' : 'transparent',
          }}
        >
          {busy === key ? '…' : getIcon('download', { size: 12 })}
          {busy === key ? 'Generating…' : label}
        </button>
      ))}
    </div>
  );
}

function inferInputType(fieldPath = '', message = '') {
  const path = String(fieldPath).toLowerCase();
  const msg = String(message).toLowerCase();
  if (/fixed_or_variable/.test(path) || /rate\s*type|fixed or variable/.test(msg)) return 'rate_type';
  if (/date|settlement|purchase_date|payout/.test(path) || /\bdate\b/.test(msg)) return 'date';
  if (/rate|pct|percent|lvr/.test(path) || /%|per\s*cent|rate/.test(msg)) return 'number';
  if (/balance|amount|price|value|cost|deposit|fee/.test(path) || /\$|dollar|deposit|balance|price|cost/.test(msg)) return 'number';
  if (/months|term|years?/.test(path) || /month|year|term/.test(msg)) return 'number';
  if (/state/.test(path) || /\b(nsw|vic|qld|sa|wa|tas|act|nt)\b/.test(msg)) return 'state';
  if (/true|false|yes|no|ppor|first.?home|fhb|investment/.test(path + ' ' + msg)) return 'boolean';
  return 'text';
}

function coerceRateType(raw) {
  const v = String(raw || '').toLowerCase().trim();
  if (v === 'fixed') return 'fixed';
  if (v === 'variable' || v === 'var') return 'variable';
  if (v === 'split') return 'split';
  return raw;
}

function coerceAnswer(raw, type) {
  if (raw == null || raw === '') return undefined;
  if (type === 'boolean') {
    const v = String(raw).toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(v)) return true;
    if (['false', 'no', 'n', '0'].includes(v)) return false;
    return raw;
  }
  if (type === 'number') {
    const n = Number(String(raw).replace(/[$,%\s,]/g, ''));
    return Number.isFinite(n) ? n : raw;
  }
  if (type === 'state') return String(raw).trim().toUpperCase();
  if (type === 'rate_type') return coerceRateType(raw);
  return raw;
}

function ResultsView({ demo, tab, setTab, loading, error, scenarioType, followUpAnswers, onFollowUpAnswer }) {
  const calc = demo?.calculation;
  const charts = demo?.charts;

  return (
    <>
      {demo?.lender_source === 'cdr_prd' && demo?.coverage && (
        <div
          className="rounded-xl border px-4 py-3 text-sm space-y-1"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
        >
          <p className="font-medium">Live CDR Product Reference Data</p>
          <p style={{ color: 'var(--color-muted)' }}>{demo.coverage.summary}</p>
          {demo.coverage.succeeded?.length > 0 && (
            <p className="text-xs" style={{ color: '#166534' }}>
              OK: {demo.coverage.succeeded.join(', ')}
            </p>
          )}
          {demo.coverage.failed?.length > 0 && (
            <p className="text-xs" style={{ color: '#b45309' }}>
              Issues: {demo.coverage.failed.map((f) => f.bank).join(', ')}
            </p>
          )}
        </div>
      )}

      {demo?.stub_notice && (
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: '#f59e0b', background: '#fef3c7', color: '#b45309' }}
        >
          {demo.stub_notice}
        </div>
      )}

      {demo?.funding_alert && <FundingAlertBanner alert={demo.funding_alert} />}

      {loading && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      )}
      {error && !loading && (
        <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
      )}

      {!loading && demo && (
        <div className="shrink-0 flex gap-1 overflow-x-auto -mx-1 px-1 pb-1">
          {TABS.filter((t) => {
            // Charts tab only makes sense for refinance/compound (loan amortisation, break-even)
            if (t.id === 'charts' && scenarioType && ['sell', 'buy'].includes(scenarioType)) return false;
            return true;
          }).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-opacity duration-200 hover:opacity-70"
              style={{
                background: tab === t.id ? 'var(--color-primary)' : 'transparent',
                color: tab === t.id ? '#fff' : 'var(--color-muted)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {!loading && demo && tab === 'overview' && (
        <>
          <div className="grid sm:grid-cols-4 gap-3">
            {(() => {
              const t = calc?.totals || {};
              const events = calc?.event_results || [];
              const hasRefinance = events.some((e) => ['switch_lender', 'refinance'].includes(e.type));
              const hasSell = events.some((e) => e.type === 'sell');
              const hasBuy = events.some((e) => e.type === 'buy');
              if (hasRefinance && !hasSell && !hasBuy) {
                return [
                  { label: 'Switch costs', value: t.refinance_fees },
                  { label: 'Break costs', value: t.break_costs },
                  { label: 'Monthly saving', value: t.monthly_repayment_saving },
                  { label: 'Annualised saving', value: t.annualised_repayment_saving },
                ];
              }
              if (hasSell && !hasBuy) {
                return [
                  { label: 'Net proceeds', value: t.sale_proceeds_generated },
                  { label: 'Selling costs', value: t.selling_costs },
                  { label: 'Taxable gain (CGT)', value: t.taxable_cgt_estimate },
                  { label: 'Total costs', value: t.total_costs },
                ];
              }
              if (hasBuy && !hasSell) {
                return [
                  { label: 'Stamp duty', value: t.stamp_duty },
                  { label: 'LMI', value: t.lmi },
                  { label: 'Total upfront costs', value: t.total_costs },
                  { label: 'Deposit from sale', value: t.deposit_funded_from_sale },
                ];
              }
              return [
                { label: 'Total costs', value: t.total_costs },
                { label: 'Stamp duty', value: t.stamp_duty },
                { label: 'Deposit from sale', value: t.deposit_funded_from_sale },
                { label: 'Monthly saving', value: t.monthly_repayment_saving },
              ];
            })().map((s) => (
              <div key={s.label} className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{s.label}</p>
                <p className="text-lg font-semibold mt-1" style={{ color: 'var(--color-text)' }}>
                  {s.value != null ? `$${Number(s.value).toLocaleString('en-AU', { maximumFractionDigits: 0 })}` : '—'}
                </p>
              </div>
            ))}
          </div>

          <Section title="Cost / benefit summary" hint="From Stage 4 orchestrator output">
            <ScenarioSummaryTable summary={demo.summary_table} />
          </Section>

          <Section title="Cash-flow timeline" hint="Dependency-aware sell → buy → switch">
            <CashFlowTimeline timeline={calc?.cash_flow_timeline || []} />
          </Section>
        </>
      )}

      {!loading && demo && tab === 'charts' && (
        <div className="space-y-5">
          <Section
            title="Rate / cost comparison"
            hint={demo.lender_source === 'cdr_prd' ? 'Live CDR advertised vs comparison rates' : 'Stub lender advertised vs comparison rates'}
          >
            <RateComparisonChart data={charts?.rate_comparison} />
          </Section>
          <Section title="Total cost over loan life" hint="Cumulative interest (dashed) vs interest + fees (solid)">
            <CumulativeCostChart pack={charts?.cumulative_cost} />
          </Section>
          <Section
            title="Amortisation schedule"
            hint={`Principal vs interest by year · $${Number(charts?.amortization?.loan_amount || 0).toLocaleString()} @ ${charts?.amortization?.rate}%`}
          >
            <AmortizationChart pack={charts?.amortization} />
          </Section>
          <Section title="Refinance break-even" hint={charts?.break_even?.note}>
            <BreakEvenChart pack={charts?.break_even} />
          </Section>
        </div>
      )}

      {!loading && demo && tab === 'lenders' && (
        <>
          <Section
            title="Lender comparison grid"
            hint={demo.lenders?.data_note || demo.stub_notice || (demo.lender_source === 'cdr_prd' ? 'Live CDR PRD' : 'Stub data')}
          >
            <LenderComparisonTable rows={demo.lenders?.rows || []} />
          </Section>
          <Section
            title="Ask about a lender's terms"
            hint="Reads the linked T&Cs/PDS — exploratory only. Never changes scenario totals or charts."
          >
            <LenderTermsInsight rows={demo.lenders?.rows || []} />
          </Section>
        </>
      )}

      {!loading && demo && tab === 'calculators' && (() => {
        const calcs = demo.calculators;
        // Pull the loan basis from the calc result so users know what numbers were used
        const loanBasis = calcs?._loan_basis;
        const loanAmt = loanBasis?.loan_amount || calcs?.repayment?.loan_amount;
        const loanRate = loanBasis?.rate || calcs?.repayment?.rate;
        const loanTerm = loanBasis?.term_months || calcs?.repayment?.term_months;
        return (
          <div className="space-y-3">
            {(loanAmt || loanRate || loanTerm) ? (
              <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>
                  Loan basis for these calculators
                </p>
                <p style={{ color: 'var(--color-text)' }}>
                  {loanAmt ? `$${Number(loanAmt).toLocaleString('en-AU')} loan` : ''}
                  {loanRate ? ` at ${loanRate}% p.a.` : ''}
                  {loanTerm ? ` over ${loanTerm} months (${(loanTerm / 12).toFixed(1)} yrs)` : ''}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  These four calculators run on the loan modelled in your scenario. They are standalone — they do not feed back into the scenario totals or charts.
                  {scenarioType === 'sell' && ' For a sell scenario, the loan basis is drawn from any associated loan in the scenario; if none, default figures are used.'}
                  {scenarioType === 'buy' && ' For a buy scenario, the loan basis is drawn from your purchase price minus deposit.'}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <p style={{ color: 'var(--color-muted)' }}>
                  These four calculators (repayment, extra repayments, offset benefit, borrowing power) run against the loan modelled in your scenario. They are standalone estimates — they do not affect the scenario totals, CGT, stamp duty, or any other result on the other tabs.
                </p>
              </div>
            )}
            <CalculatorSnapshots calculators={calcs} />
          </div>
        );
      })()}

      {!loading && demo && tab === 'advice' && (
        <Section title="Advice & follow-ups" hint="Generated from Stage 4 caveats and assumptions">
          {onFollowUpAnswer ? (
            <FollowUpPanel
              advice={demo.advice}
              calcResult={demo}
              scenarioType={scenarioType}
              answers={followUpAnswers || {}}
              onAnswer={onFollowUpAnswer}
            />
          ) : (
            <AdvicePanel advice={demo.advice} />
          )}
        </Section>
      )}
    </>
  );
}

function PropertyScenarioHelp({ onClose, getIcon }) {
  const BOUNDARY_ROWS = [
    { crossing: 'Free text → structured Scenario', what: 'Your sentences → events/fields', enforcement: 'Deterministic span extraction runs first (currency, %, dates found in your literal text). The LLM only assigns those spans — it never invents new numbers. Grounding strips anything in the LLM\'s output with no matching span.' },
    { crossing: 'Structured Scenario → clarifying questions', what: 'Ambiguity → questions', enforcement: 'Pure deterministic logic — if a required field is missing or stripped, a question is generated. No LLM judgment involved in whether to ask.' },
    { crossing: 'Answered Scenario → calculations', what: 'Confirmed fields → dollar figures', enforcement: 'Hard boundary. Nothing enters calc/* unless ready_for_calculations is true. This is the most protected crossing in the whole system.' },
    { crossing: 'Shortfall detection → bridging cost', what: 'A structural gap → an indicative cost', enforcement: 'The detection (funding_alert) is deterministic. The cost estimate is deterministic math (rate × amount × time) — no LLM involved. It\'s excluded from totals on principle.' },
    { crossing: 'CDR rate data → comparison table', what: 'Bank API data → table rows', enforcement: 'Fully deterministic, except one filtering decision: excluding special-purpose products (green loans, staff offers) uses regex pattern matching against product titles — deterministic, but pattern-based. Edge cases are possible.' },
    { crossing: 'Lender documents → Insight findings', what: 'Real PDS/T&Cs text → answers', enforcement: 'The only genuinely open crossing. The LLM reasons freely here. Enforcement is citation-or-refusal and structural isolation — this layer cannot write back into Scenario/calc/totals no matter what it concludes.' },
  ];

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col rounded-2xl border shadow-2xl mx-4 overflow-hidden"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', width: '100%', maxWidth: 760, maxHeight: '90dvh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            {getIcon('book', { size: 16 })}
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Property Scenario — How it works</span>
          </div>
          <button
            onClick={onClose}
            style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
          >
            {getIcon('close', { size: 18 })}
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-6 py-5 space-y-6 text-sm" style={{ color: 'var(--color-text)' }}>

          {/* Intro */}
          <p style={{ color: 'var(--color-muted)' }}>
            Two different tools share this page, deliberately kept apart. Understanding which one you're using — and why — is the key to getting the most out of it without being misled.
          </p>

          {/* Part 1 */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>Part 1 — Scenario Engine (Stages 1–10)</h2>
            <p><strong>What it's for:</strong> "I'm doing X — what will it actually cost, and what should I watch out for?"</p>
            <p style={{ color: 'var(--color-muted)' }}>Every dollar figure the Scenario Engine produces is exact, reproducible math. The LLM's only job here is turning your sentences into structured inputs for that math — it never touches the numbers themselves.</p>
            <ol className="space-y-2 list-decimal list-inside" style={{ color: 'var(--color-muted)' }}>
              <li>Go to <strong style={{ color: 'var(--color-text)' }}>Describe your situation</strong> and write in plain English — compound situations work: <em>"selling in Randwick, buying a new place, and switching from BigBank to OnlineBank."</em></li>
              <li>The parser extracts events, amounts, rates and dates deterministically, then uses the LLM to assign them to the right fields and judge qualitative things like PPOR status.</li>
              <li>You'll almost always get a <strong style={{ color: 'var(--color-text)' }}>clarifying questions form</strong> — this is by design. The system refuses to guess your state (stamp duty varies by state), investment history (changes CGT entirely), or fixed-rate period (changes break-cost math by years, not months).</li>
              <li>Once enough is answered you get a KPI strip, cost/benefit summary, cash-flow timeline, charts and lender comparison — all deterministic.</li>
            </ol>
            <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Tips for better results</p>
              <ul className="space-y-1 text-xs list-disc list-inside" style={{ color: 'var(--color-muted)' }}>
                <li>Be specific about timing — "selling and buying simultaneously" vs "buying before my sale settles" triggers very different paths (the second triggers the bridging alert).</li>
                <li>Answer the PPOR/investment-status question carefully — it's the single field that decides whether CGT is $0 or a real number.</li>
                <li>If you see a <strong style={{ color: '#f59e0b' }}>funding alert banner</strong>, that's the system telling you the scenario isn't resolved yet. The bridging cost shown is informational only, not a green light.</li>
                <li>Treat every figure as trustworthy math given your inputs. If a number looks wrong, check what you told it — not whether the formula is right.</li>
              </ul>
            </div>
          </section>

          {/* Part 2 */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>Part 2 — Insight Layer (Stage 11)</h2>
            <p><strong>What it's for:</strong> "What does the fine print on this lender's product actually say?" — questions a comparison site's filter UI can't answer.</p>
            <p style={{ color: 'var(--color-muted)' }}>This layer is open-ended, exploratory, and genuinely allowed to be wrong or incomplete — but it's walled off so it can never feed into the Scenario Engine's numbers.</p>
            <ol className="space-y-2 list-decimal list-inside" style={{ color: 'var(--color-muted)' }}>
              <li>Go to the <strong style={{ color: 'var(--color-text)' }}>Lenders tab → Ask about a lender's terms.</strong></li>
              <li>Pick a product from the live comparison and ask anything genuinely open-ended:<br />
                <span className="italic">"What's the catch with this rate?" / "Can I make unlimited extra repayments?" / "Would irregular self-employed income qualify under this wording?"</span></li>
              <li>You get findings with <strong style={{ color: 'var(--color-text)' }}>citations back to the actual document</strong> — and explicit statements when something isn't addressed, rather than a confident guess.</li>
            </ol>
            <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Tips for better results</p>
              <ul className="space-y-1 text-xs list-disc list-inside" style={{ color: 'var(--color-muted)' }}>
                <li>Ask comparative questions across products — "which of these has no cap on extra repayments" requires reading multiple documents, which is where this earns its keep.</li>
                <li>Push on marketing-vs-fine-print gaps deliberately — "the headline says unlimited repayments, does the PDS actually say that?" is exactly the question this layer was built for.</li>
                <li>Treat every answer as a starting point for verification, not a final word. This is the one part of this tool that can be wrong — that's an accepted tradeoff, not an oversight.</li>
              </ul>
            </div>
          </section>

          {/* Crossover map */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>The Crossover Map — where probabilistic and deterministic meet</h2>
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
                    <th className="text-left px-4 py-2.5 font-semibold border-b" style={{ borderColor: 'var(--color-border)', width: '28%' }}>Boundary</th>
                    <th className="text-left px-4 py-2.5 font-semibold border-b" style={{ borderColor: 'var(--color-border)', width: '22%' }}>What crosses it</th>
                    <th className="text-left px-4 py-2.5 font-semibold border-b" style={{ borderColor: 'var(--color-border)' }}>What's enforced at the crossing</th>
                  </tr>
                </thead>
                <tbody>
                  {BOUNDARY_ROWS.map((row, i) => (
                    <tr key={i} style={{ borderBottom: i < BOUNDARY_ROWS.length - 1 ? `1px solid var(--color-border)` : 'none' }}>
                      <td className="px-4 py-3 align-top font-medium" style={{ color: 'var(--color-text)' }}>{row.crossing}</td>
                      <td className="px-4 py-3 align-top" style={{ color: 'var(--color-muted)' }}>{row.what}</td>
                      <td className="px-4 py-3 align-top" style={{ color: 'var(--color-muted)' }}>{row.enforcement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* One sentence */}
          <section className="rounded-xl p-4 border-l-4" style={{ background: 'var(--color-bg)', borderLeftColor: 'var(--color-primary)', borderTopColor: 'var(--color-border)', borderRightColor: 'var(--color-border)', borderBottomColor: 'var(--color-border)', border: '1px solid var(--color-border)', borderLeft: '4px solid var(--color-primary)' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>The one sentence that matters most</p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Every dollar figure on the Scenario side has passed through deterministic math and cannot be influenced by the LLM getting something wrong — the LLM's only failure mode there is asking an unnecessary question, never producing a wrong number. The Insight Layer is the opposite: open, capable of being incomplete or wrong, and deliberately kept unable to touch anything on the Scenario side.
            </p>
            <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
              If you ever see a number that appears to have come from an open-ended question, that's worth reporting — it means the structural isolation test didn't catch something it was specifically built to catch.
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t shrink-0 flex justify-end" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-70"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PropertyScenarioPage() {
  const navigate = useNavigate();
  const getIcon = useIcon();
  const user = useAuthStore((s) => s.user);
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const isAdmin = Boolean(user?.isAdmin);
  const [helpOpen, setHelpOpen] = useState(false);
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const [mode, setMode] = useState('describe');
  const [tab, setTab] = useState('overview');

  // Example (fixture) path
  const [demoLoading, setDemoLoading] = useState(false);
  const [demo, setDemo] = useState(null);
  const [demoError, setDemoError] = useState(null);

  // Live NLP path
  const [text, setText] = useState('');
  // Pre-parse context (collected before LLM call to reduce clarifying questions)
  const [preState, setPreState] = useState('');
  const [prePpor, setPrePpor] = useState('');
  const [pipeline, setPipeline] = useState(null);
  const [pipelineError, setPipelineError] = useState(null);
  const [answers, setAnswers] = useState({});
  const [assumeSellingCosts, setAssumeSellingCosts] = useState(true);

  // ── Scenario type routing ──────────────────────────────────────────────────
  // null = type picker · 'refinance' | 'sell' | 'buy' | 'compound' | 'calculators'
  const [scenarioType, setScenarioType] = useState(null);

  // Refinance form fields
  const [rfState, setRfState] = useState('');
  const [rfBalance, setRfBalance] = useState('');
  const [rfRate, setRfRate] = useState('');
  const [rfRateType, setRfRateType] = useState('variable');
  const [rfTermMonths, setRfTermMonths] = useState('');
  const [rfFixedPeriod, setRfFixedPeriod] = useState('');
  const [rfTargetMode, setRfTargetMode] = useState('cdr');
  const [rfTargetRate, setRfTargetRate] = useState('');

  // Sell form fields
  const [sellState, setSellState] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [sellPurchasePrice, setSellPurchasePrice] = useState('');
  const [sellPurchaseYear, setSellPurchaseYear] = useState('');
  const [sellPpor, setSellPpor] = useState('ppor');

  // Buy form fields
  const [buyState, setBuyState] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [buyDeposit, setBuyDeposit] = useState('');
  const [buyFhb, setBuyFhb] = useState('no');
  const [buyPpor, setBuyPpor] = useState('ppor');

  // Direct calculation result (structured forms — no LLM)
  const [calcResult, setCalcResult] = useState(null);
  const [calcError, setCalcError] = useState(null);

  // Follow-up Q&A: { [questionText]: answerText }
  // Reset whenever a new calculation is run so stale answers don't carry over.
  const [followUpAnswers, setFollowUpAnswers] = useState({});

  const handleFollowUpAnswer = useCallback((question, answer) => {
    setFollowUpAnswers((prev) => ({ ...prev, [question]: answer }));
  }, []);

  const canUse = isAdmin || featureAccess.propertyScenario !== false;

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((data) => {
        if (data?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags });
      })
      .catch(() => {});
  }, []);

  const loadDemo = useCallback(async () => {
    setDemoLoading(true);
    setDemoError(null);
    try {
      const res = await api.get('/api/property-scenario/demo?refresh=1');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load demo');
      setDemo(data);
    } catch (err) {
      setDemoError(err.message || 'Failed to load');
      addToast(err.message || 'Failed to load property scenario demo', 'error');
    } finally {
      setDemoLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (canUse && mode === 'example' && !demo && !demoLoading) loadDemo();
  }, [canUse, mode, demo, demoLoading, loadDemo]);

  const presentation = pipeline?.presentation || null;
  const needsClarify = Boolean(
    pipeline?.ok
    && !pipeline?.ready_for_calculations
    && (pipeline?.clarifying_form?.length > 0 || pipeline?.clarifying_questions?.length > 0)
  );

  const formRows = useMemo(() => pipeline?.clarifying_form || [], [pipeline]);

  const hasSellEvent = useMemo(
    () => (pipeline?.scenario?.events || []).some((e) => e.type === 'sell'),
    [pipeline]
  );

  const submitParse = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setPipelineError('Describe your situation first.');
      return;
    }
    setPipelineError(null);
    // Append pre-context so the LLM has state/PPOR upfront — reduces clarifying questions
    const contextParts = [];
    if (preState) contextParts.push(`State: ${preState}`);
    if (prePpor === 'ppor') contextParts.push('This is my primary place of residence (PPOR).');
    if (prePpor === 'investment') contextParts.push('This property has been used as an investment property.');
    const fullText = contextParts.length
      ? `${trimmed}\n\nAdditional context: ${contextParts.join(' ')}`
      : trimmed;

    startProcessing('Parsing your scenario…', 'AI is assigning numbers from your text. Please don’t navigate away.');
    try {
      const res = await api.post('/api/property-scenario/parse', { text: fullText });
      const data = await res.json();
      if (!data.ok) {
        setPipeline(null);
        setPipelineError(data.message || 'Parse failed');
        addToast(data.message || 'Parse failed', 'error');
        return;
      }
      setPipeline(data);
      setAnswers({});
      setTab('overview');
      if (data.ready_for_calculations && data.presentation) {
        addToast('Scenario ready — results below', 'success');
      } else {
        addToast('Need a few details before calculating', 'info');
      }
    } catch (err) {
      setPipeline(null);
      setPipelineError(err.message || 'Parse failed');
      addToast(err.message || 'Parse failed', 'error');
    } finally {
      stopProcessing();
    }
  };

  const submitClarify = async () => {
    if (!pipeline?.scenario) return;
    setPipelineError(null);

    const fieldAnswers = {};
    const freeTextClarifications = [];

    formRows.forEach((row) => {
      const type = row.type || inferInputType(row.field_path, row.message);
      const raw = answers[row.id];
      if (raw === undefined || raw === '') return;

      if (row.field_path === 'clarifying_questions') {
        // Narrative answer — send separately for re-parse, not as a field write
        freeTextClarifications.push({ id: row.id, question: row.message, answer: String(raw) });
      } else {
        const value = coerceAnswer(raw, type);
        // Use field_path as key so validation-driven rows (not in unresolved_assumptions) apply
        const key = row.field_path || row.id;
        fieldAnswers[key] = value;
      }
    });

    startProcessing('Updating scenario…', 'Applying your answers and recalculating when ready.');
    try {
      const body = {
        scenario: pipeline.scenario,
        answers: fieldAnswers,
        free_text_clarifications: freeTextClarifications.length ? freeTextClarifications : undefined,
        source_text: pipeline.source_text || text,
        resolve_optional: true,
      };
      if (assumeSellingCosts) body.selling_cost_pct = 0.025;

      const res = await api.post('/api/property-scenario/clarify', body);
      const data = await res.json();
      if (!data.ok) {
        setPipelineError(data.message || 'Could not apply answers');
        addToast(data.message || 'Clarify failed', 'error');
        return;
      }
      setPipeline(data);
      setAnswers({});
      if (data.ready_for_calculations && data.presentation) {
        addToast('Scenario calculated', 'success');
        setTab('overview');
      } else if (data.clarifying_form?.length) {
        addToast('Still need a few more details', 'info');
      }
    } catch (err) {
      setPipelineError(err.message || 'Clarify failed');
      addToast(err.message || 'Clarify failed', 'error');
    } finally {
      stopProcessing();
    }
  };

  const resetDescribe = () => {
    setPipeline(null);
    setPipelineError(null);
    setAnswers({});
    setPreState('');
    setPrePpor('');
  };

  const resetAll = () => {
    resetDescribe();
    setScenarioType(null);
    setCalcResult(null);
    setCalcError(null);
  };

  const goBack = () => {
    setScenarioType(null);
    setCalcResult(null);
    setCalcError(null);
    setFollowUpAnswers({});
  };

  const handleTypePick = useCallback((type) => {
    if (type === 'calculators') {
      setScenarioType('calculators');
      return;
    }
    setScenarioType(type);
    setCalcError(null);
  }, []);

  // ── Direct calculation (structured forms → /calculate, no LLM) ────────────
  const submitDirect = useCallback(async (scenario, extraBody = {}) => {
    setCalcError(null);
    startProcessing('Running calculation…', 'Computing your scenario. Please don\'t navigate away.');
    try {
      const res = await api.post('/api/property-scenario/calculate', { scenario, ...extraBody });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || 'Calculation failed');
      setCalcResult(data);
      setFollowUpAnswers({});
      setTab('overview');
      addToast('Results ready', 'success');
    } catch (err) {
      setCalcError(err.message || 'Calculation failed');
      addToast(err.message || 'Calculation failed', 'error');
    } finally {
      stopProcessing();
    }
  }, [startProcessing, stopProcessing, addToast]);

  const submitRefinance = () => {
    const balance = parseFloat(rfBalance);
    const rate = parseFloat(rfRate);
    const termMonths = parseInt(rfTermMonths, 10);
    if (!balance || !rate || !termMonths) {
      setCalcError('Balance, current rate, and term remaining are required.');
      return;
    }
    const fixedPeriod = rfRateType === 'fixed' && rfFixedPeriod ? parseInt(rfFixedPeriod, 10) : undefined;
    const currentLoan = {
      balance, rate, fixed_or_variable: rfRateType, term_remaining_months: termMonths,
      ...(fixedPeriod ? { fixed_period_remaining_months: fixedPeriod } : {}),
    };
    const targetRate = rfTargetMode === 'specific' && rfTargetRate ? parseFloat(rfTargetRate) : rate;
    const targetLoan = { ...currentLoan, rate: targetRate };
    submitDirect(
      {
        id: `sc_${Date.now()}`, title: 'Refinance / switch lender', currency: 'AUD',
        starting_properties: [{ id: 'prop_1', label: 'Current property', current_loan: currentLoan }],
        events: [{ id: 'ev_1', type: 'switch_lender', sequence: 1, label: 'Switch lender',
          fields: { property_id: 'prop_1', current_loan: currentLoan, target_loan: targetLoan } }],
        unresolved_assumptions: [], dependencies: [],
      },
      // Pass state so the server can look up the correct government mortgage registration fees
      rfState ? { state: rfState } : {}
    );
  };

  const submitSell = () => {
    const salePrice = parseFloat(sellPrice);
    const purchasePrice = parseFloat(sellPurchasePrice);
    if (!sellState || !salePrice || !purchasePrice) {
      setCalcError('State, expected sale price, and original purchase price are required.');
      return;
    }
    const purchaseDate = sellPurchaseYear ? `${sellPurchaseYear}-07-01` : undefined;
    submitDirect({
      id: `sc_${Date.now()}`, title: 'Property sale', currency: 'AUD',
      starting_properties: [{ id: 'prop_1', label: 'Property', state: sellState,
        is_ppor: sellPpor === 'ppor', was_ever_investment_property: sellPpor !== 'ppor' }],
      events: [{ id: 'ev_1', type: 'sell', sequence: 1, label: 'Sell',
        fields: { property_id: 'prop_1', state: sellState, property_value: salePrice,
          purchase_price: purchasePrice, was_ever_investment_property: sellPpor !== 'ppor',
          ...(purchaseDate ? { purchase_date: purchaseDate } : {}) } }],
      unresolved_assumptions: [], dependencies: [],
    });
  };

  const submitBuy = () => {
    const price = parseFloat(buyPrice);
    const deposit = parseFloat(buyDeposit);
    if (!buyState || !price || !deposit) {
      setCalcError('State, purchase price, and deposit are required.');
      return;
    }
    submitDirect({
      id: `sc_${Date.now()}`, title: 'Property purchase', currency: 'AUD',
      starting_properties: [],
      events: [{ id: 'ev_1', type: 'buy', sequence: 1, label: 'Buy',
        fields: { property_id: 'prop_1', state: buyState, property_value: price,
          is_first_home_buyer: buyFhb === 'yes', is_ppor: buyPpor === 'ppor',
          deposit_amount: deposit,
          loan: { balance: price - deposit, term_remaining_months: 360, fixed_or_variable: 'variable' } } }],
      unresolved_assumptions: [], dependencies: [],
    });
  };

  if (!canUse) return <Navigate to="/" replace />;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {helpOpen && <PropertyScenarioHelp onClose={() => setHelpOpen(false)} getIcon={getIcon} />}
      <header
        className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold truncate" style={{ color: 'var(--color-text)' }}>
              Property scenario
            </h1>
            <button
              onClick={() => { localStorage.removeItem(PS_TOUR_KEY); startPropertyScenarioTour(navigate); }}
              title="Take the Property Scenario tour"
              style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, transition: 'color 0.2s' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
            >
              {getIcon('compass', { size: 15 })}
            </button>
            <button
              onClick={() => setHelpOpen(true)}
              title="How this tool works"
              style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, transition: 'color 0.2s' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
            >
              {getIcon('info', { size: 15 })}
            </button>
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {mode === 'example'
              ? (demo?.scenario_meta?.title || 'Compound sell → buy → switch (fixture demo)')
              : scenarioType === 'refinance' ? 'Instant lender comparison — no AI needed'
              : scenarioType === 'sell' ? 'CGT, selling costs, and net proceeds'
              : scenarioType === 'buy' ? 'Stamp duty, LMI, and upfront purchase costs'
              : scenarioType === 'compound' ? 'AI maps your scenario from plain English'
              : scenarioType === 'calculators' ? 'Repayment, offset, extra repayments, borrowing power'
              : 'Choose a scenario type to get started'}
          </p>
        </div>
        {mode === 'example' && (
          <button
            type="button"
            onClick={loadDemo}
            disabled={demoLoading}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            {getIcon('rotate-ccw', { size: 14 })}
            Reload example
          </button>
        )}
      </header>

      <div className="shrink-0 flex gap-1 overflow-x-auto px-4 sm:px-6 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-opacity duration-200 hover:opacity-70"
            style={{
              background: mode === m.id ? 'var(--color-primary)' : 'transparent',
              color: mode === m.id ? '#fff' : 'var(--color-muted)',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">
        {mode === 'describe' && (
          <>
            {/* ── Scenario type picker ──────────────────────────────── */}
            {scenarioType === null && !calcResult && (
              <div className="space-y-4">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>What would you like to explore?</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { id: 'refinance', icon: 'refresh-cw', label: 'Compare lenders / refinance', desc: 'See if switching saves money. Instant calculation — no AI, no waiting.' },
                    { id: 'sell', icon: 'home', label: 'Sell a property', desc: 'CGT, selling costs, and net proceeds.' },
                    { id: 'buy', icon: 'key', label: 'Buy a property', desc: 'Stamp duty, LMI, and upfront purchase costs.' },
                    { id: 'compound', icon: 'layers', label: 'Multiple events at once', desc: 'Sell + buy + switch lender together. Describe in plain English — AI maps the full scenario.' },
                    { id: 'qualify', icon: 'check-circle', label: 'Can I qualify for a loan?', desc: 'Serviceability, LVR, DTI, genuine savings, First Home Guarantee — deterministic AU checks.' },
                    { id: 'calculators', icon: 'calculator', label: 'Quick calculators', desc: 'Repayment, offset, extra repayments, and borrowing power.' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleTypePick(t.id)}
                      className="flex items-start gap-3 p-4 rounded-xl border text-left transition-opacity duration-200 hover:opacity-70"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                    >
                      <span className="mt-0.5 shrink-0" style={{ color: 'var(--color-primary)' }}>{getIcon(t.icon, { size: 18 })}</span>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{t.label}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{t.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Back button for structured forms ─────────────────── */}
            {scenarioType && scenarioType !== 'compound' && !calcResult && (
              <button
                type="button"
                onClick={goBack}
                className="inline-flex items-center gap-1.5 text-sm transition-opacity duration-200 hover:opacity-70"
                style={{ color: 'var(--color-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                {getIcon('arrow-left', { size: 14 })}
                Back to scenario types
              </button>
            )}

            {/* ── Standalone calculators ───────────────────────────── */}
            {scenarioType === 'calculators' && (
              <StandaloneCalculators getIcon={getIcon} />
            )}

            {/* ── Buyer qualification ──────────────────────────────── */}
            {scenarioType === 'qualify' && (
              <BuyerQualifyForm getIcon={getIcon} addToast={addToast} />
            )}

            {/* ── Refinance / compare lenders form ─────────────────── */}
            {scenarioType === 'refinance' && !calcResult && (
              <Section title="Refinance / compare lenders" hint="Fill in your current loan — we calculate savings against live market rates instantly. No AI involved.">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>State</span>
                      <select value={rfState} onChange={(e) => setRfState(e.target.value)} style={FIELD}>
                        <option value="">Select state (for govt fees)…</option>
                        {['NSW','VIC','QLD','SA','WA','TAS','ACT','NT'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <div />
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Current loan balance ($) *</span>
                      <input type="text" inputMode="decimal" value={rfBalance} onChange={(e) => setRfBalance(e.target.value)} placeholder="e.g. 100000" style={FIELD} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Current interest rate (%) *</span>
                      <input type="text" inputMode="decimal" value={rfRate} onChange={(e) => setRfRate(e.target.value)} placeholder="e.g. 6.10" style={FIELD} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Rate type</span>
                      <select value={rfRateType} onChange={(e) => setRfRateType(e.target.value)} style={FIELD}>
                        <option value="variable">Variable</option>
                        <option value="fixed">Fixed</option>
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Term remaining (months) *</span>
                      <input type="text" inputMode="numeric" value={rfTermMonths} onChange={(e) => setRfTermMonths(e.target.value)} placeholder="e.g. 240" style={FIELD} />
                    </label>
                    {rfRateType === 'fixed' && (
                      <label className="block space-y-1.5">
                        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Fixed period remaining (months)</span>
                        <input type="text" inputMode="numeric" value={rfFixedPeriod} onChange={(e) => setRfFixedPeriod(e.target.value)} placeholder="e.g. 24" style={FIELD} />
                      </label>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>Compare against</p>
                    <div className="flex flex-col gap-2">
                      {[
                        { v: 'cdr', label: 'Live market rates — 8 major Australian lenders via CDR open banking' },
                        { v: 'specific', label: 'A specific rate I have in mind' },
                      ].map(({ v, label }) => (
                        <label key={v} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                          <input type="radio" name="rfTargetMode" value={v} checked={rfTargetMode === v} onChange={() => setRfTargetMode(v)} />
                          {label}
                        </label>
                      ))}
                      {rfTargetMode === 'specific' && (
                        <input type="text" inputMode="decimal" value={rfTargetRate} onChange={(e) => setRfTargetRate(e.target.value)} placeholder="Target rate, e.g. 5.89" style={{ ...FIELD, maxWidth: 220 }} />
                      )}
                    </div>
                  </div>
                  {calcError && <p className="text-sm" style={{ color: '#ef4444' }}>{calcError}</p>}
                  <button type="button" onClick={submitRefinance} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70" style={{ background: 'var(--color-primary)', color: '#fff' }}>
                    {getIcon('sparkles', { size: 14 })}
                    Calculate
                  </button>
                </div>
              </Section>
            )}

            {/* ── Sell a property form ──────────────────────────────── */}
            {scenarioType === 'sell' && !calcResult && (
              <Section title="Sell a property" hint="CGT, selling costs, and net proceeds based on your inputs.">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>State *</span>
                      <select value={sellState} onChange={(e) => setSellState(e.target.value)} style={FIELD}>
                        <option value="">Select state…</option>
                        {['NSW','VIC','QLD','SA','WA','TAS','ACT','NT'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Property type</span>
                      <select value={sellPpor} onChange={(e) => setSellPpor(e.target.value)} style={FIELD}>
                        <option value="ppor">Primary residence (PPOR) — CGT main residence exemption applies</option>
                        <option value="investment">Investment property — CGT applies</option>
                        <option value="mixed">Was PPOR then investment (or vice versa) — partial CGT</option>
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Expected sale price ($) *</span>
                      <input type="text" inputMode="decimal" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} placeholder="e.g. 1200000" style={FIELD} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Original purchase price ($) *</span>
                      <input type="text" inputMode="decimal" value={sellPurchasePrice} onChange={(e) => setSellPurchasePrice(e.target.value)} placeholder="e.g. 750000" style={FIELD} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Year purchased</span>
                      <input type="text" inputMode="numeric" value={sellPurchaseYear} onChange={(e) => setSellPurchaseYear(e.target.value)} placeholder="e.g. 2015" style={FIELD} />
                    </label>
                  </div>
                  {calcError && <p className="text-sm" style={{ color: '#ef4444' }}>{calcError}</p>}
                  <button type="button" onClick={submitSell} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70" style={{ background: 'var(--color-primary)', color: '#fff' }}>
                    {getIcon('sparkles', { size: 14 })}
                    Calculate
                  </button>
                </div>
              </Section>
            )}

            {/* ── Buy a property form ───────────────────────────────── */}
            {scenarioType === 'buy' && !calcResult && (
              <Section title="Buy a property" hint="Stamp duty, LMI, and upfront purchase costs — deterministic AU rules.">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>State *</span>
                      <select value={buyState} onChange={(e) => setBuyState(e.target.value)} style={FIELD}>
                        <option value="">Select state…</option>
                        {['NSW','VIC','QLD','SA','WA','TAS','ACT','NT'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Property purpose</span>
                      <select value={buyPpor} onChange={(e) => setBuyPpor(e.target.value)} style={FIELD}>
                        <option value="ppor">Primary residence (PPOR)</option>
                        <option value="investment">Investment property</option>
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Purchase price ($) *</span>
                      <input type="text" inputMode="decimal" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} placeholder="e.g. 1200000" style={FIELD} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Deposit ($) *</span>
                      <input type="text" inputMode="decimal" value={buyDeposit} onChange={(e) => setBuyDeposit(e.target.value)} placeholder="e.g. 240000" style={FIELD} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>First home buyer?</span>
                      <select value={buyFhb} onChange={(e) => setBuyFhb(e.target.value)} style={FIELD}>
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </select>
                    </label>
                  </div>
                  {calcError && <p className="text-sm" style={{ color: '#ef4444' }}>{calcError}</p>}
                  <button type="button" onClick={submitBuy} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70" style={{ background: 'var(--color-primary)', color: '#fff' }}>
                    {getIcon('sparkles', { size: 14 })}
                    Calculate
                  </button>
                </div>
              </Section>
            )}

            {/* ── Structured form results ───────────────────────────── */}
            {calcResult?.ready_for_calculations && (
              <>
                {/* Input summary — what was used in the calculation */}
                <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>What was calculated</p>
                  {scenarioType === 'refinance' && (
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
                      {[
                        rfState ? { label: 'State', value: rfState } : null,
                        { label: 'Current balance', value: rfBalance ? `$${Number(rfBalance).toLocaleString('en-AU')}` : '—' },
                        { label: 'Current rate', value: rfRate ? `${rfRate}% p.a.` : '—' },
                        { label: 'Rate type', value: rfRateType || '—' },
                        { label: 'Term remaining', value: rfTermMonths ? `${rfTermMonths} months (${(Number(rfTermMonths) / 12).toFixed(1)} yrs)` : '—' },
                        rfRateType === 'fixed' && rfFixedPeriod ? { label: 'Fixed period remaining', value: `${rfFixedPeriod} months` } : null,
                        { label: 'Compared against', value: rfTargetMode === 'cdr' ? 'Live CDR — best available rate' : rfTargetRate ? `${rfTargetRate}% (your target)` : 'CDR' },
                      ].filter(Boolean).map(({ label, value }) => (
                        <div key={label}>
                          <dt className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</dt>
                          <dd className="font-medium" style={{ color: 'var(--color-text)' }}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {scenarioType === 'sell' && (
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
                      {[
                        { label: 'State', value: sellState || '—' },
                        { label: 'Property type', value: sellPpor === 'ppor' ? 'PPOR' : sellPpor === 'investment' ? 'Investment' : 'Mixed' },
                        { label: 'Sale price', value: sellPrice ? `$${Number(sellPrice).toLocaleString('en-AU')}` : '—' },
                        { label: 'Purchase price', value: sellPurchasePrice ? `$${Number(sellPurchasePrice).toLocaleString('en-AU')}` : '—' },
                        sellPurchaseYear ? { label: 'Year purchased', value: sellPurchaseYear } : null,
                      ].filter(Boolean).map(({ label, value }) => (
                        <div key={label}>
                          <dt className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</dt>
                          <dd className="font-medium" style={{ color: 'var(--color-text)' }}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {scenarioType === 'buy' && (
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
                      {[
                        { label: 'State', value: buyState || '—' },
                        { label: 'Purpose', value: buyPpor === 'ppor' ? 'PPOR' : 'Investment' },
                        { label: 'Purchase price', value: buyPrice ? `$${Number(buyPrice).toLocaleString('en-AU')}` : '—' },
                        { label: 'Deposit', value: buyDeposit ? `$${Number(buyDeposit).toLocaleString('en-AU')}` : '—' },
                        { label: 'First home buyer', value: buyFhb === 'yes' ? 'Yes' : 'No' },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <dt className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</dt>
                          <dd className="font-medium" style={{ color: 'var(--color-text)' }}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <button type="button" onClick={() => setCalcResult(null)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-opacity duration-200 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                    {getIcon('sliders', { size: 13 })}
                    Adjust values
                  </button>
                  <button type="button" onClick={resetAll} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-opacity duration-200 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                    {getIcon('rotate-ccw', { size: 13 })}
                    New scenario
                  </button>
                  <PdfDownloadButtons
                    calcResult={calcResult}
                    scenarioType={scenarioType}
                    inputs={{ rfState, rfBalance, rfRate, rfRateType, rfTermMonths, rfFixedPeriod, rfTargetMode, rfTargetRate, sellState, sellPpor, sellPrice, sellPurchasePrice, sellPurchaseYear, buyState, buyPpor, buyPrice, buyDeposit, buyFhb }}
                    followUpAnswers={followUpAnswers}
                    getIcon={getIcon}
                    addToast={addToast}
                  />
                </div>
                {scenarioType === 'refinance' && (
                  <RefinanceInterpretation calcResult={calcResult} rfRate={rfRate} rfRateType={rfRateType} rfState={rfState} />
                )}
                {scenarioType === 'sell' && (
                  <SellInterpretation calcResult={calcResult} sellPpor={sellPpor} />
                )}
                {scenarioType === 'buy' && (
                  <BuyInterpretation calcResult={calcResult} />
                )}
                <ResultsView
                  demo={calcResult}
                  tab={tab}
                  setTab={setTab}
                  loading={false}
                  error={null}
                  scenarioType={scenarioType}
                  followUpAnswers={followUpAnswers}
                  onFollowUpAnswer={handleFollowUpAnswer}
                />
              </>
            )}

            {/* ── Compound NLP path (multiple events) ──────────────── */}
            {scenarioType === 'compound' && (
              <>
                <button
                  type="button"
                  onClick={goBack}
                  className="inline-flex items-center gap-1.5 text-sm transition-opacity duration-200 hover:opacity-70"
                  style={{ color: 'var(--color-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  {getIcon('arrow-left', { size: 14 })}
                  Back to scenario types
                </button>
            <Section
              title="Describe your situation"
              hint="Numbers are pre-extracted from your text, then assigned to scenario fields. Invented numbers are stripped."
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder={'e.g. I’m selling our PPOR for about $1.45m (bought 2015 for $720k), buying in Sept for $1.8m with 20% deposit, and switching the new loan to a 5.49% variable with OnlineBank…'}
                style={{ ...FIELD, resize: 'vertical', minHeight: 120 }}
              />

              {/* Pre-parse context — collected before the LLM call to reduce clarifying questions */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs shrink-0" style={{ color: 'var(--color-muted)' }}>Quick context:</span>
                <select
                  value={preState}
                  onChange={(e) => setPreState(e.target.value)}
                  style={{ ...FIELD, width: 'auto', padding: '6px 10px', fontSize: 12 }}
                >
                  <option value="">State…</option>
                  {['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <select
                  value={prePpor}
                  onChange={(e) => setPrePpor(e.target.value)}
                  style={{ ...FIELD, width: 'auto', padding: '6px 10px', fontSize: 12 }}
                >
                  <option value="">PPOR or investment?</option>
                  <option value="ppor">Primary residence (PPOR)</option>
                  <option value="investment">Investment property</option>
                </select>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={submitParse}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70"
                  style={{ background: 'var(--color-primary)', color: '#fff' }}
                >
                  {getIcon('sparkles', { size: 14 })}
                  Analyse scenario
                </button>
                {pipeline && (
                  <button
                    type="button"
                    onClick={resetDescribe}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-opacity duration-200 hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                  >
                    Start over
                  </button>
                )}
              </div>
            </Section>

            {pipelineError && (
              <div
                className="rounded-xl border px-4 py-3 text-sm"
                style={{ borderColor: '#ef4444', background: '#fff1f2', color: '#991b1b' }}
              >
                <p className="font-medium">Couldn’t complete the parse</p>
                <p className="mt-1">{pipelineError}</p>
                <p className="text-xs mt-2" style={{ color: '#991b1b' }}>
                  Try rephrasing, or use “See an example” for the deterministic fixture path.
                </p>
              </div>
            )}

            {needsClarify && (
              <Section
                title="A few details needed"
                hint="Answer these so calculations can run. Required fields only — optional gaps stay flagged."
              >
                <div className="space-y-4">
                  {formRows.map((row) => {
                    const type = row.type || inferInputType(row.field_path, row.message);
                    const displayLabel = row.label || row.message;
                    const isFreeText = row.field_path === 'clarifying_questions';
                    const placeholder = row.placeholder
                      || (type === 'number' ? 'e.g. 650000 or 5.49' : isFreeText ? 'Your answer…' : '');

                    // Suppress fixed_period_remaining_months once user picks "variable"
                    if (String(row.field_path || '').endsWith('.fixed_period_remaining_months')) {
                      const parentPath = String(row.field_path).replace(/\.fixed_period_remaining_months$/, '');
                      const rateTypeRow = formRows.find(
                        (r) => String(r.field_path || '') === `${parentPath}.fixed_or_variable`
                      );
                      if (rateTypeRow && answers[rateTypeRow.id] === 'variable') return null;
                    }

                    return (
                      <label key={row.id} className="block space-y-1.5">
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                          {displayLabel}
                        </span>
                        {type === 'boolean' ? (
                          <select
                            value={answers[row.id] ?? ''}
                            onChange={(e) => setAnswers((a) => ({ ...a, [row.id]: e.target.value }))}
                            style={FIELD}
                          >
                            <option value="">Select…</option>
                            <option value="true">Yes</option>
                            <option value="false">No</option>
                          </select>
                        ) : type === 'state' ? (
                          <select
                            value={answers[row.id] ?? ''}
                            onChange={(e) => setAnswers((a) => ({ ...a, [row.id]: e.target.value }))}
                            style={FIELD}
                          >
                            <option value="">Select state…</option>
                            {['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'].map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        ) : type === 'rate_type' ? (
                          <select
                            value={answers[row.id] ?? ''}
                            onChange={(e) => setAnswers((a) => ({ ...a, [row.id]: e.target.value }))}
                            style={FIELD}
                          >
                            <option value="">Select…</option>
                            <option value="fixed">Fixed</option>
                            <option value="variable">Variable</option>
                            <option value="split">Split</option>
                          </select>
                        ) : isFreeText ? (
                          <textarea
                            rows={2}
                            value={answers[row.id] ?? ''}
                            onChange={(e) => setAnswers((a) => ({ ...a, [row.id]: e.target.value }))}
                            placeholder={placeholder}
                            style={{ ...FIELD, resize: 'vertical', minHeight: 60 }}
                          />
                        ) : (
                          <input
                            type={type === 'date' ? 'date' : 'text'}
                            inputMode={type === 'number' ? 'decimal' : undefined}
                            value={answers[row.id] ?? ''}
                            onChange={(e) => setAnswers((a) => ({ ...a, [row.id]: e.target.value }))}
                            placeholder={placeholder}
                            style={FIELD}
                          />
                        )}
                      </label>
                    );
                  })}

                  {hasSellEvent && (
                    <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                      <input
                        type="checkbox"
                        checked={assumeSellingCosts}
                        onChange={(e) => setAssumeSellingCosts(e.target.checked)}
                        className="mt-1"
                      />
                      <span>
                        Assume selling costs at 2.5% of sale price when not specified
                        <span className="block text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                          Agent/advertising estimate only — confirm with your conveyancer.
                        </span>
                      </span>
                    </label>
                  )}

                  <button
                    type="button"
                    onClick={submitClarify}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70"
                    style={{ background: 'var(--color-primary)', color: '#fff' }}
                  >
                    {getIcon('send', { size: 14 })}
                    Submit answers
                  </button>
                </div>
              </Section>
            )}

            {pipeline?.ready_for_calculations && presentation && (
              <ResultsView
                demo={presentation}
                tab={tab}
                setTab={setTab}
                loading={false}
                error={null}
                scenarioType="compound"
                followUpAnswers={followUpAnswers}
                onFollowUpAnswer={handleFollowUpAnswer}
              />
            )}

            {pipeline?.ok && !pipeline.ready_for_calculations && !needsClarify && (
              <div
                className="rounded-xl border px-4 py-3 text-sm"
                style={{ borderColor: '#f59e0b', background: '#fef3c7', color: '#b45309' }}
              >
                Scenario isn’t ready to calculate yet, and no clarifying questions were returned.
                Try adding more specifics (amounts, state, dates) and analyse again.
              </div>
            )}

            {pipeline?.ok && !pipeline.ready_for_calculations && !needsClarify && pipeline.validation && !pipeline.validation.ok && (
              <div
                className="rounded-xl border px-4 py-3 text-sm"
                style={{ borderColor: '#f59e0b', background: '#fef3c7', color: '#b45309' }}
              >
                {pipeline.validation.errors?.length
                  ? `${pipeline.validation.errors.length} field${pipeline.validation.errors.length === 1 ? '' : 's'} still need answers — submit your responses above to continue.`
                  : 'Scenario isn\u2019t ready yet. Try adding more specifics and analyse again.'}
              </div>
            )}
                </>
            )}
          </>
        )}

        {mode === 'example' && (
          <ResultsView
            demo={demo}
            tab={tab}
            setTab={setTab}
            loading={demoLoading}
            error={demoError}
          />
        )}
      </div>
    </div>
  );
}
