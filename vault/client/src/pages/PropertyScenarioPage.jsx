import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { startPropertyScenarioTour, TOUR_KEY as PS_TOUR_KEY } from '../utils/tours/propertyScenarioTour';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore, { runWithStepLog } from '../store/processingStore';
import FormattedNumberInput from '../components/FormattedNumberInput';
import {
  formatNumberForInput,
  parseFormattedNumber,
} from '../utils/numericInput';
import { useMarketRateDefault, isInterestRateClarifyField, formatMarketRateInput, getInitialMarketRateInput } from '../hooks/useAverageMarketRate';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import { LENDER_PROFILES } from '../utils/lenderProfiles';
import {
  mergeInitialWithProfile,
  saveFileProfileFromPayload,
  saveLastProformaSummary,
} from '../utils/propertyScenarioFileProfile';

/** Default Australian state for property / mortgage form selects. */
const DEFAULT_STATE = 'QLD';// Lazy-loaded to avoid blocking Vite build if @react-pdf/renderer has compat issues
async function downloadPdf(calcResult, inputs, scenarioType, tabFilter, followUpAnswers) {
  const { downloadPropertyScenarioPdf } = await import('../utils/propertyScenarioPdf');
  return downloadPropertyScenarioPdf(calcResult, inputs, scenarioType, tabFilter, followUpAnswers);
}

async function downloadQualifyPdf(result, inputs, eligibleLenders) {
  const { downloadQualificationPdf } = await import('../utils/propertyScenarioPdf');
  return downloadQualificationPdf(result, inputs, eligibleLenders);
}

async function downloadCalcsPdf(calcInputs, calcResults) {
  const { downloadCalculatorsPdf } = await import('../utils/propertyScenarioPdf');
  return downloadCalculatorsPdf(calcInputs, calcResults);
}

async function downloadProformaPdf(proforma, inputs) {
  const { downloadQualificationProformaPdf } = await import('../utils/propertyScenarioPdf');
  return downloadQualificationProformaPdf(proforma, inputs);
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

function FieldTip({ text }) {
  const [show, setShow] = React.useState(false);
  return (
    <span className="relative inline-flex items-center" style={{ verticalAlign: 'middle' }}>
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 13, height: 13, borderRadius: '50%',
          border: '1px solid var(--color-muted)', fontSize: 8, fontWeight: 700,
          color: 'var(--color-muted)', background: 'transparent',
          cursor: 'default', lineHeight: 1, flexShrink: 0, marginLeft: 4,
        }}
        aria-label="More information"
      >?</button>
      {show && (
        <span style={{
          position: 'absolute', bottom: '130%', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--color-text)', color: 'var(--color-bg)',
          borderRadius: 6, padding: '7px 10px',
          fontSize: 11, lineHeight: 1.55, whiteSpace: 'normal', width: 230, zIndex: 20,
          pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}>
          {text}
          <span style={{
            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
            border: '5px solid transparent', borderTopColor: 'var(--color-text)',
          }} />
        </span>
      )}
    </span>
  );
}

