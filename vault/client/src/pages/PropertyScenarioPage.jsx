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

export default function PropertyScenarioPage() {
  const navigate = useNavigate();
  const getIcon = useIcon();
  const user = useAuthStore((s) => s.user);
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const isAdmin = Boolean(user?.isAdmin);
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
              style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, transition: 'opacity 0.2s' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
            >
              {getIcon('compass', { size: 15 })}
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
