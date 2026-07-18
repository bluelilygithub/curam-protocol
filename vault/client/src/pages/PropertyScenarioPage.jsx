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
async function downloadPdf(calcResult, inputs, scenarioType, tabFilter) {
  const { downloadPropertyScenarioPdf } = await import('../utils/propertyScenarioPdf');
  return downloadPropertyScenarioPdf(calcResult, inputs, scenarioType, tabFilter);
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

function RefinanceInterpretation({ calcResult, rfRateType }) {
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
  const other = Number(refi.other_costs ?? 400);
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
            † Comparison rate is a standardised figure that includes fees. The advertised rate ({best.rate}%) is used for repayment calculations above.
            Source: CDR Open Banking — live data, fetched today.
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
      <div className="space-y-1 pt-1 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Switching costs: {fmt(totalCost)}</p>
        <ul className="text-xs space-y-0.5" style={{ color: 'var(--color-muted)' }}>
          <li>Discharge fee — {fmt(discharge)} (paying out existing lender)</li>
          <li>Establishment fee — {fmt(establishment)} (new lender setup)</li>
          {other > 0 && <li>Valuation / legal / misc — {fmt(other)}</li>}
          {breakCost > 0 && <li style={{ color: '#ef4444' }}>Fixed-rate break cost (IRD estimate) — {fmt(breakCost)}</li>}
        </ul>
        {breakCost === 0 && isVariable && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Break cost: $0 — variable rate loans have no early repayment penalty under Australian law.
          </p>
        )}
        {breakCost === 0 && !isVariable && (
          <p className="text-xs mt-1" style={{ color: '#f59e0b' }}>
            Break cost: estimated $0 — actual IRD depends on your lender's comparison rate in your original contract. Confirm with your lender before switching.
          </p>
        )}
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

function SellInterpretation({ calcResult }) {
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

  const sellingCostPct = salePrice > 0 ? ((sellingCosts / salePrice) * 100).toFixed(1) : null;

  return (
    <div className="rounded-xl border-l-4 p-4 sm:p-5 space-y-3" style={{ borderLeftColor: 'var(--color-primary)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderLeft: '4px solid var(--color-primary)' }}>
      <div className="space-y-1">
        <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
          Net proceeds: {fmt(netProceeds)}
        </p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Sale price {fmt(salePrice)} minus selling costs {fmt(sellingCosts)}{sellingCostPct ? ` (${sellingCostPct}% of sale price)` : ''}.
        </p>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Selling cost estimate</p>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Assumed at 2.5% of sale price — covers agent commission (~2%) and conveyancing/marketing (~0.5%).
          Confirm the actual split with your agent and conveyancer before relying on this figure.
        </p>
      </div>

      <div className="pt-2 border-t space-y-1" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Capital gains tax</p>
        {isMreExempt ? (
          <p className="text-sm" style={{ color: '#16a34a' }}>
            Main residence exemption applies — CGT is $0.
            {grossGain > 0 ? ` (Gross gain ${fmt(grossGain)} — fully exempt.)` : ''}
          </p>
        ) : taxableCgt > 0 ? (
          <>
            <p className="text-sm" style={{ color: '#ef4444' }}>
              Taxable CGT estimate: {fmt(taxableCgt)} — included in your tax return, not at settlement.
            </p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Actual tax depends on your marginal rate and whether you've held the property &gt;12 months (50% discount may apply). Confirm with your accountant.
            </p>
          </>
        ) : (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            CGT: $0 — either exempt or no capital gain in this scenario.
          </p>
        )}
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
            This estimate uses standard premium tables; actual LMI is lender-specific and varies.
          </p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            To avoid LMI: increase deposit to {purchasePrice > 0 ? fmt(purchasePrice * 0.2) : '20% of purchase price'} (20% LVR) or use a guarantor.
          </p>
        </div>
      ) : (
        <div className="pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm" style={{ color: '#16a34a' }}>No LMI — deposit is 20% or more of purchase price.</p>
        </div>
      )}
    </div>
  );
}

function PdfDownloadButtons({ calcResult, scenarioType, inputs, getIcon, addToast }) {
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
      await downloadPdf(calcResult, inputs, scenarioType, key);
    } catch (err) {
      addToast('PDF generation failed — ' + (err.message || 'unknown error'), 'error');
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

function ResultsView({ demo, tab, setTab, loading, error }) {
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
          {TABS.map((t) => (
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
                  { label: 'Taxable CGT', value: t.taxable_cgt_estimate },
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

      {!loading && demo && tab === 'calculators' && (
        <Section title="Stage 5 calculators" hint="Standalone snapshots on the modelled loan">
          <CalculatorSnapshots calculators={demo.calculators} />
        </Section>
      )}

      {!loading && demo && tab === 'advice' && (
        <Section title="Advice & follow-ups" hint="Generated from Stage 4 caveats and assumptions">
          <AdvicePanel advice={demo.advice} />
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
  };

  const handleTypePick = useCallback((type) => {
    if (type === 'calculators') {
      setMode('example');
      setTab('calculators');
      if (!demo && !demoLoading) loadDemo();
      return;
    }
    setScenarioType(type);
    setCalcError(null);
  }, [demo, demoLoading, loadDemo]);

  // ── Direct calculation (structured forms → /calculate, no LLM) ────────────
  const submitDirect = useCallback(async (scenario) => {
    setCalcError(null);
    startProcessing('Running calculation…', 'Computing your scenario. Please don\'t navigate away.');
    try {
      const res = await api.post('/api/property-scenario/calculate', { scenario });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || 'Calculation failed');
      setCalcResult(data);
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
    submitDirect({
      id: `sc_${Date.now()}`, title: 'Refinance / switch lender', currency: 'AUD',
      starting_properties: [{ id: 'prop_1', label: 'Current property', current_loan: currentLoan }],
      events: [{ id: 'ev_1', type: 'switch_lender', sequence: 1, label: 'Switch lender',
        fields: { property_id: 'prop_1', current_loan: currentLoan, target_loan: targetLoan } }],
      unresolved_assumptions: [], dependencies: [],
    });
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

            {/* ── Refinance / compare lenders form ─────────────────── */}
            {scenarioType === 'refinance' && !calcResult && (
              <Section title="Refinance / compare lenders" hint="Fill in your current loan — we calculate savings against live market rates instantly. No AI involved.">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    inputs={{ rfBalance, rfRate, rfRateType, rfTermMonths, rfFixedPeriod, rfTargetMode, rfTargetRate, sellState, sellPpor, sellPrice, sellPurchasePrice, sellPurchaseYear, buyState, buyPpor, buyPrice, buyDeposit, buyFhb }}
                    getIcon={getIcon}
                    addToast={addToast}
                  />
                </div>
                {scenarioType === 'refinance' && (
                  <RefinanceInterpretation calcResult={calcResult} rfRate={rfRate} rfRateType={rfRateType} />
                )}
                {scenarioType === 'sell' && (
                  <SellInterpretation calcResult={calcResult} />
                )}
                {scenarioType === 'buy' && (
                  <BuyInterpretation calcResult={calcResult} />
                )}
                <ResultsView demo={calcResult} tab={tab} setTab={setTab} loading={false} error={null} />
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