function LenderDiscoveryPanel({ loanAmount, targetRate, termMonths, state, isPpor, overallStatus, lenderGuidance, getIcon, onCompareRates, onProductsLoaded }) {
  const [showProfiles, setShowProfiles] = React.useState(false);
  const [products, setProducts] = React.useState([]);
  const [packMeta, setPackMeta] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(null);

  const guidanceLenderNames = new Set(
    (lenderGuidance || []).flatMap((g) => (g.lenders || []).map((l) => l.name))
  );

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const qs = new URLSearchParams({
          loan_amount: String(Math.round(loanAmount || 0)),
          term_months: String(Math.round(termMonths || 360)),
          is_ppor: isPpor === false ? 'false' : 'true',
        });
        const res = await api.get(`/api/property-scenario/calculators/buyer-qualify/eligible-lenders?${qs}`);
        const data = await res.json();
        if (cancelled) return;
        if (!data?.ok) {
          setProducts([]);
          setPackMeta(data);
          setLoadError(data?.error || data?.note || 'Could not load live lender products');
        } else {
          setProducts(data.products || []);
          setPackMeta(data);
          setLoadError(null);
          if (onProductsLoaded) onProductsLoaded(data);
        }
      } catch (err) {
        if (!cancelled) {
          setProducts([]);
          setLoadError(err.message || 'Failed to load eligible lenders');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (loanAmount > 0) load();
    else {
      setLoading(false);
      setLoadError('Loan amount required to rank products');
    }
    return () => { cancelled = true; };
  }, [loanAmount, termMonths, isPpor]);

  const profiles = LENDER_PROFILES;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <div className="px-4 py-3 flex flex-wrap items-start justify-between gap-3" style={{ background: 'var(--color-surface)' }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              {overallStatus === 'pass'
                ? 'Eligible lenders & products'
                : 'Lenders & products to discuss'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
              Live CDR rates for a ${(loanAmount || 0).toLocaleString('en-AU')} {isPpor === false ? 'investment' : 'owner-occupied'} loan
              {targetRate > 0 ? ` (your target ${targetRate}%)` : ''}. Ranked by advertised rate — not a credit decision.
            </p>
          </div>
          <button
            type="button"
            onClick={onCompareRates}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-opacity duration-200 hover:opacity-70"
            style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', background: 'transparent' }}
          >
            {getIcon('refresh-cw', { size: 13 })}
            Full refinance compare
          </button>
        </div>

        {loading && (
          <div className="px-4 py-6 text-sm" style={{ color: 'var(--color-muted)' }}>
            Fetching live rates from Australian banks via CDR…
          </div>
        )}

        {!loading && loadError && (
          <div className="px-4 py-4 space-y-2">
            <p className="text-sm" style={{ color: '#b45309' }}>{loadError}</p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              You can still open a full refinance comparison, or expand lender profiles below.
            </p>
          </div>
        )}

        {!loading && !loadError && products.length > 0 && (
          <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {products.map((p, i) => {
              const isHighlighted = [...guidanceLenderNames].some((n) => {
                const norm = String(n).toLowerCase();
                return (
                  norm.includes(String(p.lender || '').toLowerCase())
                  || String(p.lender || '').toLowerCase().includes(norm.replace(/\s*\(.*?\)\s*/g, '').trim())
                );
              });
              return (
                <div
                  key={p.id || `${p.lender}-${p.product}-${i}`}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3"
                  style={{ background: isHighlighted ? 'color-mix(in srgb, var(--color-primary) 6%, transparent)' : 'transparent' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{p.lender}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>
                        {p.fixed_or_variable === 'fixed' ? `Fixed${p.fixed_period_months ? ` ${Math.round(p.fixed_period_months / 12)}y` : ''}` : 'Variable'}
                      </span>
                      {isHighlighted && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary)', color: '#fff' }}>
                          Highlighted for you
                        </span>
                      )}
                      {i === 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#16a34a', color: '#fff' }}>
                          Lowest rate
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--color-text)' }}>{p.product || p.name}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                      <span style={{ color: p.offset ? '#16a34a' : 'var(--color-muted)' }}>{p.offset ? '✓' : '·'} Offset</span>
                      <span style={{ color: p.redraw ? '#16a34a' : 'var(--color-muted)' }}>{p.redraw ? '✓' : '·'} Redraw</span>
                      {p.comparison_rate != null && <span>Comp. {Number(p.comparison_rate).toFixed(2)}%</span>}
                      {(p.overview_uri || p.application_uri) && (
                        <a
                          href={p.application_uri || p.overview_uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="transition-opacity duration-200 hover:opacity-70"
                          style={{ color: 'var(--color-primary)' }}
                        >
                          Product page →
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-left sm:text-right">
                    <p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{Number(p.rate).toFixed(2)}%</p>
                    {p.monthly_repayment != null && (
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        ~${Math.round(p.monthly_repayment).toLocaleString('en-AU')}/mo
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && !loadError && products.length === 0 && (
          <div className="px-4 py-4 text-sm" style={{ color: 'var(--color-muted)' }}>
            No matching live products returned. Try Full refinance compare.
          </div>
        )}

        {packMeta?.note && (
          <div className="px-4 py-2 border-t" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{packMeta.note}</p>
            {packMeta.coverage?.summary && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Coverage: {packMeta.coverage.summary}</p>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowProfiles((v) => !v)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-opacity duration-200 hover:opacity-70"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}
      >
        {getIcon('building', { size: 13 })}
        {showProfiles ? 'Hide lender feature guides' : 'Lender features & benefits →'}
      </button>

      {showProfiles && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Editorial summaries of the banks we track — features, fees, and who they suit. Rates above are live; these notes are not rate quotes.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {profiles.map((lender) => {
              const isHighlighted = [...guidanceLenderNames].some((n) => {
                const norm = String(n).toLowerCase();
                return (
                  norm.includes(lender.name.toLowerCase())
                  || norm.includes(lender.shortName.toLowerCase())
                  || lender.name.toLowerCase().includes(norm.replace(/\s*\(.*?\)\s*/g, '').trim())
                );
              });
              return (
                <div
                  key={lender.id}
                  className="rounded-xl border overflow-hidden flex flex-col"
                  style={{
                    borderColor: isHighlighted ? 'var(--color-primary)' : 'var(--color-border)',
                    background: 'var(--color-surface)',
                  }}
                >
                  <div className="px-4 py-3 border-b flex items-start justify-between gap-2" style={{ borderColor: 'var(--color-border)' }}>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{lender.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{lender.type}</p>
                    </div>
                    {isHighlighted && (
                      <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--color-primary)', color: '#fff' }}>
                        Highlighted for you
                      </span>
                    )}
                  </div>
                  <div className="px-4 py-3 space-y-2 flex-1">
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{lender.summary}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs pt-1">
                      <span style={{ color: lender.offsetAvailable ? '#16a34a' : '#b45309' }}>
                        {lender.offsetAvailable ? '✓' : '✗'} Offset account
                      </span>
                      <span style={{ color: '#16a34a' }}>✓ Redraw</span>
                      <span style={{ color: '#16a34a' }}>✓ Extra repayments</span>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      <span className="font-medium">Fee:</span> {lender.annualFee}
                    </p>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {lender.bestFor.map((tag) => (
                        <span
                          key={tag}
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="px-4 py-2 border-t" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                    <a
                      href={lender.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs transition-opacity duration-200 hover:opacity-70"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {lender.name} home loans →
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

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

      {/* First Home Owner Grant cross-reference */}
      {(() => {
        const state = calcResult.calculation?.event_results?.[0]?.inputs?.state;
        const isFhb = calcResult.calculation?.event_results?.[0]?.inputs?.is_first_home_buyer;
        if (!isFhb || !state) return null;
        const FHOG_NOTES = {
          QLD: { amount: 30000, cap: 750000, note: 'new homes only (not established), property value < $750,000, contract 20 Nov 2023–30 Jun 2026' },
          VIC: { amount: 10000, cap: 750000, note: 'new homes in regional VIC only; metro Melbourne grant ended' },
          SA:  { amount: 15000, cap: 650000, note: 'new homes, value ≤ $650,000' },
          WA:  { amount: 10000, cap: 750000, note: 'new homes, value ≤ $750,000' },
          TAS: { amount: 30000, cap: null,   note: 'new and established homes' },
          NT:  { amount: 10000, cap: null,   note: 'new and established homes' },
        };
        const fg = FHOG_NOTES[state];
        if (!fg) return null;
        const blocked = fg.cap && purchasePrice >= fg.cap;
        return (
          <div className="pt-2 border-t space-y-1" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-sm font-medium" style={{ color: blocked ? 'var(--color-muted)' : '#16a34a' }}>
              {state} First Home Owner Grant: {blocked ? `Not available — price above $${fg.cap.toLocaleString('en-AU')} cap` : `$${fg.amount.toLocaleString('en-AU')} may be available`}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{fg.note}. Apply through your participating lender. Verify eligibility at your state revenue office.</p>
          </div>
        );
      })()}

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

function BuyerQualifyForm({ getIcon, addToast, onSwitchToRefinance, onSwitchToProforma }) {
  const FIELD = {
    borderColor: 'var(--color-border)', background: 'var(--color-bg)',
    color: 'var(--color-text)', borderRadius: 8, border: '1px solid',
    padding: '8px 12px', fontSize: 14, width: '100%', outline: 'none',
  };

  // Property
  const [qPrice, setQPrice]     = useState('');
  const [qDeposit, setQDeposit] = useState('');
  const [qState, setQState]     = useState(DEFAULT_STATE);
  const [qFhb, setQFhb]         = useState('');
  const [qPpor, setQPpor]       = useState('ppor');
  // Income & household
  const [qIncome, setQIncome]     = useState('');
  const [qPartner, setQPartner]   = useState('');
  const [qHousehold, setQHousehold] = useState('single');
  const [qEmployment, setQEmployment] = useState('payg_fulltime');
  // Debts
  const [qHecs, setQHecs]       = useState('no');
  const [qNewBuild, setQNewBuild] = useState('no');
  const [qDebts, setQDebts]     = useState('');
  const [qExpenses, setQExpenses] = useState('');
  // Loan
  const [qTerm, setQTerm]       = useState('30');
  const [qRate, setQRate]       = useState(() => getInitialMarketRateInput());
  const { formatted: marketRateFormatted } = useMarketRateDefault(setQRate);
  // Extra checks
  const [qAge, setQAge]               = useState('');
  const [qPropTypeClass, setQPropTypeClass] = useState('house_town');
  const [qRentalIncome, setQRentalIncome]   = useState('');
  // Results
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [expanded, setExpanded] = useState({});
  const qualifyResultRef        = useRef(null);

  async function runQualify() {
    const price = parseFormattedNumber(qPrice);
    const deposit = parseFormattedNumber(qDeposit);
    const income = parseFormattedNumber(qIncome);
    const rate = parseFormattedNumber(qRate);
    if (!price || !deposit || !income || !rate || !qState) {
      setError('Property price, deposit, state, gross income, and interest rate are required.');
      return;
    }
    setError(null);
    setLoading(true);
    setEligibleLendersPack(null);
    try {
      const data = await runWithStepLog(
        useProcessingStore.getState(),
        'Running qualification check…',
        'Deterministic AU lending checks — please don’t navigate away.',
        [
          'Validating purchase, deposit, and income inputs',
          'Assessing employment and serviceability (APRA)',
          'Checking LVR, DTI, and genuine savings',
          'Estimating stamp duty, LMI, and settlement cash',
          'Building lender guidance',
        ],
        async () => {
          const res = await api.post('/api/property-scenario/calculators/buyer-qualify', {
            property_value:          price,
            deposit_amount:          deposit,
            state:                   qState,
            is_fhb:                  qFhb === 'yes',
            is_ppor:                 qPpor === 'ppor',
            gross_annual_income:     income,
            partner_gross_income:    qPartner ? parseFormattedNumber(qPartner) : 0,
            household_type:          qHousehold,
            employment_type:         qEmployment,
            has_hecs:                qHecs === 'yes',
            is_new_build:            qNewBuild === 'yes',
            monthly_debt_repayments: qDebts ? parseFormattedNumber(qDebts) : 0,
            monthly_expenses:        qExpenses ? parseFormattedNumber(qExpenses) : undefined,
            loan_term_years:         parseFormattedNumber(qTerm) || 30,
            target_rate_pct:         rate,
            applicant_age:           qAge ? parseFormattedNumber(qAge) : undefined,
            property_type_class:     qPropTypeClass || undefined,
            gross_rental_income:     qRentalIncome ? parseFormattedNumber(qRentalIncome) : undefined,
          });
          const payload = await res.json();
          if (!payload.ok) throw new Error(payload.errors?.[0] || 'Qualification check failed');
          return payload;
        },
      );
      setResult(data);
      saveFileProfileFromPayload({
        property_value: price,
        deposit_amount: deposit,
        state: qState,
        is_fhb: qFhb === 'yes',
        is_ppor: qPpor === 'ppor',
        gross_annual_income: income,
        partner_gross_income: qPartner ? parseFormattedNumber(qPartner) : 0,
        household_type: qHousehold,
        employment_type: qEmployment,
        has_hecs: qHecs === 'yes',
        is_new_build: qNewBuild === 'yes',
        monthly_debt_repayments: qDebts ? parseFormattedNumber(qDebts) : 0,
        monthly_expenses: qExpenses ? parseFormattedNumber(qExpenses) : undefined,
        loan_term_years: parseFormattedNumber(qTerm) || 30,
        target_rate_pct: rate,
        applicant_age: qAge ? parseFormattedNumber(qAge) : undefined,
        property_type_class: qPropTypeClass || undefined,
        gross_rental_income: qRentalIncome ? parseFormattedNumber(qRentalIncome) : undefined,
      });
      const init = {};
      (data.checks || []).forEach((c) => { if (c.status === 'fail') init[c.id] = true; });
      setExpanded(init);
      setTimeout(() => {
        qualifyResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    } catch (err) {
      setError(err.message || 'Request failed');
      addToast(err.message || 'Qualification check failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  const [pdfBusy, setPdfBusy] = useState(false);
  const [eligibleLendersPack, setEligibleLendersPack] = useState(null);

  async function handleQualifyPdf() {
    setPdfBusy(true);
    try {
      await downloadQualifyPdf(result, {
        property_value: parseFormattedNumber(qPrice),
        deposit_amount: parseFormattedNumber(qDeposit),
        state: qState,
        is_fhb: qFhb === 'yes',
        is_ppor: qPpor === 'ppor',
        gross_annual_income: parseFormattedNumber(qIncome),
        partner_gross_income: qPartner ? parseFormattedNumber(qPartner) : 0,
        household_type: qHousehold,
        employment_type: qEmployment,
        has_hecs: qHecs === 'yes',
        is_new_build: qNewBuild === 'yes',
        monthly_debt_repayments: qDebts ? parseFormattedNumber(qDebts) : 0,
        monthly_expenses: qExpenses ? parseFormattedNumber(qExpenses) : undefined,
        loan_term_years: parseFormattedNumber(qTerm) || 30,
        target_rate_pct: parseFormattedNumber(qRate),
        applicant_age: qAge ? parseFormattedNumber(qAge) : undefined,
        property_type_class: qPropTypeClass || undefined,
        gross_rental_income: qRentalIncome ? parseFormattedNumber(qRentalIncome) : undefined,
      }, eligibleLendersPack);
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
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Purchase price ($)<FieldTip text="The full property price you intend to pay — not including stamp duty or other costs." /></span>
              <FormattedNumberInput value={qPrice} onChange={setQPrice} placeholder="e.g. 850000" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Deposit ($)<FieldTip text="Your total available deposit — savings, equity from another property, and grants. Your LVR (loan-to-value ratio) is calculated directly from this figure." /></span>
              <FormattedNumberInput value={qDeposit} onChange={setQDeposit} placeholder="e.g. 170000" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>State<FieldTip text="Used to calculate stamp duty, First Home Buyer concessions, and FHOG eligibility. Rates and thresholds differ significantly between states." /></span>
              <select value={qState} onChange={(e) => setQState(e.target.value)} style={FIELD}>
                <option value="">Select…</option>
                {['NSW','VIC','QLD','SA','WA','TAS','ACT','NT'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>First home buyer?<FieldTip text="Affects eligibility for stamp duty concessions, the First Home Guarantee (5% deposit, no LMI), and state-based First Home Owner Grants (new builds only in most states)." /></span>
              <select value={qFhb} onChange={(e) => setQFhb(e.target.value)} style={FIELD}>
                <option value="">Select…</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Property purpose<FieldTip text="PPOR (primary place of residence) vs investment. Affects lender serviceability assessment, CGT treatment on future sale, and some lender-specific policies." /></span>
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
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Gross annual income ($)<FieldTip text="Your total gross income before tax — salary, wages, and salary packaging. Do not include rental income here; enter it in the optional rental income field below." /></span>
              <FormattedNumberInput value={qIncome} onChange={setQIncome} placeholder="e.g. 95000" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Partner income ($ — joint only)<FieldTip text="For joint applications, enter your partner's gross annual income before tax. Leave blank for a sole applicant." /></span>
              <FormattedNumberInput value={qPartner} onChange={setQPartner} placeholder="leave blank if solo" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Household type<FieldTip text="Used to select the correct HEM (Household Expenditure Measure) benchmark. Lenders use HEM as a minimum living expenses floor if your declared expenses are lower than the benchmark." /></span>
              <select value={qHousehold} onChange={(e) => setQHousehold(e.target.value)} style={FIELD}>
                <option value="single">Single (no dependants)</option>
                <option value="couple">Couple (no kids)</option>
                <option value="family">Family (with children)</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Employment type<FieldTip text="Self-employed and casual applicants typically need 2 years of tax returns. Contract income may be accepted if the field is consistent. PAYG full-time is the lowest-risk category." /></span>
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
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>HECS / HELP debt outstanding?<FieldTip text="HECS repayments reduce your borrowing capacity because lenders count the compulsory ATO repayment as a monthly expense. The 2025-26 marginal method is used here." /></span>
              <select value={qHecs} onChange={(e) => setQHecs(e.target.value)} style={FIELD}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>New build / off-the-plan?<FieldTip text="Some lender policies and state grants differ for new builds. The First Home Owner Grant is typically only available for new builds or substantially renovated properties." /></span>
              <select value={qNewBuild} onChange={(e) => setQNewBuild(e.target.value)} style={FIELD}>
                <option value="no">No — established home</option>
                <option value="yes">Yes — new build / off-the-plan</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Existing monthly debt repayments ($)<FieldTip text="Total minimum monthly payments on personal loans, car loans, and credit cards. For credit cards: lenders count 3.8% of your total limit as a monthly commitment — e.g. $10,000 limit = $380/mo, even if you pay it off in full each month." /></span>
              <FormattedNumberInput value={qDebts} onChange={setQDebts} placeholder="loans, credit cards (3.8%×limit)" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Monthly living expenses ($, optional)<FieldTip text="Your declared monthly living costs (groceries, utilities, transport, subscriptions). Leave blank and the HEM benchmark for your household type is used — lenders apply whichever is higher." /></span>
              <FormattedNumberInput value={qExpenses} onChange={setQExpenses} placeholder="leave blank to use HEM benchmark" style={FIELD} />
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
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Target interest rate (% p.a.)<FieldTip text="Defaults to the live average owner-occupier variable rate from CDR lender data. Override with the rate you expect to borrow at. Serviceability is tested at this rate plus 3% (APRA buffer)." /></span>
              <FormattedNumberInput value={qRate} onChange={setQRate} allowDecimals placeholder={marketRateFormatted || 'Loading market average…'} style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Loan term (years)<FieldTip text="Typically 30 years for maximum borrowing capacity. A shorter term raises the minimum repayment and lowers the amount a lender will approve." /></span>
              <select value={qTerm} onChange={(e) => setQTerm(e.target.value)} style={FIELD}>
                <option value="25">25 years</option>
                <option value="30">30 years</option>
              </select>
            </label>
          </div>
        </div>

        {/* Additional checks */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Additional checks (optional)</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Your age (years)<FieldTip text="Optional. Checks whether the loan would mature beyond age 70-75 — the typical ceiling most lenders apply without a documented retirement income plan." /></span>
              <FormattedNumberInput value={qAge} onChange={setQAge} placeholder="e.g. 42 — checks loan maturity age" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Property type<FieldTip text="Affects the maximum LVR some lenders will approve. High-rise, studios under 50m², and rural properties face tighter caps at major lenders — but this varies by postcode and is often broker-negotiable." /></span>
              <select value={qPropTypeClass} onChange={(e) => setQPropTypeClass(e.target.value)} style={FIELD}>
                <option value="house_town">House or townhouse</option>
                <option value="highrise">Apartment — high-rise (6+ floors)</option>
                <option value="studio_small">Studio / apartment under 50m²</option>
                <option value="rural_acreage">Rural, acreage or hobby farm</option>
                <option value="off_plan">Off-the-plan</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Expected gross rental income ($ p.a.)<FieldTip text="Investment purchases only. Lenders typically shade (discount) rental income to 75% before adding it to your serviceability calculation. Leave blank for a PPOR purchase." /></span>
              <FormattedNumberInput value={qRentalIncome} onChange={setQRentalIncome} placeholder="Investment only — leave blank for PPOR" style={FIELD} />
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
        <div ref={qualifyResultRef} className="space-y-4">
          {/* Overall verdict */}
          <div className="rounded-xl border p-4" style={{ borderColor: overallBord, background: overallBg }}>
            <p className="text-base font-semibold" style={{ color: overallColor }}>
              {s.overall_status === 'pass' && 'Looks broadly serviceable — no hard lending blocks found'}
              {s.overall_status === 'warn' && `${s.warn_count} area${s.warn_count !== 1 ? 's' : ''} to check — may face conditions or reduced choice`}
              {s.overall_status === 'fail' && `${s.fail_count} likely lending block${s.fail_count !== 1 ? 's' : ''} — most lenders would not proceed as-is`}
            </p>
            {s.status_note && (
              <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{s.status_note}</p>
            )}
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

          {/* Lender discovery CTA — shown on pass or warn */}
          {(s.overall_status === 'pass' || s.overall_status === 'warn') && (
            <LenderDiscoveryPanel
              loanAmount={s.loan_requested}
              targetRate={s.target_rate_pct}
              termMonths={Number(qTerm) * 12}
              state={qState}
              isPpor={qPpor === 'ppor'}
              overallStatus={s.overall_status}
              lenderGuidance={result.lender_guidance}
              getIcon={getIcon}
              onProductsLoaded={setEligibleLendersPack}
              onCompareRates={() => {
                if (onSwitchToRefinance) {
                  onSwitchToRefinance({
                    balance: s.loan_requested,
                    rate: s.target_rate_pct,
                    termMonths: Number(qTerm) * 12,
                    state: qState,
                  });
                }
              }}
            />
          )}

          {onSwitchToProforma && (
            <button
              type="button"
              onClick={() => onSwitchToProforma({
                property_value: qPrice,
                deposit_amount: qDeposit,
                state: qState,
                is_fhb: qFhb === 'yes' ? 'yes' : qFhb === 'no' ? 'no' : '',
                is_ppor: qPpor,
                gross_annual_income: qIncome,
                partner_gross_income: qPartner,
                household_type: qHousehold,
                employment_type: qEmployment,
                has_hecs: qHecs,
                is_new_build: qNewBuild,
                monthly_debt_repayments: qDebts,
                monthly_expenses: qExpenses,
                loan_term_years: qTerm,
                target_rate_pct: qRate,
                applicant_age: qAge,
                property_type_class: qPropTypeClass,
                gross_rental_income: qRentalIncome,
              })}
              className="inline-flex items-center gap-1.5 text-sm font-medium transition-opacity duration-200 hover:opacity-70"
              style={{ color: 'var(--color-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              Continue to qualification proforma (full broker file review) →
            </button>
          )}

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

          {/* Settlement cost summary */}
          {s.cash_to_settle != null && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
              <div className="px-4 py-3" style={{ background: 'var(--color-surface)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Total cash needed to settle</p>
                <p className="text-xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>
                  ${(s.fhog_offset > 0 ? s.net_cash_to_settle : s.cash_to_settle)?.toLocaleString('en-AU')}
                  {s.lmi_required && <span className="text-sm font-normal ml-2" style={{ color: '#b45309' }}>+ ~${s.lmi_estimate?.toLocaleString('en-AU')} LMI (if not capitalised)</span>}
                </p>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {[
                  { label: 'Deposit', value: s.deposit_amount, note: '' },
                  { label: 'Transfer duty (stamp duty)', value: s.stamp_duty_estimate, note: s.stamp_duty_estimate === 0 ? '← FHB exemption' : '' },
                  { label: 'Legal / conveyancing (estimate)', value: s.legal_estimate, note: 'mid-point; confirm with conveyancer' },
                  ...(s.lmi_required ? [{ label: 'LMI (if capitalised into loan)', value: s.lmi_estimate, note: 'typically added to loan, not paid in cash' }] : []),
                  ...(s.fhog_offset > 0 ? [{ label: `FHOG grant offset (${s.stamp_duty_estimate != null ? 'state grant' : 'estimate'})`, value: -s.fhog_offset, note: '← reduces cash needed' }] : []),
                ].map(({ label, value, note }) => value != null && (
                  <div key={label} className="px-4 py-2 flex items-center justify-between">
                    <div>
                      <p className="text-sm" style={{ color: 'var(--color-text)' }}>{label}</p>
                      {note && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{note}</p>}
                    </div>
                    <p className="text-sm font-semibold" style={{ color: value < 0 ? '#16a34a' : 'var(--color-text)' }}>
                      {value < 0 ? `−$${Math.abs(value).toLocaleString('en-AU')}` : `$${value.toLocaleString('en-AU')}`}
                    </p>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2" style={{ background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)' }}>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>LMI is often capitalised (added to your loan balance) rather than paid upfront. Does not include building inspection (~$500–$800), loan application fees, or council/water rate adjustments at settlement.</p>
              </div>
            </div>
          )}

          {/* Stress / sensitivity view */}
          {s.stress && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
              <div className="px-4 py-3" style={{ background: 'var(--color-surface)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Rate &amp; income stress — how much buffer do you have?</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Your assessment passed at {s.target_rate_pct}% product rate ({s.assessment_rate_pct}% APRA assessment). If rates rise or income is shaded:</p>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {[
                  {
                    label: `Rate +1% (product ${s.stress.rate_plus_1.rate_pct?.toFixed(2)}%, assessed at ${s.stress.rate_plus_1.assessment_rate_pct?.toFixed(2)}%)`,
                    max: s.stress.rate_plus_1.max_borrowing,
                    pass: s.stress.rate_plus_1.still_qualifies,
                    loanReq: s.loan_requested,
                  },
                  {
                    label: `Rate +2% (product ${s.stress.rate_plus_2.rate_pct?.toFixed(2)}%, assessed at ${s.stress.rate_plus_2.assessment_rate_pct?.toFixed(2)}%)`,
                    max: s.stress.rate_plus_2.max_borrowing,
                    pass: s.stress.rate_plus_2.still_qualifies,
                    loanReq: s.loan_requested,
                  },
                  {
                    label: `Income at ${100 - s.stress.income_haircut.haircut_pct}% of stated ($${s.stress.income_haircut.assessed_income?.toLocaleString('en-AU')} p.a.) — ${s.stress.income_haircut.note}`,
                    max: s.stress.income_haircut.max_borrowing,
                    pass: s.stress.income_haircut.still_qualifies,
                    loanReq: s.loan_requested,
                  },
                ].map(({ label, max, pass, loanReq }) => (
                  <div key={label} className="px-4 py-2 flex items-start justify-between gap-4">
                    <p className="text-xs leading-relaxed flex-1" style={{ color: 'var(--color-muted)' }}>{label}</p>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold" style={{ color: pass ? '#16a34a' : '#ef4444' }}>
                        {pass ? 'Still qualifies' : 'Falls short'}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        Max ~${max?.toLocaleString('en-AU', { maximumFractionDigits: 0 }) ?? '—'}
                        {!pass && loanReq && max != null && ` (short $${(loanReq - max).toLocaleString('en-AU', { maximumFractionDigits: 0 })})`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
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

const RISK_COLOR = { low: '#15803d', medium: '#92400e', high: '#b91c1c' };
const RISK_BG    = { low: '#f0fdf4', medium: '#fefce8', high: '#fef2f2' };
const RISK_BORDER = { low: '#86efac', medium: '#fde047', high: '#fca5a5' };
const RISK_LABEL  = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };

function LeverCard({ lever }) {
  const col = RISK_COLOR[lever.riskLevel] || RISK_COLOR.medium;
  const bg = RISK_BG[lever.riskLevel] || RISK_BG.medium;
  const bord = RISK_BORDER[lever.riskLevel] || RISK_BORDER.medium;
  return (
    <div className="rounded-lg border p-3 space-y-1.5" style={{ borderColor: bord, background: bg }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ color: col, background: 'rgba(255,255,255,0.6)' }}>
          {RISK_LABEL[lever.riskLevel] || 'Medium risk'}
        </span>
        <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{lever.category}</span>
      </div>
      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{lever.title}</p>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>{lever.whatItIs}</p>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}><span className="font-medium">Why it's allowed: </span>{lever.whyItsAllowed}</p>
      {lever.impact && <p className="text-xs font-semibold" style={{ color: col }}>{lever.impact}</p>}
      {lever.regulatoryNote && <p className="text-xs leading-relaxed" style={{ color: '#b91c1c' }}>⚠ {lever.regulatoryNote}</p>}
    </div>
  );
}

/**
 * Qualification Proforma — the broker-realistic layer on top of the plain
 * qualification check. Runs the same strict/deterministic engine unchanged,
 * then separately surfaces (a) legitimate presentation/structuring/timing
 * levers with risk ratings, (b) a static list of things deliberately NOT
 * modelled because they'd constitute lender misrepresentation, and (c) a
 * live CDR-sourced lender product fit table (no policy speculation).
 */
function QualificationProformaForm({ getIcon, addToast, onSwitchToBuy, initialInputs }) {
  const seeded = useMemo(() => mergeInitialWithProfile(initialInputs), [initialInputs]);
  // Property
  const [pPrice, setPPrice]     = useState(() => seeded?.property_value != null ? formatNumberForInput(seeded.property_value) : '');
  const [pDeposit, setPDeposit] = useState(() => seeded?.deposit_amount != null ? formatNumberForInput(seeded.deposit_amount) : '');
  const [pState, setPState]     = useState(() => seeded?.state || DEFAULT_STATE);
  const [pFhb, setPFhb]         = useState(() => {
    if (seeded?.is_fhb === true || seeded?.is_fhb === 'yes') return 'yes';
    if (seeded?.is_fhb === false || seeded?.is_fhb === 'no') return 'no';
    return '';
  });
  const [pPpor, setPPpor]       = useState(() => {
    if (seeded?.is_ppor === false || seeded?.is_ppor === 'investment') return 'investment';
    return 'ppor';
  });
  // Income & household
  const [pIncome, setPIncome]     = useState(() => seeded?.gross_annual_income != null ? formatNumberForInput(seeded.gross_annual_income) : '');
  const [pPartner, setPPartner]   = useState(() => seeded?.partner_gross_income ? formatNumberForInput(seeded.partner_gross_income) : '');
  const [pHousehold, setPHousehold] = useState(() => seeded?.household_type || 'single');
  const [pDependents, setPDependents] = useState(() => seeded?.dependents != null && seeded.dependents !== '' ? String(seeded.dependents) : '');
  const [pEmployment, setPEmployment] = useState(() => seeded?.employment_type || 'payg_fulltime');
  const [pMonthsInRole, setPMonthsInRole] = useState(() => seeded?.months_in_current_role != null ? String(seeded.months_in_current_role) : '');
  // Debts & expenses
  const [pHecs, setPHecs]       = useState(() => (seeded?.has_hecs === true || seeded?.has_hecs === 'yes') ? 'yes' : 'no');
  const [pNewBuild, setPNewBuild] = useState(() => (seeded?.is_new_build === true || seeded?.is_new_build === 'yes') ? 'yes' : 'no');
  const [pDebts, setPDebts]     = useState(() => seeded?.monthly_debt_repayments ? formatNumberForInput(seeded.monthly_debt_repayments) : '');
  const [pExpenses, setPExpenses] = useState(() => seeded?.monthly_expenses ? formatNumberForInput(seeded.monthly_expenses) : '');
  const [pCardLimits, setPCardLimits] = useState(() => seeded?.credit_card_limits_total ? formatNumberForInput(seeded.credit_card_limits_total) : '');
  const [pLiabilities, setPLiabilities] = useState(() => {
    if (Array.isArray(seeded?.liabilities) && seeded.liabilities.length) {
      return seeded.liabilities.map((row) => ({
        type: row.type || 'other',
        label: row.label || '',
        monthly: formatNumberForInput(row.monthly_repayment ?? row.monthlyRepayment ?? '') || '',
      }));
    }
    return [];
  });
  // Broker-realism inputs
  const [pOvertime, setPOvertime] = useState(() => seeded?.overtime_bonus_annual ? formatNumberForInput(seeded.overtime_bonus_annual) : '');
  const [pOvertimeRegularity, setPOvertimeRegularity] = useState(() => seeded?.overtime_bonus_regularity || 'irregular');
  const [pAddbacks, setPAddbacks] = useState(() => seeded?.self_employed_addbacks_annual ? formatNumberForInput(seeded.self_employed_addbacks_annual) : '');
  const [pAdverseCredit, setPAdverseCredit] = useState(() => (seeded?.has_adverse_credit === true || seeded?.has_adverse_credit === 'yes') ? 'yes' : 'no');
  const [pAdverseSeverity, setPAdverseSeverity] = useState(() => seeded?.adverse_credit_severity || 'default');
  const [pGenuineHeldMonths, setPGenuineHeldMonths] = useState(() => seeded?.genuine_savings_held_months != null ? String(seeded.genuine_savings_held_months) : '');
  const [pDepositGift, setPDepositGift] = useState(() => seeded?.deposit_gift_amount ? formatNumberForInput(seeded.deposit_gift_amount) : '');
  // Loan
  const [pTerm, setPTerm]       = useState(() => seeded?.loan_term_years ? String(seeded.loan_term_years) : '30');
  const [pRate, setPRate]       = useState(() => seeded?.target_rate_pct != null ? formatNumberForInput(seeded.target_rate_pct, { allowDecimals: true }) : getInitialMarketRateInput());
  const { formatted: marketRateFormatted } = useMarketRateDefault(setPRate, {
    skip: seeded?.target_rate_pct != null,
  });
  // Extra checks
  const [pAge, setPAge]               = useState(() => seeded?.applicant_age ? String(seeded.applicant_age) : '');
  const [pPropTypeClass, setPPropTypeClass] = useState(() => seeded?.property_type_class || 'house_town');
  const [pRentalIncome, setPRentalIncome]   = useState(() => seeded?.gross_rental_income ? formatNumberForInput(seeded.gross_rental_income) : '');
  // Results
  const [proforma, setProforma] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [expanded, setExpanded] = useState({});
  const [pdfBusy, setPdfBusy]   = useState(false);
  const [docsBankId, setDocsBankId] = useState(null);
  const proformaResultRef       = useRef(null);

  function buildInputPayload() {
    const liabilityRows = pLiabilities
      .map((row) => ({
        type: row.type || 'other',
        label: row.label || row.type || 'Liability',
        monthly_repayment: parseFormattedNumber(row.monthly) || 0,
      }))
      .filter((row) => row.monthly_repayment > 0);
    const itemisedDebtTotal = liabilityRows.reduce((sum, row) => sum + row.monthly_repayment, 0);
    return {
      property_value:          parseFormattedNumber(pPrice),
      deposit_amount:          parseFormattedNumber(pDeposit),
      state:                   pState,
      is_fhb:                  pFhb === 'yes',
      is_ppor:                 pPpor === 'ppor',
      gross_annual_income:     parseFormattedNumber(pIncome),
      partner_gross_income:    pPartner ? parseFormattedNumber(pPartner) : 0,
      household_type:          pHousehold,
      dependents:              pDependents ? Math.round(parseFormattedNumber(pDependents)) || 0 : 0,
      employment_type:         pEmployment,
      months_in_current_role:  pMonthsInRole !== '' ? parseFormattedNumber(pMonthsInRole) : undefined,
      has_hecs:                pHecs === 'yes',
      is_new_build:            pNewBuild === 'yes',
      monthly_debt_repayments: itemisedDebtTotal > 0 ? itemisedDebtTotal : (pDebts ? parseFormattedNumber(pDebts) : 0),
      liabilities:             liabilityRows.length ? liabilityRows : undefined,
      monthly_expenses:        pExpenses ? parseFormattedNumber(pExpenses) : undefined,
      credit_card_limits_total: pCardLimits ? parseFormattedNumber(pCardLimits) : 0,
      overtime_bonus_annual:   pOvertime ? parseFormattedNumber(pOvertime) : 0,
      overtime_bonus_regularity: pOvertimeRegularity,
      self_employed_addbacks_annual: pAddbacks ? parseFormattedNumber(pAddbacks) : 0,
      genuine_savings_held_months: pGenuineHeldMonths !== '' ? parseFormattedNumber(pGenuineHeldMonths) : undefined,
      deposit_gift_amount:     pDepositGift ? parseFormattedNumber(pDepositGift) : 0,
      has_adverse_credit:      pAdverseCredit === 'yes',
      adverse_credit_severity: pAdverseSeverity,
      loan_term_years:         parseFormattedNumber(pTerm) || 30,
      target_rate_pct:         parseFormattedNumber(pRate),
      applicant_age:           pAge ? parseFormattedNumber(pAge) : undefined,
      property_type_class:     pPropTypeClass || undefined,
      gross_rental_income:     pRentalIncome ? parseFormattedNumber(pRentalIncome) : undefined,
    };
  }

  async function runProforma() {
    const price = parseFormattedNumber(pPrice);
    const deposit = parseFormattedNumber(pDeposit);
    const income = parseFormattedNumber(pIncome);
    const rate = parseFormattedNumber(pRate);
    if (!price || !deposit || !income || !rate || !pState) {
      setError('Property price, deposit, state, gross income, and interest rate are required.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const data = await runWithStepLog(
        useProcessingStore.getState(),
        'Running qualification proforma…',
        'Full broker-style file review — please don’t navigate away.',
        [
          'Validating the file inputs',
          'Running strict AU lending checks',
          'Applying overtime / genuine-savings rules',
          'Scoring presentation levers',
          'Ranking curated bank posture',
          'Modelling per-bank indicative capacity',
          'Fetching live CDR lender rates',
          'Assembling the proforma report',
        ],
        async () => {
          const res = await api.post('/api/property-scenario/calculators/qualification-proforma', buildInputPayload());
          const payload = await res.json();
          if (!payload.ok) throw new Error(payload.errors?.[0] || 'Qualification proforma failed');
          return payload;
        },
      );
      setProforma(data);
      const payload = buildInputPayload();
      saveFileProfileFromPayload(payload);
      saveLastProformaSummary({
        overall_status: data.strict?.summary?.overall_status,
        loan_requested: data.strict?.summary?.loan_requested,
        max_borrowing_capacity: data.strict?.summary?.max_borrowing_capacity,
        top_bank: data.bankPanel?.banks?.[0]?.shortName || data.bankPosture?.banks?.[0]?.shortName,
        top_capacity: data.bankPanel?.banks?.[0]?.capacity?.indicative_capacity
          || data.bankPosture?.banks?.[0]?.capacity?.indicative_capacity,
      });
      const init = {};
      (data.strict?.checks || []).forEach((c) => { if (c.status === 'fail') init[c.id] = true; });
      setExpanded(init);
      setTimeout(() => {
        proformaResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    } catch (err) {
      setError(err.message || 'Request failed');
      addToast(err.message || 'Qualification proforma failed', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleProformaPdf() {
    setPdfBusy(true);
    try {
      await downloadProformaPdf(proforma, buildInputPayload());
    } catch (err) {
      console.error('[PDF] proforma failed:', err);
      addToast('PDF generation failed — ' + (err?.message || 'unknown error'), 'error');
    } finally {
      setPdfBusy(false);
    }
  }

  const strict = proforma?.strict;
  const s = strict?.summary;
  const overallColor = s ? STATUS_COLOR[s.overall_status] : null;
  const overallBg    = s ? STATUS_BG[s.overall_status] : null;
  const overallBord  = s ? STATUS_BORDER[s.overall_status] : null;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border p-4 sm:p-5 space-y-5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Qualification proforma — the broker-realistic file review</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Strict AU checks (with overtime/bonus shaded into serviceability where evidenced), risk-rated presentation levers, a curated bank-by-bank posture matrix, and live CDR product fit. Strict numbers never invent income or hide debts — they take what you declared at face value, with conservative shading.
          </p>
          {initialInputs && (
            <p className="text-xs mt-2 px-2.5 py-1.5 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-primary) 10%, var(--color-bg))', color: 'var(--color-text)' }}>
              Prefill applied from your previous step — review and complete any missing broker-file fields before running.
            </p>
          )}
        </div>

        {/* Property */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Property</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Purchase price ($)<FieldTip text="The full property price you intend to pay." /></span>
              <FormattedNumberInput value={pPrice} onChange={setPPrice} placeholder="e.g. 850000" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Deposit ($)<FieldTip text="Your total available deposit. Your LVR is calculated from this." /></span>
              <FormattedNumberInput value={pDeposit} onChange={setPDeposit} placeholder="e.g. 170000" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>State<FieldTip text="Used for stamp duty, FHB concessions, and FHOG eligibility." /></span>
              <select value={pState} onChange={(e) => setPState(e.target.value)} style={FIELD}>
                <option value="">Select…</option>
                {['NSW','VIC','QLD','SA','WA','TAS','ACT','NT'].map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>First home buyer?<FieldTip text="Affects stamp duty concessions, FHBG, and FHOG." /></span>
              <select value={pFhb} onChange={(e) => setPFhb(e.target.value)} style={FIELD}>
                <option value="">Select…</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Property purpose<FieldTip text="PPOR vs investment — affects serviceability and rental income treatment." /></span>
              <select value={pPpor} onChange={(e) => setPPpor(e.target.value)} style={FIELD}>
                <option value="ppor">Primary residence (PPOR)</option>
                <option value="investment">Investment</option>
              </select>
            </label>
          </div>
        </div>

        {/* Income & household */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Income &amp; household</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Gross annual income ($)<FieldTip text="Total gross income before tax — salary and wages." /></span>
              <FormattedNumberInput value={pIncome} onChange={setPIncome} placeholder="e.g. 95000" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Partner income ($ — joint only)<FieldTip text="Leave blank for a sole applicant." /></span>
              <FormattedNumberInput value={pPartner} onChange={setPPartner} placeholder="leave blank if solo" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Household type<FieldTip text="Sets the HEM living-expense benchmark." /></span>
              <select value={pHousehold} onChange={(e) => setPHousehold(e.target.value)} style={FIELD}>
                <option value="single">Single (no dependants)</option>
                <option value="couple">Couple (no kids)</option>
                <option value="family">Family (with children)</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Number of dependents<FieldTip text="Refines the HEM benchmark beyond the household-type default — more dependents raises the assumed living-expense floor." /></span>
              <FormattedNumberInput value={pDependents} onChange={setPDependents} placeholder="e.g. 2" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Employment type<FieldTip text="Self-employed and casual need longer verified history. This drives the timing lever below." /></span>
              <select value={pEmployment} onChange={(e) => setPEmployment(e.target.value)} style={FIELD}>
                <option value="payg_fulltime">PAYG full-time</option>
                <option value="payg_parttime">PAYG part-time</option>
                <option value="casual">Casual</option>
                <option value="contract">Contract</option>
                <option value="self_employed">Self-employed</option>
              </select>
            </label>
            {['casual', 'contract', 'payg_parttime'].includes(pEmployment) && (
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Months with current employer<FieldTip text="Real broker lever: many mainstream lenders open up at 12 months; a few accept 6+ months with an employer letter." /></span>
                <FormattedNumberInput value={pMonthsInRole} onChange={setPMonthsInRole} placeholder="e.g. 8" style={FIELD} />
              </label>
            )}
            {pEmployment === 'self_employed' && (
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Annual add-backs ($, optional)<FieldTip text="Non-cash / one-off expenses your accountant would add back to net profit — e.g. depreciation, one-off costs. Requires an accountant letter." /></span>
                <FormattedNumberInput value={pAddbacks} onChange={setPAddbacks} placeholder="e.g. 12000" style={FIELD} />
              </label>
            )}
          </div>
        </div>

        {/* Debts & expenses */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Debts &amp; expenses</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>HECS / HELP debt outstanding?<FieldTip text="Reduces borrowing capacity via the compulsory ATO repayment." /></span>
              <select value={pHecs} onChange={(e) => setPHecs(e.target.value)} style={FIELD}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>New build / off-the-plan?<FieldTip text="Affects FHOG and some state duty rules." /></span>
              <select value={pNewBuild} onChange={(e) => setPNewBuild(e.target.value)} style={FIELD}>
                <option value="no">No — established home</option>
                <option value="yes">Yes — new build / off-the-plan</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Existing monthly debt repayments ($)<FieldTip text="Total of non-card loans if you prefer a single figure. Or itemise below — itemised rows override this total." /></span>
              <FormattedNumberInput value={pDebts} onChange={setPDebts} placeholder="loans, other repayments" style={FIELD} disabled={pLiabilities.some((r) => parseFormattedNumber(r.monthly) > 0)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Total credit card / BNPL limits ($)<FieldTip text="Lenders assess 3.8%/month of your total limit as a commitment, regardless of balance. This is what the 'close cards before applying' lever acts on." /></span>
              <FormattedNumberInput value={pCardLimits} onChange={setPCardLimits} placeholder="e.g. 15000" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Monthly living expenses ($, optional)<FieldTip text="Leave blank to use the HEM benchmark. If your real spending is higher than HEM, declaring it truthfully — and understanding the risk of not doing so — is covered in the levers below." /></span>
              <FormattedNumberInput value={pExpenses} onChange={setPExpenses} placeholder="leave blank to use HEM benchmark" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Genuine savings held (months)<FieldTip text="Most lenders want at least 3 months of bank statements showing the deposit funds in your name. Leave blank if unsure — the check will flag that you still need to confirm." /></span>
              <FormattedNumberInput value={pGenuineHeldMonths} onChange={setPGenuineHeldMonths} placeholder="e.g. 4" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Gift portion of deposit ($)<FieldTip text="Gifted funds usually do not count as genuine savings. Enter the gift amount so the check uses only the remainder." /></span>
              <FormattedNumberInput value={pDepositGift} onChange={setPDepositGift} placeholder="0 if none" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Overtime / bonus / commission ($/yr, optional)<FieldTip text="Shaded into the strict serviceability figure when you have 1–2 years of history (50%/80%). Irregular income is excluded from strict and left for lender shopping in the levers." /></span>
              <FormattedNumberInput value={pOvertime} onChange={setPOvertime} placeholder="e.g. 8000" style={FIELD} />
            </label>
            {parseFormattedNumber(pOvertime) > 0 && (
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>History with that income<FieldTip text="How long you've actually received this — determines how much a lender will realistically credit." /></span>
                <select value={pOvertimeRegularity} onChange={(e) => setPOvertimeRegularity(e.target.value)} style={FIELD}>
                  <option value="irregular">Irregular / less than 1 year</option>
                  <option value="one_year_history">Consistent for 1 year</option>
                  <option value="two_year_history">Consistent for 2+ years</option>
                </select>
              </label>
            )}
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Any defaults, judgments, or bankruptcy?<FieldTip text="Self-declared only — get your actual credit file before applying anywhere." /></span>
              <select value={pAdverseCredit} onChange={(e) => setPAdverseCredit(e.target.value)} style={FIELD}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
            {pAdverseCredit === 'yes' && (
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Severity<FieldTip text="Roughly how serious — this changes which lender tier is realistically available." /></span>
                <select value={pAdverseSeverity} onChange={(e) => setPAdverseSeverity(e.target.value)} style={FIELD}>
                  <option value="minor">Minor (small, paid)</option>
                  <option value="default">Default(s) — paid or unpaid</option>
                  <option value="judgment_or_bankruptcy">Court judgment or bankruptcy</option>
                </select>
              </label>
            )}
          </div>

          {/* Itemised liabilities */}
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                Itemised debts (optional)
                <FieldTip text="Car loan, personal loan, HECS repayment schedule (if not using the HECS toggle), store card, etc. Sum overrides the single monthly-debt field above." />
              </p>
              <button
                type="button"
                onClick={() => setPLiabilities((prev) => [...prev, { type: 'personal_loan', label: '', monthly: '' }])}
                className="text-xs font-medium transition-opacity duration-200 hover:opacity-70"
                style={{ color: 'var(--color-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                + Add liability
              </button>
            </div>
            {pLiabilities.map((row, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <select
                  value={row.type}
                  onChange={(e) => setPLiabilities((prev) => prev.map((r, i) => (i === idx ? { ...r, type: e.target.value } : r)))}
                  style={FIELD}
                >
                  <option value="car_loan">Car loan</option>
                  <option value="personal_loan">Personal loan</option>
                  <option value="hecs_repayment">HECS / HELP (extra)</option>
                  <option value="store_card">Store card / Afterpay</option>
                  <option value="other">Other</option>
                </select>
                <input
                  type="text"
                  value={row.label}
                  onChange={(e) => setPLiabilities((prev) => prev.map((r, i) => (i === idx ? { ...r, label: e.target.value } : r)))}
                  placeholder="Label (optional)"
                  style={FIELD}
                />
                <FormattedNumberInput
                  value={row.monthly}
                  onChange={(v) => setPLiabilities((prev) => prev.map((r, i) => (i === idx ? { ...r, monthly: v } : r)))}
                  placeholder="$/mo"
                  style={FIELD}
                />
                <button
                  type="button"
                  onClick={() => setPLiabilities((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-xs transition-opacity duration-200 hover:opacity-70"
                  style={{ color: '#ef4444', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Loan */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Loan</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Target interest rate (% p.a.)<FieldTip text="Defaults to the live average owner-occupier variable rate from CDR. Override with your expected rate. Serviceability is tested at this rate plus 3% (APRA buffer)." /></span>
              <FormattedNumberInput value={pRate} onChange={setPRate} allowDecimals placeholder={marketRateFormatted || 'Loading market average…'} style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Loan term (years)<FieldTip text="30 years maximises borrowing capacity." /></span>
              <select value={pTerm} onChange={(e) => setPTerm(e.target.value)} style={FIELD}>
                <option value="25">25 years</option>
                <option value="30">30 years</option>
              </select>
            </label>
          </div>
        </div>

        {/* Additional checks */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>Additional checks (optional)</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Your age (years)<FieldTip text="Checks loan maturity against typical lender age caps." /></span>
              <FormattedNumberInput value={pAge} onChange={setPAge} placeholder="e.g. 42" style={FIELD} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Property type<FieldTip text="Some property types face tighter LVR caps — often broker-negotiable by postcode." /></span>
              <select value={pPropTypeClass} onChange={(e) => setPPropTypeClass(e.target.value)} style={FIELD}>
                <option value="house_town">House or townhouse</option>
                <option value="highrise">Apartment — high-rise (6+ floors)</option>
                <option value="studio_small">Studio / apartment under 50m²</option>
                <option value="rural_acreage">Rural, acreage or hobby farm</option>
                <option value="off_plan">Off-the-plan</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Expected gross rental income ($ p.a.)<FieldTip text="Investment purchases only. Drives the rental-appraisal-shading lever below." /></span>
              <FormattedNumberInput value={pRentalIncome} onChange={setPRentalIncome} placeholder="Investment only" style={FIELD} />
            </label>
          </div>
        </div>

        {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}

        <button
          type="button"
          disabled={loading}
          onClick={runProforma}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          {getIcon('shield-check', { size: 14 })}
          {loading ? 'Running the full review…' : 'Run the qualification proforma'}
        </button>
      </div>

      {proforma && strict?.ok && (
        <div ref={proformaResultRef} className="space-y-5">
          {/* Strict verdict */}
          <div className="rounded-xl border p-4" style={{ borderColor: overallBord, background: overallBg }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: overallColor }}>Lending checks — strict result</p>
            <p className="text-base font-semibold" style={{ color: overallColor }}>
              {s.overall_status === 'pass' && 'Looks broadly serviceable — no hard lending blocks found'}
              {s.overall_status === 'warn' && `${s.warn_count} area${s.warn_count !== 1 ? 's' : ''} to check — may face conditions or reduced choice`}
              {s.overall_status === 'fail' && `${s.fail_count} likely lending block${s.fail_count !== 1 ? 's' : ''} — most lenders would not proceed as-is`}
            </p>
            {s.status_note && (
              <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{s.status_note}</p>
            )}
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
            {onSwitchToBuy && (s.overall_status === 'pass' || s.overall_status === 'warn') && (
              <button
                type="button"
                onClick={() => onSwitchToBuy({ price: pPrice, deposit: pDeposit, state: pState, fhb: pFhb, ppor: pPpor })}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium transition-opacity duration-200 hover:opacity-70"
                style={{ color: overallColor, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                Continue to the buy calculator with these figures →
              </button>
            )}
          </div>

          {/* Individual checks */}
          <div className="space-y-2">
            {(strict.checks || []).map((check) => (
              <QualifyCheck
                key={check.id}
                check={check}
                expanded={!!expanded[check.id]}
                onToggle={() => setExpanded((prev) => ({ ...prev, [check.id]: !prev[check.id] }))}
              />
            ))}
          </div>

          {/* Levers */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Presentation, structuring &amp; timing levers</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                Legitimate choices about how, when, and to whom this file is presented — none of them change a true fact about your income, debts, or employment. Risk rating reflects scrutiny/documentation burden and consequence if it goes wrong, not legality.
              </p>
            </div>
            {(proforma.levers || []).length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {proforma.levers.map((lv) => <LeverCard key={lv.id} lever={lv} />)}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No specific levers identified from the inputs provided — the strict checks above already reflect the full picture.</p>
            )}
          </div>

          {/* Where the line sits */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Where the line sits — not modelled, and why</h3>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Deliberately excluded because they'd constitute misrepresentation to a lender — potentially loan fraud under the NCCP Act — not because they're merely aggressive.
            </p>
            <div className="space-y-2">
              {(proforma.excluded || []).map((e) => (
                <div key={e.id} className="rounded-lg border-l-3 pl-3 py-1" style={{ borderLeftWidth: 3, borderLeftColor: '#fca5a5', borderLeftStyle: 'solid' }}>
                  <p className="text-xs font-semibold" style={{ color: '#b91c1c' }}>{e.title}</p>
                  <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{e.why}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Levers delta */}
          {proforma.leversDelta && (
            <div className="rounded-xl border px-4 py-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Capacity if you structure the file</h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{proforma.leversDelta.note}</p>
              <div className="flex flex-wrap gap-4 text-xs">
                <span style={{ color: 'var(--color-text)' }}>
                  Strict: <strong>${Number(proforma.leversDelta.base_capacity || 0).toLocaleString('en-AU')}</strong>
                </span>
                {proforma.leversDelta.stacked_uplift > 0 && (
                  <span style={{ color: '#15803d' }}>
                    With levers (indicative): <strong>${Number(proforma.leversDelta.optimistic_capacity || 0).toLocaleString('en-AU')}</strong>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Merged bank panel — posture + capacity + live rate */}
          {(proforma.bankPanel?.banks || proforma.bankPosture?.banks)?.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>How each bank may see this file</h3>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {proforma.bankPanel?.capacity_note || proforma.bankPosture?.capacity_note}
              </p>
              <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                {proforma.bankPanel?.note || proforma.bankPosture?.note}
              </p>
              <div className="rounded-xl border divide-y overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                {(proforma.bankPanel?.banks || proforma.bankPosture.banks).map((b) => {
                  const fitColor = b.fit === 'strong' ? '#15803d' : b.fit === 'fair' ? '#92400e' : b.fit === 'weak' ? '#c2410c' : '#b91c1c';
                  const cap = b.capacity?.indicative_capacity;
                  return (
                    <div key={b.id} className="px-4 py-3 space-y-1.5" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{b.name}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{b.postureSummary}</p>
                        </div>
                        <div className="shrink-0 text-right space-y-0.5">
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: fitColor }}>{b.fit}</p>
                          {cap != null && (
                            <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                              ~${Number(cap).toLocaleString('en-AU')}
                            </p>
                          )}
                          {b.live_rate != null && (
                            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                              Live {Number(b.live_rate).toFixed(2)}%{b.live_product ? ` · ${b.live_product}` : ''}
                            </p>
                          )}
                        </div>
                      </div>
                      {b.capacity?.narrative && (
                        <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--color-primary)' }}>{b.capacity.narrative}</p>
                      )}
                      {(b.reasons || []).filter((r) => r !== b.capacity?.narrative).slice(0, 2).map((reason, ri) => (
                        <p key={ri} className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>· {reason}</p>
                      ))}
                      <div className="flex flex-wrap gap-3 pt-0.5">
                        {b.fhbgParticipant && <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>FHBG</span>}
                        {b.offsetOnFixed && <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>Offset on fixed</span>}
                        {b.typicalTurnaroundDays != null && (
                          <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>~{b.typicalTurnaroundDays}d turnaround</span>
                        )}
                        {(b.documents || []).length > 0 && (
                          <button
                            type="button"
                            onClick={() => setDocsBankId((prev) => (prev === b.id ? null : b.id))}
                            className="text-[10px] font-medium transition-opacity duration-200 hover:opacity-70"
                            style={{ color: 'var(--color-primary)' }}
                          >
                            {docsBankId === b.id ? 'Hide documents' : 'Documents they\'d typically ask for'}
                          </button>
                        )}
                      </div>
                      {docsBankId === b.id && (
                        <ul className="text-xs space-y-0.5 pl-3 list-disc" style={{ color: 'var(--color-muted)' }}>
                          {(b.documents || []).map((d, i) => <li key={i}>{d}</li>)}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {proforma.live_lender_error && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Live rates unavailable right now: {proforma.live_lender_error}</p>
          )}

          {/* Supplementary analysis (rate stress, product fit, post-settlement) */}
          {proforma.supplement && (
            <div className="space-y-5 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Additional analysis</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  Extends the strict file review with rate stress, lender/product fit, and post-settlement cashflow. Indicative only — not a credit decision.
                </p>
              </div>

              {proforma.supplement.productFit && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                    {proforma.supplement.productFit.title}
                  </h4>
                  <p className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>{proforma.supplement.productFit.intro}</p>
                  <div className="space-y-3">
                    {(proforma.supplement.productFit.bullets || []).map((b, i) => (
                      <div key={i}>
                        <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{i + 1}. {b.title}</p>
                        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{b.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {proforma.supplement.rateStress?.rows?.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                    {proforma.supplement.rateStress.title}
                  </h4>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{proforma.supplement.rateStress.intro}</p>
                  <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="grid grid-cols-3 gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide" style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
                      <span>Rate</span>
                      <span>Monthly repayment</span>
                      <span>Buffer vs ${Number(proforma.supplement.rateStress.surplus_monthly || 0).toLocaleString('en-AU')} surplus</span>
                    </div>
                    {proforma.supplement.rateStress.rows.map((row, i) => (
                      <div key={i} className="grid grid-cols-3 gap-2 px-3 py-2 text-xs border-t" style={{ borderColor: 'var(--color-border)' }}>
                        <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                          {Number(row.rate_pct).toFixed(1)}%{row.label ? ` (${row.label})` : ''}
                        </span>
                        <span style={{ color: 'var(--color-text)' }}>
                          ${Number(row.monthly_repayment || 0).toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                        </span>
                        <span className="font-semibold" style={{ color: row.still_buffered ? '#15803d' : '#b91c1c' }}>
                          ${Number(row.buffer_vs_surplus || 0).toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    ))}
                  </div>
                  {proforma.supplement.rateStress.narrative && (
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{proforma.supplement.rateStress.narrative}</p>
                  )}
                </div>
              )}

              {proforma.supplement.incomeStress && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                    {proforma.supplement.incomeStress.title}
                  </h4>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{proforma.supplement.incomeStress.note}</p>
                  {proforma.supplement.incomeStress.example && (
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>{proforma.supplement.incomeStress.example}</p>
                  )}
                  <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--color-text)' }}>{proforma.supplement.incomeStress.brokerAsk}</p>
                </div>
              )}

              {proforma.supplement.postSettlement && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
                    {proforma.supplement.postSettlement.title}
                  </h4>
                  <p className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>{proforma.supplement.postSettlement.intro}</p>
                  {proforma.supplement.postSettlement.headroom_note && (
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>{proforma.supplement.postSettlement.headroom_note}</p>
                  )}
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Offset vs redraw</p>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{proforma.supplement.postSettlement.offset_vs_redraw}</p>
                  <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--color-text)' }}>{proforma.supplement.postSettlement.ask_lenders}</p>
                  {proforma.supplement.postSettlement.employment_note && (
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{proforma.supplement.postSettlement.employment_note}</p>
                  )}
                </div>
              )}

              {proforma.supplement.caveat && (
                <p className="text-[10px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>{proforma.supplement.caveat}</p>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={pdfBusy}
            onClick={handleProformaPdf}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}
          >
            {getIcon('download', { size: 13 })}
            {pdfBusy ? 'Generating…' : 'Download qualification proforma (PDF)'}
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
  const [rate, setRate] = useState(() => getInitialMarketRateInput());
  const [termYears, setTermYears] = useState('');
  const [extra, setExtra] = useState('200');
  const [offsetBalance, setOffsetBalance] = useState('50000');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [monthlyExpenses, setMonthlyExpenses] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const { formatted: marketRateFormatted } = useMarketRateDefault(setRate);

  async function runCalcs() {
    const amount = parseFormattedNumber(loanAmount);
    const r = parseFormattedNumber(rate);
    const months = Math.round(parseFormattedNumber(termYears) * 12);
    if (!amount || !r || !months) {
      setError('Loan amount, interest rate, and term are required.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const results = await runWithStepLog(
        useProcessingStore.getState(),
        'Running calculators…',
        'Standalone P&I estimates — please don’t navigate away.',
        [
          'Calculating monthly repayment',
          'Modelling extra repayments',
          'Estimating offset benefit',
          ...(monthlyIncome ? ['Estimating borrowing power'] : []),
        ],
        async () => {
          async function callCalc(path, body) {
            const res = await api.post(path, body);
            return res.json();
          }
          const [rep, xRep, off, bp] = await Promise.all([
            callCalc('/api/property-scenario/calculators/repayment', { loan_amount: amount, annual_rate_pct: r, term_months: months }),
            callCalc('/api/property-scenario/calculators/extra-repayments', { loan_amount: amount, annual_rate_pct: r, term_months: months, extra_monthly: parseFormattedNumber(extra) || 200 }),
            callCalc('/api/property-scenario/calculators/offset', { loan_amount: amount, annual_rate_pct: r, term_months: months, offset_balance: parseFormattedNumber(offsetBalance) || 50000 }),
            monthlyIncome
              ? callCalc('/api/property-scenario/calculators/borrowing-power', { monthly_income: parseFormattedNumber(monthlyIncome), monthly_expenses: parseFormattedNumber(monthlyExpenses) || 0, term_months: months, annual_rate_pct: r })
              : Promise.resolve(null),
          ]);
          return { repayment: rep, extra_repayments: xRep, offset: off, borrowing_power: bp };
        },
      );
      setResults(results);
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
            <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Loan amount ($)<FieldTip text="The amount you're borrowing — purchase price minus your deposit. Not the property value." /></span>
            <FormattedNumberInput value={loanAmount} onChange={setLoanAmount} placeholder="e.g. 500000" style={FIELD} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Interest rate (% p.a.)<FieldTip text="Defaults to the live average Australian owner-occupier variable rate from CDR lender data. Replace with your own rate when you know it." /></span>
            <FormattedNumberInput value={rate} onChange={setRate} allowDecimals placeholder={marketRateFormatted || 'Loading market average…'} style={FIELD} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Loan term (years)<FieldTip text="The full repayment period. Typically 25 or 30 years. Shorter terms mean higher repayments but significantly less total interest paid." /></span>
            <FormattedNumberInput value={termYears} onChange={setTermYears} placeholder="e.g. 25" style={FIELD} />
          </label>
        </div>

        <div className="pt-2 border-t space-y-1" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Optional — used for specific calculators</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs" style={{ color: 'var(--color-text)' }}>Extra monthly repayment ($)<FieldTip text="How much extra you'd pay above the minimum each month. Even a small extra payment can cut years off your loan and save a substantial amount in interest." /></span>
              <FormattedNumberInput value={extra} onChange={setExtra} placeholder="e.g. 200" style={FIELD} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs" style={{ color: 'var(--color-text)' }}>Offset account balance ($)<FieldTip text="An offset account reduces the interest charged daily. A $50,000 offset on a $500,000 loan means you only pay interest on $450,000 — every day the balance sits there." /></span>
              <FormattedNumberInput value={offsetBalance} onChange={setOffsetBalance} placeholder="e.g. 50000" style={FIELD} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs" style={{ color: 'var(--color-text)' }}>Monthly income ($) — for borrowing power<FieldTip text="Your gross monthly income (before tax). Used only to estimate indicative borrowing power. Leave blank to skip that calculator. This is not a lender pre-approval." /></span>
              <FormattedNumberInput value={monthlyIncome} onChange={setMonthlyIncome} placeholder="e.g. 8000 (leave blank to skip)" style={FIELD} />
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
                  { loanAmount: parseFormattedNumber(loanAmount), rate: parseFormattedNumber(rate), termYears: parseFormattedNumber(termYears), extra: parseFormattedNumber(extra) || 200, offsetBalance: parseFormattedNumber(offsetBalance) || 50000 },
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
  const [preState, setPreState] = useState(DEFAULT_STATE);
  const [prePpor, setPrePpor] = useState('');
  const [pipeline, setPipeline] = useState(null);
  const [pipelineError, setPipelineError] = useState(null);
  const [answers, setAnswers] = useState({});
  const [assumeSellingCosts, setAssumeSellingCosts] = useState(true);

  // ── Scenario type routing ──────────────────────────────────────────────────
  // null = type picker · 'refinance' | 'sell' | 'buy' | 'compound' | 'calculators'
  const [scenarioType, setScenarioType] = useState(null);

  // Refinance form fields
  const [rfState, setRfState] = useState(DEFAULT_STATE);
  const [rfBalance, setRfBalance] = useState('');
  const [rfRate, setRfRate] = useState(() => getInitialMarketRateInput());
  const [rfRateType, setRfRateType] = useState('variable');
  const [rfTermMonths, setRfTermMonths] = useState('');
  const [rfFixedPeriod, setRfFixedPeriod] = useState('');
  const [rfTargetMode, setRfTargetMode] = useState('cdr');
  const [rfTargetRate, setRfTargetRate] = useState(() => getInitialMarketRateInput());
  const { rate: marketRate, formatted: marketRateFormatted } = useMarketRateDefault(setRfRate);
  useMarketRateDefault(setRfTargetRate);

  // Sell form fields
  const [sellState, setSellState] = useState(DEFAULT_STATE);
  const [sellPrice, setSellPrice] = useState('');
  const [sellPurchasePrice, setSellPurchasePrice] = useState('');
  const [sellPurchaseYear, setSellPurchaseYear] = useState('');
  const [sellPpor, setSellPpor] = useState('ppor');

  // Buy form fields
  const [buyState, setBuyState] = useState(DEFAULT_STATE);
  const [buyPrice, setBuyPrice] = useState('');
  const [buyDeposit, setBuyDeposit] = useState('');
  const [buyFhb, setBuyFhb] = useState('no');
  const [buyPpor, setBuyPpor] = useState('ppor');

  // Prefill when continuing into the qualification proforma from buy / qualify / refinance
  const [proformaPrefill, setProformaPrefill] = useState(null);

  // Direct calculation result (structured forms — no LLM)
  const [calcResult, setCalcResult] = useState(null);
  const [calcError, setCalcError] = useState(null);
  const calcResultRef = useRef(null);

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

  // Prefill any clarify-form interest/comparison rate fields with the market average.
  useEffect(() => {
    if (marketRate == null || !formRows.length) return;
    setAnswers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const row of formRows) {
        if (!isInterestRateClarifyField(row)) continue;
        if (next[row.id] != null && String(next[row.id]).trim() !== '') continue;
        next[row.id] = formatMarketRateInput(marketRate);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [formRows, marketRate]);

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

    startProcessing('Parsing your scenario…', 'AI is assigning numbers from your text. Please don’t navigate away.', {
      steps: [
        'Reading your description',
        'Extracting amounts, rates, and dates',
        'Assigning values to scenario fields',
        'Checking for clarifying questions',
      ],
    });
    const advance = setInterval(() => useProcessingStore.getState().advanceProcessingStep(), 700);
    try {
      const res = await api.post('/api/property-scenario/parse', { text: fullText });
      const data = await res.json();
      clearInterval(advance);
      useProcessingStore.getState().completeAllProcessingSteps();
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
      clearInterval(advance);
      setPipeline(null);
      setPipelineError(err.message || 'Parse failed');
      addToast(err.message || 'Parse failed', 'error');
    } finally {
      clearInterval(advance);
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

    startProcessing('Updating scenario…', 'Applying your answers and recalculating when ready.', {
      steps: [
        'Applying your clarifying answers',
        'Re-validating the scenario',
        'Running deterministic calculations',
        'Building results presentation',
      ],
    });
    const advance = setInterval(() => useProcessingStore.getState().advanceProcessingStep(), 700);
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
      clearInterval(advance);
      useProcessingStore.getState().completeAllProcessingSteps();
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
      clearInterval(advance);
      setPipelineError(err.message || 'Clarify failed');
      addToast(err.message || 'Clarify failed', 'error');
    } finally {
      clearInterval(advance);
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
    setProformaPrefill(null);
  };

  const goBack = () => {
    setScenarioType(null);
    setCalcResult(null);
    setCalcError(null);
    setFollowUpAnswers({});
    setProformaPrefill(null);
  };

  const handleTypePick = useCallback((type) => {
    if (type === 'calculators') {
      setScenarioType('calculators');
      return;
    }
    if (type !== 'proforma') setProformaPrefill(null);
    setScenarioType(type);
    setCalcError(null);
  }, []);

  // Called when qualification result CTA "Compare live CDR rates" is clicked.
  // Pre-fills the refinance form and switches the view.
  const handleSwitchToRefinance = useCallback(({ balance, rate, termMonths, state: st }) => {
    if (balance) setRfBalance(formatNumberForInput(Math.round(balance)));
    if (rate)    setRfRate(formatNumberForInput(rate, { allowDecimals: true }));
    if (termMonths) setRfTermMonths(formatNumberForInput(termMonths));
    if (st)      setRfState(st);
    setRfTargetMode('cdr');
    setCalcResult(null);
    setCalcError(null);
    setScenarioType('refinance');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Called from the Qualification Proforma's "Continue to the buy calculator"
  // CTA — pre-fills the buy form with the same figures already entered.
  const handleSwitchToBuy = useCallback(({ price, deposit, state: st, fhb, ppor } = {}) => {
    if (price)    setBuyPrice(formatNumberForInput(price));
    if (deposit)  setBuyDeposit(formatNumberForInput(deposit));
    if (st)       setBuyState(st);
    if (fhb)      setBuyFhb(fhb);
    if (ppor)     setBuyPpor(ppor);
    setCalcResult(null);
    setCalcError(null);
    setScenarioType('buy');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleSwitchToProforma = useCallback((prefill = {}) => {
    setProformaPrefill(prefill);
    setCalcResult(null);
    setCalcError(null);
    setScenarioType('proforma');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // ── Direct calculation (structured forms → /calculate, no LLM) ────────────
  const submitDirect = useCallback(async (scenario, extraBody = {}) => {
    setCalcError(null);
    try {
      const data = await runWithStepLog(
        useProcessingStore.getState(),
        'Running calculation…',
        'Deterministic AU scenario maths — please don’t navigate away.',
        [
          'Reading scenario inputs',
          'Running stamp duty / CGT / refinance modules',
          'Building cash-flow and totals',
          'Preparing charts and lender comparison',
        ],
        async () => {
          const res = await api.post('/api/property-scenario/calculate', { scenario, ...extraBody });
          const payload = await res.json();
          if (!res.ok || !payload.ok) throw new Error(payload.message || 'Calculation failed');
          return payload;
        },
      );
      setCalcResult(data);
      setFollowUpAnswers({});
      setTab('overview');
      addToast('Results ready', 'success');
      setTimeout(() => {
        calcResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    } catch (err) {
      setCalcError(err.message || 'Calculation failed');
      addToast(err.message || 'Calculation failed', 'error');
    }
  }, [addToast]);

  const submitRefinance = () => {
    const balance = parseFormattedNumber(rfBalance);
    const rate = parseFormattedNumber(rfRate);
    const termMonths = Math.round(parseFormattedNumber(rfTermMonths));
    if (!balance || !rate || !termMonths) {
      setCalcError('Balance, current rate, and term remaining are required.');
      return;
    }
    const fixedPeriod = rfRateType === 'fixed' && rfFixedPeriod ? Math.round(parseFormattedNumber(rfFixedPeriod)) : undefined;
    const currentLoan = {
      balance, rate, fixed_or_variable: rfRateType, term_remaining_months: termMonths,
      ...(fixedPeriod ? { fixed_period_remaining_months: fixedPeriod } : {}),
    };
    const targetRate = rfTargetMode === 'specific' && rfTargetRate ? parseFormattedNumber(rfTargetRate) : rate;
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
    const salePrice = parseFormattedNumber(sellPrice);
    const purchasePrice = parseFormattedNumber(sellPurchasePrice);
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
    const price = parseFormattedNumber(buyPrice);
    const deposit = parseFormattedNumber(buyDeposit);
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
              : scenarioType === 'proforma' ? 'Broker-realistic file review — strict checks, levers, bank posture, live lender fit'
              : scenarioType === 'qualify' ? 'Lite serviceability check — use the proforma for the full broker file review'
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
              <div className="space-y-6">
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>What would you like to explore?</p>
                {[
                  {
                    group: 'Check my file',
                    items: [
                      { id: 'proforma', icon: 'shield-check', label: 'Qualification proforma', desc: 'Full file review: strict AU checks, structuring levers, per-bank indicative capacity, and live rates when available.', featured: true },
                      { id: 'qualify', icon: 'check-circle', label: 'Lite serviceability check', desc: 'Serviceability, LVR, DTI, and genuine-savings snapshot.' },
                    ],
                  },
                  {
                    group: 'Plan a transaction',
                    items: [
                      { id: 'refinance', icon: 'refresh-cw', label: 'Compare lenders / refinance', desc: 'See if switching saves money. Instant calculation — no AI.' },
                      { id: 'buy', icon: 'key', label: 'Buy a property', desc: 'Stamp duty, LMI, and upfront purchase costs.' },
                      { id: 'sell', icon: 'home', label: 'Sell a property', desc: 'CGT, selling costs, and net proceeds.' },
                      { id: 'compound', icon: 'layers', label: 'Multiple events at once', desc: 'Sell + buy + switch lender together — describe in plain English.' },
                    ],
                  },
                  {
                    group: 'Quick tools',
                    items: [
                      { id: 'calculators', icon: 'calculator', label: 'Quick calculators', desc: 'Repayment, offset, extra repayments, and borrowing power.' },
                    ],
                  },
                ].map((section) => (
                  <div key={section.group} className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{section.group}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {section.items.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => handleTypePick(t.id)}
                          className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-opacity duration-200 hover:opacity-70${t.featured ? ' sm:col-span-2' : ''}`}
                          style={{
                            borderColor: t.featured ? 'var(--color-primary)' : 'var(--color-border)',
                            background: t.featured ? 'color-mix(in srgb, var(--color-primary) 8%, var(--color-bg))' : 'var(--color-bg)',
                          }}
                        >
                          <span className="mt-0.5 shrink-0" style={{ color: 'var(--color-primary)' }}>{getIcon(t.icon, { size: 18 })}</span>
                          <div>
                            <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                              {t.label}
                              {t.featured && (
                                <span className="ml-2 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary)', color: '#fff' }}>
                                  Recommended
                                </span>
                              )}
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{t.desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
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
              <BuyerQualifyForm getIcon={getIcon} addToast={addToast} onSwitchToRefinance={handleSwitchToRefinance} onSwitchToProforma={handleSwitchToProforma} />
            )}

            {/* ── Qualification proforma (broker-realistic review) ─── */}
            {scenarioType === 'proforma' && (
              <QualificationProformaForm
                key={proformaPrefill ? `prefill-${JSON.stringify(proformaPrefill).slice(0, 80)}` : 'blank'}
                getIcon={getIcon}
                addToast={addToast}
                onSwitchToBuy={handleSwitchToBuy}
                initialInputs={proformaPrefill || undefined}
              />
            )}

            {/* ── Refinance / compare lenders form ─────────────────── */}
            {scenarioType === 'refinance' && !calcResult && (
              <Section title="Refinance / compare lenders" hint="Fill in your current loan — we calculate savings against live market rates instantly. No AI involved.">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>State<FieldTip text="Used to calculate government discharge and new mortgage registration fees, which vary by state and affect the true cost of switching lender." /></span>
                      <select value={rfState} onChange={(e) => setRfState(e.target.value)} style={FIELD}>
                        <option value="">Select state (for govt fees)…</option>
                        {['NSW','VIC','QLD','SA','WA','TAS','ACT','NT'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <div />
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Current loan balance ($) *<FieldTip text="Your outstanding principal — check your most recent statement or online banking. Don't use the original loan amount." /></span>
                      <FormattedNumberInput value={rfBalance} onChange={setRfBalance} allowDecimals placeholder="e.g. 100000" style={FIELD} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Current interest rate (%) *<FieldTip text="Defaults to the live average owner-occupier variable rate from CDR. Replace with your actual contract rate from your statement when you know it." /></span>
                      <FormattedNumberInput value={rfRate} onChange={setRfRate} allowDecimals placeholder={marketRateFormatted || 'Loading market average…'} style={FIELD} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Rate type<FieldTip text="Variable rates can change with RBA movements. Fixed rates lock in certainty but may carry significant break costs if you exit the fixed period early." /></span>
                      <select value={rfRateType} onChange={(e) => setRfRateType(e.target.value)} style={FIELD}>
                        <option value="variable">Variable</option>
                        <option value="fixed">Fixed</option>
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Term remaining (months) *<FieldTip text="How many months are left on your current loan. E.g. 20 years remaining = 240 months. Check your loan schedule or call your lender." /></span>
                      <FormattedNumberInput value={rfTermMonths} onChange={setRfTermMonths} placeholder="e.g. 240" style={FIELD} />
                    </label>
                    {rfRateType === 'fixed' && (
                      <label className="block space-y-1.5">
                        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Fixed period remaining (months)<FieldTip text="Months left of your fixed rate period. Break costs are calculated against this — typically higher the more time remains. Your lender can give you the exact break cost figure." /></span>
                        <FormattedNumberInput value={rfFixedPeriod} onChange={setRfFixedPeriod} placeholder="e.g. 24" style={FIELD} />
                      </label>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>Compare against</p>
                    <div className="flex flex-col gap-2">
                      {[
                        { v: 'cdr', label: 'Live market rates — 9 Australian lenders via CDR open banking' },
                        { v: 'specific', label: 'A specific rate I have in mind' },
                      ].map(({ v, label }) => (
                        <label key={v} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                          <input type="radio" name="rfTargetMode" value={v} checked={rfTargetMode === v} onChange={() => setRfTargetMode(v)} />
                          {label}
                        </label>
                      ))}
                      {rfTargetMode === 'specific' && (
                        <FormattedNumberInput value={rfTargetRate} onChange={setRfTargetRate} allowDecimals placeholder={marketRateFormatted || 'Loading market average…'} style={{ ...FIELD, maxWidth: 220 }} />
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
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>State *<FieldTip text="Used to calculate agent commission norms and government transfer costs. CGT rules are federal, but some state concessions apply to PPOR sales." /></span>
                      <select value={sellState} onChange={(e) => setSellState(e.target.value)} style={FIELD}>
                        <option value="">Select state…</option>
                        {['NSW','VIC','QLD','SA','WA','TAS','ACT','NT'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Property type<FieldTip text="Primary residences (PPOR) qualify for the main residence CGT exemption — CGT is $0. Investment properties are fully subject to CGT, with a 50% discount if held over 12 months before adding the gain to your taxable income." /></span>
                      <select value={sellPpor} onChange={(e) => setSellPpor(e.target.value)} style={FIELD}>
                        <option value="ppor">Primary residence (PPOR) — CGT main residence exemption applies</option>
                        <option value="investment">Investment property — CGT applies</option>
                        <option value="mixed">Was PPOR then investment (or vice versa) — partial CGT</option>
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Expected sale price ($) *<FieldTip text="Your estimated or contracted sale price. If not yet sold, use a current market appraisal. Selling costs (agent commission, legal fees) are deducted to arrive at net proceeds." /></span>
                      <FormattedNumberInput value={sellPrice} onChange={setSellPrice} allowDecimals placeholder="e.g. 1200000" style={FIELD} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Original purchase price ($) *<FieldTip text="What you originally paid for the property. For CGT, this is your cost base — it should include stamp duty and legal costs paid at purchase, which reduce your taxable gain." /></span>
                      <FormattedNumberInput value={sellPurchasePrice} onChange={setSellPurchasePrice} allowDecimals placeholder="e.g. 750000" style={FIELD} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Year purchased<FieldTip text="Used to determine whether the 50% CGT discount applies (held more than 12 months) and to estimate the holding period for the result summary." /></span>
                      <FormattedNumberInput value={sellPurchaseYear} onChange={setSellPurchaseYear} placeholder="e.g. 2015" style={FIELD} />
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
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>State *<FieldTip text="Stamp duty rates and First Home Buyer concessions are state-specific. QLD, NSW, VIC, WA all have different thresholds and calculation methods." /></span>
                      <select value={buyState} onChange={(e) => setBuyState(e.target.value)} style={FIELD}>
                        <option value="">Select state…</option>
                        {['NSW','VIC','QLD','SA','WA','TAS','ACT','NT'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Property purpose<FieldTip text="Investment properties don't qualify for First Home Buyer stamp duty concessions. PPOR (owner-occupied) purchases attract lower duty rates and more favourable lender treatment." /></span>
                      <select value={buyPpor} onChange={(e) => setBuyPpor(e.target.value)} style={FIELD}>
                        <option value="ppor">Primary residence (PPOR)</option>
                        <option value="investment">Investment property</option>
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Purchase price ($) *<FieldTip text="The full property purchase price. Stamp duty, LMI, and all upfront costs are calculated as percentages of this figure." /></span>
                      <FormattedNumberInput value={buyPrice} onChange={setBuyPrice} allowDecimals placeholder="e.g. 1200000" style={FIELD} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Deposit ($) *<FieldTip text="Your available deposit (savings + equity). If deposit is below 20% of the purchase price, Lenders Mortgage Insurance (LMI) typically applies — unless you qualify for the First Home Guarantee (5% min)." /></span>
                      <FormattedNumberInput value={buyDeposit} onChange={setBuyDeposit} allowDecimals placeholder="e.g. 240000" style={FIELD} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>First home buyer?<FieldTip text="First home buyers may qualify for stamp duty exemptions or concessions and the First Home Guarantee (5% deposit, no LMI for eligible buyers). State-based FHOG grants also apply for new builds." /></span>
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
              <div ref={calcResultRef}>
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
                  {scenarioType === 'buy' && (
                    <button
                      type="button"
                      onClick={() => handleSwitchToProforma({
                        property_value: buyPrice,
                        deposit_amount: buyDeposit,
                        state: buyState,
                        is_fhb: buyFhb,
                        is_ppor: buyPpor,
                      })}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70"
                      style={{ background: 'var(--color-primary)', color: '#fff' }}
                    >
                      {getIcon('shield-check', { size: 13 })}
                      Continue to qualification proforma
                    </button>
                  )}
                  {scenarioType === 'refinance' && (
                    <button
                      type="button"
                      onClick={() => handleSwitchToProforma({
                        property_value: '',
                        deposit_amount: '',
                        state: rfState,
                        target_rate_pct: rfRate,
                        loan_term_years: rfTermMonths ? String(Math.round(Number(rfTermMonths) / 12)) : '30',
                      })}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70"
                      style={{ background: 'var(--color-primary)', color: '#fff' }}
                    >
                      {getIcon('shield-check', { size: 13 })}
                      Continue to qualification proforma
                    </button>
                  )}
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
              </div>
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
                    const placeholder = isInterestRateClarifyField(row)
                      ? (marketRateFormatted || 'Loading market average…')
                      : (row.placeholder
                        || (type === 'number' ? 'e.g. 650000 or 5.49' : isFreeText ? 'Your answer…' : ''));

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
