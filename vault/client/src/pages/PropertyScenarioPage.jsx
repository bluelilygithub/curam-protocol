import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { startPropertyScenarioTour, TOUR_KEY as PS_TOUR_KEY } from '../utils/tours/propertyScenarioTour';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
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

function inferInputType(fieldPath = '', message = '') {
  const path = String(fieldPath).toLowerCase();
  const msg = String(message).toLowerCase();
  if (/date|settlement|purchase_date|payout/.test(path) || /\bdate\b/.test(msg)) return 'date';
  if (/rate|pct|percent|lvr/.test(path) || /%|per\s*cent|rate/.test(msg)) return 'number';
  if (/balance|amount|price|value|cost|deposit|fee/.test(path) || /\$|dollar|deposit|balance|price|cost/.test(msg)) return 'number';
  if (/months|term|years?/.test(path) || /month|year|term/.test(msg)) return 'number';
  if (/state/.test(path) || /\b(nsw|vic|qld|sa|wa|tas|act|nt)\b/.test(msg)) return 'state';
  if (/true|false|yes|no|ppor|first.?home|fhb|investment/.test(path + ' ' + msg)) return 'boolean';
  return 'text';
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
            {[
              { label: 'Total costs', value: calc?.totals?.total_costs },
              { label: 'Stamp duty', value: calc?.totals?.stamp_duty },
              { label: 'Deposit from sale', value: calc?.totals?.deposit_funded_from_sale },
              { label: 'Monthly saving', value: calc?.totals?.monthly_repayment_saving },
            ].map((s) => (
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
  const [pipeline, setPipeline] = useState(null);
  const [pipelineError, setPipelineError] = useState(null);
  const [answers, setAnswers] = useState({});
  const [assumeSellingCosts, setAssumeSellingCosts] = useState(true);

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

  const submitParse = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setPipelineError('Describe your situation first.');
      return;
    }
    setPipelineError(null);
    startProcessing('Parsing your scenario…', 'AI is assigning numbers from your text. Please don’t navigate away.');
    try {
      const res = await api.post('/api/property-scenario/parse', { text: trimmed });
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

    const coerced = {};
      formRows.forEach((row) => {
      const type = inferInputType(row.field_path, row.message);
      const raw = answers[row.id];
      if (raw === undefined || raw === '') return;
      const value = coerceAnswer(raw, type);
      // Prefer field_path so validation-driven rows (not in unresolved_assumptions) still apply
      const key = row.field_path && row.field_path !== 'clarifying_questions'
        ? row.field_path
        : row.id;
      coerced[key] = value;
      // Also clear matching assumption id when present
      if (row.id && row.id !== key) coerced[row.id] = value;
    });

    startProcessing('Updating scenario…', 'Applying your answers and recalculating when ready.');
    try {
      const body = {
        scenario: pipeline.scenario,
        answers: coerced,
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
            {mode === 'describe'
              ? 'Describe a refinance, sale, purchase, or switch in plain English'
              : (demo?.scenario_meta?.title || 'Compound sell → buy → switch (fixture demo)')}
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
            <Section
              title="Your situation"
              hint="Numbers are pre-extracted from your text, then assigned to scenario fields. Invented numbers are stripped."
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder={'e.g. I’m selling our NSW PPOR for about $1.45m (bought 2015 for $720k), buying in Sept for $1.8m with 20% deposit, and switching the new loan to a 5.49% variable with OnlineBank…'}
                style={{ ...FIELD, resize: 'vertical', minHeight: 120 }}
              />
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
                    const type = inferInputType(row.field_path, row.message);
                    return (
                      <label key={row.id} className="block space-y-1.5">
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                          {row.message}
                        </span>
                        <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                          {row.field_path}
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
                        ) : (
                          <input
                            type={type === 'date' ? 'date' : type === 'number' ? 'text' : 'text'}
                            inputMode={type === 'number' ? 'decimal' : undefined}
                            value={answers[row.id] ?? ''}
                            onChange={(e) => setAnswers((a) => ({ ...a, [row.id]: e.target.value }))}
                            placeholder={type === 'number' ? 'e.g. 650000 or 5.49' : 'Your answer'}
                            style={FIELD}
                          />
                        )}
                      </label>
                    );
                  })}

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

            {pipeline?.ok && pipeline.validation && pipeline.validation.ok === false && (
              <div
                className="rounded-xl border px-4 py-3 text-sm space-y-1"
                style={{ borderColor: '#f59e0b', background: '#fef3c7', color: '#b45309' }}
              >
                <p className="font-medium">Validation still incomplete</p>
                {(pipeline.validation.errors || []).slice(0, 6).map((e) => (
                  <p key={`${e.code}-${e.path}`} className="text-xs">
                    {e.path ? `${e.path}: ` : ''}{e.message}
                  </p>
                ))}
              </div>
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
