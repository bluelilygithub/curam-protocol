import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  LineChart,
  Line,
  AreaChart,
  Area,
  ReferenceLine,
} from 'recharts';
import api from '../../utils/apiClient';
import useProcessingStore from '../../store/processingStore';

const tooltipStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--color-text)',
};

function money(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `$${Number(n).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;
}

export function FundingAlertBanner({ alert }) {
  const [showCost, setShowCost] = useState(false);
  if (!alert || !alert.bridging_required) return null;

  const modeling = alert.bridging_modeling;
  const bridgePath = modeling?.paths?.bridging_loan;
  const refusePath = modeling?.paths?.refuse_until_clarified;
  const cost = bridgePath?.indicative_interest_cost ?? modeling?.indicative_interest_cost;

  return (
    <div
      role="alert"
      className="rounded-xl border px-4 py-3 space-y-2"
      style={{ borderColor: '#f59e0b', background: '#fef3c7', color: '#92400e' }}
      data-testid="funding-alert-banner"
      data-requires-user-decision={alert.requires_user_decision !== false ? 'true' : 'false'}
      data-default-path={alert.default_path || 'refuse_until_clarified'}
    >
      <p className="text-sm font-semibold" data-testid="funding-alert-headline">
        {alert.title || 'Funding gap — your decision needed'}
      </p>
      <p className="text-sm leading-relaxed" data-testid="funding-alert-primary">
        {alert.message
          || refusePath?.summary
          || 'This scenario is not fully resolved until you arrange bridging/other cash or change the timeline.'}
      </p>
      {Number(alert.deposit_shortfall) > 0 && (
        <p className="text-sm font-medium tabular-nums">
          Shortfall: ${Number(alert.deposit_shortfall).toLocaleString('en-AU', { maximumFractionDigits: 0 })}
        </p>
      )}
      <p className="text-xs font-medium" data-testid="funding-alert-default-path">
        Default: refuse until clarified — not a green light to proceed.
      </p>

      {bridgePath && cost != null && (
        <div className="pt-1 border-t" style={{ borderColor: '#f59e0b' }}>
          <button
            type="button"
            onClick={() => setShowCost((v) => !v)}
            className="text-xs font-medium hover:opacity-70 transition-opacity duration-200"
            data-testid="funding-alert-cost-toggle"
          >
            {showCost ? 'Hide' : 'Show'} indicative bridging cost (informational only)
          </button>
          {showCost && (
            <div className="mt-2 space-y-1 text-xs leading-relaxed" data-testid="funding-alert-cost-detail">
              <p>
                Interest-only estimate for {bridgePath.gap_days} day(s) at ~{bridgePath.bridging_rate_pct}% p.a.:{' '}
                <span className="font-semibold tabular-nums">
                  ${Number(cost).toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                </span>
              </p>
              <p style={{ color: '#a16207' }}>
                Not a lender quote. Not a recommendation to use bridging. Eligibility/serviceability
                are not modelled — speak to your broker before relying on this figure.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RateComparisonChart({ data = [] }) {
  if (!data.length) return <EmptyChart label="No lender stub rates" />;
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fill: 'var(--color-muted)', fontSize: 10 }} angle={-20} textAnchor="end" interval={0} height={60} />
          <YAxis tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend />
          <Bar dataKey="rate" name="Advertised %" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="comparison_rate" name="Comparison %" fill="var(--color-muted)" radius={[4, 4, 0, 0]} opacity={0.55} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CumulativeCostChart({ pack }) {
  const series = pack?.series || [];
  const lenders = pack?.lenders || [];
  if (!series.length || !lenders.length) return <EmptyChart label="No cumulative cost series" />;
  const colors = ['var(--color-primary)', '#888888', '#b45309'];
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="year" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} label={{ value: 'Years', position: 'insideBottom', offset: -2, fill: 'var(--color-muted)', fontSize: 11 }} />
          <YAxis tick={{ fill: 'var(--color-muted)', fontSize: 11 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)} />
          <Legend />
          {lenders.map((l, i) => (
            <React.Fragment key={l.id}>
              <Line type="monotone" dataKey={`${l.id}_rate_only`} name={`${l.name} (rate)`} stroke={colors[i % colors.length]} strokeDasharray="4 4" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey={`${l.id}_with_fees`} name={`${l.name} (+fees)`} stroke={colors[i % colors.length]} dot={false} strokeWidth={2} />
            </React.Fragment>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AmortizationChart({ pack }) {
  const schedule = pack?.schedule || [];
  if (!schedule.length) return <EmptyChart label="No amortisation schedule" />;
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={schedule} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="year" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
          <YAxis tick={{ fill: 'var(--color-muted)', fontSize: 11 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)} />
          <Legend />
          <Area type="monotone" dataKey="principal" name="Principal" stackId="1" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.7} />
          <Area type="monotone" dataKey="interest" name="Interest" stackId="1" stroke="var(--color-muted)" fill="var(--color-muted)" fillOpacity={0.35} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BreakEvenChart({ pack }) {
  const series = pack?.series || [];
  if (!series.length) return <EmptyChart label={pack?.note || 'No break-even series'} />;
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="month" tick={{ fill: 'var(--color-muted)', fontSize: 11 }} />
          <YAxis tick={{ fill: 'var(--color-muted)', fontSize: 11 }} tickFormatter={(v) => money(v)} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)} />
          <Legend />
          <Line type="monotone" dataKey="cumulative_cost" name="Cumulative switch cost" stroke="#ef4444" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="cumulative_savings" name="Cumulative savings" stroke="var(--color-primary)" dot={false} strokeWidth={2} />
          {pack.break_even_months != null && (
            <ReferenceLine x={pack.break_even_months} stroke="#b45309" strokeDasharray="4 4" label={{ value: `BE ~${pack.break_even_months}m`, fill: '#b45309', fontSize: 11 }} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyChart({ label }) {
  return (
    <div className="h-40 flex items-center justify-center text-sm rounded-xl border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
      {label}
    </div>
  );
}

export function LenderComparisonTable({ rows = [] }) {
  const [sortKey, setSortKey] = useState('rate');
  const [sortDir, setSortDir] = useState('asc');
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    let list = [...rows];
    if (filter === 'variable') list = list.filter((r) => r.fixed_or_variable === 'variable');
    if (filter === 'fixed') list = list.filter((r) => r.fixed_or_variable === 'fixed');
    if (filter === 'offset') list = list.filter((r) => r.offset);
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? (av ?? 0) - (bv ?? 0) : (bv ?? 0) - (av ?? 0);
    });
    return list;
  }, [rows, sortKey, sortDir, filter]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const th = (key, label) => (
    <th className="text-left px-3 py-2 text-xs font-medium cursor-pointer hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }} onClick={() => toggleSort(key)}>
      {label}{sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'all', label: 'All' },
          { id: 'variable', label: 'Variable' },
          { id: 'fixed', label: 'Fixed' },
          { id: 'offset', label: 'With offset' },
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity duration-200 hover:opacity-70"
            style={{
              background: filter === f.id ? 'var(--color-primary)' : 'var(--color-bg)',
              color: filter === f.id ? '#fff' : 'var(--color-text)',
              border: `1px solid ${filter === f.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-sm min-w-[720px]">
          <thead style={{ background: 'var(--color-bg)' }}>
            <tr>
              {th('name', 'Product')}
              {th('rate', 'Rate %')}
              {th('comparison_rate', 'Comp %')}
              {th('monthly_repayment', 'Monthly')}
              {th('total_cost_interest_plus_fees', 'Life cost*')}
              {th('upfront_fees', 'Upfront (est.)')}
              <th className="text-left px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Features</th>
              <th className="text-left px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Docs</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="px-3 py-2.5" style={{ color: 'var(--color-text)' }}>
                  <div className="font-medium flex flex-wrap items-center gap-1.5">
                    <span>{r.name}</span>
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{
                        background: r.stub || r.provenance === 'mock' ? '#fef3c7' : 'var(--color-bg)',
                        color: r.stub || r.provenance === 'mock' ? '#b45309' : 'var(--color-muted)',
                        border: `1px solid ${r.stub || r.provenance === 'mock' ? '#f59e0b' : 'var(--color-border)'}`,
                      }}
                      title={r.stub || r.provenance === 'mock'
                        ? 'Mock / stub rate — not a live CDR feed'
                        : 'Live CDR Product Reference Data'}
                    >
                      {r.provenance_label || (r.stub ? 'MOCK' : 'CDR')}
                    </span>
                    {r.special_eligibility && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                        style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #f59e0b' }}
                        title={r.special_reason || 'Restricted product'}
                      >
                        {r.special_eligibility_label || 'Special eligibility required'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {r.lender}
                    {r.fixed_or_variable === 'fixed' && r.fixed_period_months
                      ? ` · ${r.fixed_period_months}m fixed`
                      : ''}
                  </div>
                </td>
                <td className="px-3 py-2.5">{r.rate?.toFixed?.(2)}</td>
                <td className="px-3 py-2.5">{r.comparison_rate?.toFixed?.(2) ?? '—'}</td>
                <td className="px-3 py-2.5">{money(r.monthly_repayment)}</td>
                <td className="px-3 py-2.5">{money(r.total_cost_interest_plus_fees)}</td>
                <td className="px-3 py-2.5">
                  {money(r.upfront_fees)}
                  {(r.fees_estimated || r.upfront_fees_estimated) && (
                    <span className="block text-[10px]" style={{ color: 'var(--color-muted)' }}>estimated</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                  {[r.fixed_or_variable, r.offset ? 'offset' : null, r.redraw ? 'redraw' : null].filter(Boolean).join(' · ')}
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {r.links?.terms || r.links?.fees || r.links?.overview ? (
                    <a
                      href={r.links.terms || r.links.fees || r.links.overview}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:opacity-70 transition-opacity duration-200"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      T&Cs / PDS
                    </a>
                  ) : (
                    <span style={{ color: 'var(--color-muted)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        * Interest + estimated fees over term — indicative only, not a product recommendation.
        Upfront fees are heuristically summed from CDR fee objects (est.), not a bank quote.
        MOCK rows are stub data (fallback), not live market rates.
      </p>
    </div>
  );
}

/**
 * Stage 11 — Ask about a lender's terms (document insight).
 * Visually separate from deterministic Scenario/Charts/Tables numbers.
 */
export function LenderTermsInsight({ rows = [] }) {
  const [productId, setProductId] = useState(rows[0]?.id || '');
  const [question, setQuestion] = useState('');
  const [compareIds, setCompareIds] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { startProcessing, stopProcessing } = useProcessingStore();

  useEffect(() => {
    if (!productId && rows[0]?.id) setProductId(rows[0].id);
  }, [rows, productId]);

  const productsWithDocs = useMemo(
    () => rows.filter((r) => r.links?.terms || r.links?.fees || r.links?.overview),
    [rows]
  );

  const selected = rows.find((r) => r.id === productId) || null;

  async function askSingle() {
    if (!selected || !question.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    startProcessing('Reading lender documents…', 'Fetching T&Cs/PDS and analysing. Please don’t navigate away.');
    try {
      const res = await api.post('/api/property-scenario/insights', {
        product: selected,
        question: question.trim(),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || 'Could not analyse document');
        setResult(data);
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err.message || 'Insight request failed');
    } finally {
      stopProcessing();
      setBusy(false);
    }
  }

  async function askCompare() {
    if (compareIds.length < 2 || !question.trim()) return;
    const products = rows.filter((r) => compareIds.includes(r.id));
    setBusy(true);
    setError(null);
    setResult(null);
    startProcessing('Comparing lender documents…', 'Fetching and reading multiple T&Cs/PDS files.');
    try {
      const res = await api.post('/api/property-scenario/insights/compare', {
        products,
        question: question.trim(),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || 'Could not compare documents');
        setResult(data);
        return;
      }
      setResult({ ...data, _compare: true });
    } catch (err) {
      setError(err.message || 'Compare failed');
    } finally {
      stopProcessing();
      setBusy(false);
    }
  }

  function toggleCompare(id) {
    setCompareIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 4)
    ));
  }

  if (!rows.length) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        Load lender rates first to ask about their published terms.
      </p>
    );
  }

  return (
    <div
      className="rounded-xl border p-4 space-y-4"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-bg)',
        borderStyle: 'dashed',
      }}
    >
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          Ask about a lender&apos;s terms
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          Exploratory document reading (T&amp;Cs / PDS) — not part of scenario maths.
          Answers must cite the document; gaps are called out instead of invented.
        </p>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Product</span>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
        >
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.lender} — {r.name}
              {r.links?.terms || r.links?.fees ? '' : ' (no doc link)'}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-1.5">
        <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Suggested questions</span>
        <div className="flex flex-wrap gap-1.5">
          {[
            'What are the actual early repayment conditions — any caps or fees on extra payments?',
            'Does the fine print match the advertised offset account — any balance caps or fee conditions?',
            "What's the real break cost formula if I leave a fixed rate early?",
            'Are there any ongoing fees not captured in the CDR summary?',
            'What do the eligibility conditions actually say — who does this product exclude?',
          ].map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuestion(q)}
              className="px-2.5 py-1 rounded-lg text-xs transition-opacity duration-200 hover:opacity-70 text-left"
              style={{
                background: question === q ? 'var(--color-primary)' : 'var(--color-surface)',
                color: question === q ? '#fff' : 'var(--color-text)',
                border: `1px solid ${question === q ? 'var(--color-primary)' : 'var(--color-border)'}`,
              }}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Or type your own question</span>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="e.g. Can I pay this off early without penalty?"
          className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-y"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !question.trim() || !selected}
          onClick={askSingle}
          className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          {busy ? 'Reading document…' : 'Ask about this product'}
        </button>
      </div>

      {productsWithDocs.length >= 2 && (
        <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
            Optional compare (select 2+)
          </p>
          <div className="flex flex-wrap gap-2">
            {productsWithDocs.slice(0, 8).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => toggleCompare(r.id)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity duration-200 hover:opacity-70"
                style={{
                  background: compareIds.includes(r.id) ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: compareIds.includes(r.id) ? '#fff' : 'var(--color-text)',
                  border: `1px solid ${compareIds.includes(r.id) ? 'var(--color-primary)' : 'var(--color-border)'}`,
                }}
              >
                {r.lender}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || compareIds.length < 2 || !question.trim()}
            onClick={askCompare}
            className="px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Compare selected documents
          </button>
        </div>
      )}

      {error && (
        <div
          className="rounded-xl border px-3 py-2 text-sm"
          style={{ borderColor: '#ef4444', background: '#fff1f2', color: '#991b1b' }}
        >
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {(result.findings || []).length > 0 && (
            <ul className="space-y-3">
              {result.findings.map((f, i) => (
                <li
                  key={`${f.claim}-${i}`}
                  className="rounded-xl border p-3 space-y-1.5"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                >
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{f.claim}</p>
                  {f.source_quote_or_paraphrase && (
                    <p className="text-xs italic" style={{ color: 'var(--color-muted)' }}>
                      “{f.source_quote_or_paraphrase}”
                    </p>
                  )}
                  {f.document_section_or_location && (
                    <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                      Source: {f.document_section_or_location}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {(result.uncited_gaps || []).length > 0 && (
            <div
              className="rounded-xl border px-3 py-2 space-y-1"
              style={{ borderColor: '#f59e0b', background: '#fef3c7', color: '#b45309' }}
            >
              <p className="text-xs font-medium">Not addressed / gaps</p>
              {result.uncited_gaps.map((g) => (
                <p key={g} className="text-xs">{g}</p>
              ))}
            </div>
          )}

          {(result.disagreements || []).length > 0 && (
            <div
              className="rounded-xl border px-3 py-2 space-y-1"
              style={{ borderColor: '#f59e0b', background: '#fef3c7', color: '#b45309' }}
            >
              <p className="text-xs font-medium">Document disagreements</p>
              {result.disagreements.map((d) => (
                <p key={d} className="text-xs">{d}</p>
              ))}
            </div>
          )}

          {result.disclaimer && (
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
              {result.disclaimer}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ScenarioSummaryTable({ summary }) {
  const totals = summary?.totals || [];
  const events = summary?.events || [];
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--color-bg)' }}>
            <tr>
              <th className="text-left px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Metric</th>
              <th className="text-right px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((r) => (
              <tr key={r.key} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{r.label}</td>
                <td className="px-3 py-2 text-right font-medium" style={{ color: r.kind === 'cost' ? '#ef4444' : 'var(--color-text)' }}>
                  {money(r.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {events.length > 0 && (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--color-bg)' }}>
              <tr>
                <th className="text-left px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Event</th>
                <th className="text-left px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Date</th>
                <th className="text-right px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Event costs</th>
              </tr>
            </thead>
            <tbody>
              {events.map((r) => (
                <tr key={r.key} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{r.label}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>{r.meta?.date}</td>
                  <td className="px-3 py-2 text-right">{money(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Interactive follow-up Q&A panel. Each suggested question can be sent to the AI
 * for an answer grounded in the actual calculation results. Users can also add
 * their own questions. Answered questions become inactive. Answers are surfaced
 * to the parent via onAnswer so they can reach the PDF.
 */
export function FollowUpPanel({ advice, calcResult, scenarioType, answers = {}, onAnswer }) {
  const [asking, setAsking] = useState(null); // question text currently loading
  const [customText, setCustomText] = useState('');
  const [customQuestions, setCustomQuestions] = useState([]); // user-added questions
  const [error, setError] = useState(null);
  // Ordered turn history for this session — threaded into advice/ask so
  // question 2 can build on question 1's answer. Explain-only; never feeds calc.
  const [turns, setTurns] = useState([]);

  if (!advice) return null;

  const suggested = advice.follow_up_questions || [];
  const raise = advice.raise_with_broker_or_tax_agent || [];
  const allQuestions = [...suggested, ...customQuestions];

  async function askQuestion(question) {
    if (!question.trim() || asking || answers[question]) return;
    setAsking(question);
    setError(null);
    try {
      const res = await api.post('/api/property-scenario/advice/ask', {
        question: question.trim(),
        calcResult,
        scenarioType,
        history: turns,
      });
      if (res.ok && res.answer) {
        onAnswer?.(question, res.answer);
        setTurns((prev) => [...prev, { question: question.trim(), answer: res.answer }]);
      } else {
        setError(res.message || 'Could not get an answer — try again.');
      }
    } catch (err) {
      setError(err.message || 'Request failed.');
    } finally {
      setAsking(null);
    }
  }

  function addCustomQuestion() {
    const q = customText.trim();
    if (!q || allQuestions.includes(q)) return;
    setCustomQuestions((prev) => [...prev, q]);
    setCustomText('');
    // Auto-ask the custom question immediately
    askQuestion(q);
  }

  return (
    <div className="space-y-6">
      {/* Follow-up questions */}
      <div className="rounded-2xl border p-5 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div>
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Follow-up questions</h3>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Generated from your scenario's caveats — click Ask to get an explanation grounded in your specific numbers.
          </p>
        </div>

        {error && (
          <p className="text-xs px-3 py-2 rounded-lg" style={{ color: '#ef4444', background: '#fef2f2' }}>{error}</p>
        )}

        <ol className="space-y-4">
          {allQuestions.map((q, idx) => {
            const answered = Boolean(answers[q]);
            const loading = asking === q;
            const isCustom = idx >= suggested.length;
            return (
              <li key={q} className="space-y-2">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 shrink-0 text-xs font-mono w-5 text-right"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {idx + 1}.
                  </span>
                  <div className="flex-1 min-w-0 space-y-2">
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: answered ? 'var(--color-muted)' : 'var(--color-text)' }}
                    >
                      {q}
                      {isCustom && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>
                          yours
                        </span>
                      )}
                    </p>
                    {!answered && (
                      <button
                        type="button"
                        disabled={loading || answered}
                        onClick={() => askQuestion(q)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                        style={{
                          borderColor: 'var(--color-primary)',
                          color: 'var(--color-primary)',
                          background: 'transparent',
                        }}
                      >
                        {loading ? 'Asking…' : 'Ask this'}
                      </button>
                    )}
                    {answered && (
                      <div
                        className="text-sm leading-relaxed p-3 rounded-xl"
                        style={{ background: 'var(--color-bg)', borderLeft: '3px solid var(--color-primary)', paddingLeft: 12 }}
                      >
                        <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-primary)' }}>Answer</p>
                        <p style={{ color: 'var(--color-text)', whiteSpace: 'pre-wrap' }}>{answers[q]}</p>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {/* Add your own question */}
        <div className="pt-3 border-t space-y-2" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Add your own question</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomQuestion()}
              placeholder="e.g. What would happen if rates rose 1%?"
              className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
              }}
            />
            <button
              type="button"
              disabled={!customText.trim() || !!asking}
              onClick={addCustomQuestion}
              className="px-3 py-2 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
              style={{ background: 'var(--color-primary)', color: '#fff' }}
            >
              Ask
            </button>
          </div>
        </div>
      </div>

      {/* Raise with broker */}
      {raise.length > 0 && (
        <div className="rounded-2xl border p-5 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Raise with your broker / tax agent</h3>
          <ul className="space-y-2 text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            {raise.map((item) => (
              <li key={item} className="flex gap-2">
                <span style={{ color: 'var(--color-primary)' }}>·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <WhatIfPanel scenario={calcResult?.scenario} />
    </div>
  );
}

/**
 * "What if…" panel — DOES recalculate, unlike the explain-only Q&A above.
 * Sends the current scenario + free-text question; server whitelists which
 * fields the LLM may adjust and returns original vs what-if totals side by
 * side. Never overwrites the live scenario/calc on screen.
 */
export function WhatIfPanel({ scenario }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  if (!scenario) return null;

  async function runWhatIf() {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post('/api/property-scenario/advice/what-if', {
        scenario,
        question: text.trim(),
      });
      if (res.ok) {
        setResult(res);
      } else {
        setError(res.message || 'Could not run that what-if — try rephrasing.');
      }
    } catch (err) {
      setError(err.message || 'Request failed.');
    } finally {
      setLoading(false);
    }
  }

  const totalKeys = result
    ? Array.from(new Set([
      ...Object.keys(result.original_totals || {}),
      ...Object.keys(result.what_if_totals || {}),
    ]))
    : [];

  return (
    <div className="rounded-2xl border p-5 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Try a what-if</h3>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          Unlike the questions above, this recalculates your scenario with the change applied — e.g.
          "what if my deposit was $50k more?" or "what if the rate was 6.2%?". Your original result is untouched.
        </p>
      </div>

      {error && (
        <p className="text-xs px-3 py-2 rounded-lg" style={{ color: '#ef4444', background: '#fef2f2' }}>{error}</p>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runWhatIf()}
          placeholder="e.g. What if I put in an extra $50,000 deposit?"
          className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
        />
        <button
          type="button"
          disabled={!text.trim() || loading}
          onClick={runWhatIf}
          className="px-3 py-2 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          {loading ? 'Calculating…' : 'Run what-if'}
        </button>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {result.appliedChanges.map((c) => (
              <div key={c.field_path}>
                Changed <strong>{c.field_path}</strong>: {String(c.from)} → {String(c.to)}
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: 'var(--color-muted)' }}>
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2 font-medium text-right">Original</th>
                  <th className="px-3 py-2 font-medium text-right">What-if</th>
                </tr>
              </thead>
              <tbody>
                {totalKeys.map((k) => {
                  const before = result.original_totals?.[k];
                  const after = result.what_if_totals?.[k];
                  return (
                    <tr key={k} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{k}</td>
                      <td className="px-3 py-2 text-right" style={{ color: 'var(--color-muted)' }}>
                        {typeof before === 'number' ? money(before) : String(before ?? '—')}
                      </td>
                      <td className="px-3 py-2 text-right font-medium" style={{ color: 'var(--color-text)' }}>
                        {typeof after === 'number' ? money(after) : String(after ?? '—')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{result.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

// Keep AdvicePanel as a read-only fallback for legacy/demo paths that don't have calcResult
export function AdvicePanel({ advice }) {
  if (!advice) return null;
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div className="rounded-2xl border p-5 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Follow-up questions</h3>
        <ol className="list-decimal pl-5 space-y-2 text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
          {(advice.follow_up_questions || []).map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </div>
      <div className="rounded-2xl border p-5 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Raise with your broker / tax agent</h3>
        <ul className="space-y-2 text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          {(advice.raise_with_broker_or_tax_agent || []).map((item) => (
            <li key={item} className="flex gap-2">
              <span style={{ color: 'var(--color-primary)' }}>·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function CalculatorSnapshots({ calculators }) {
  if (!calculators) return null;
  const cards = [
    { key: 'repayment', title: 'Repayment', result: calculators.repayment },
    { key: 'extra_repayments', title: 'Extra +$200/mo', result: calculators.extra_repayments },
    { key: 'offset', title: 'Offset $50k', result: calculators.offset },
    { key: 'borrowing_power', title: 'Borrowing power', result: calculators.borrowing_power },
  ];
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {cards.map((c) => (
        <div key={c.key} className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{c.title}</p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
            {c.result?.explanation || '—'}
          </p>
          {c.key === 'borrowing_power' && c.result?.caveats?.[0] && (
            <p className="text-xs leading-relaxed" style={{ color: '#b45309' }}>{c.result.caveats[0]}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function CashFlowTimeline({ timeline = [] }) {
  if (!timeline.length) return null;
  return (
    <div className="space-y-2">
      {timeline.map((f, i) => {
        const sign = f.direction === 'in' ? '+' : f.direction === 'out' ? '−' : '↔';
        const color = f.direction === 'in' ? '#166534' : f.direction === 'out' ? '#991b1b' : 'var(--color-muted)';
        return (
          <div key={`${f.event_id}-${f.category}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm border-b pb-2" style={{ borderColor: 'var(--color-border)' }}>
            <span className="text-xs w-28 shrink-0" style={{ color: 'var(--color-muted)' }}>{f.date}</span>
            <span className="font-medium tabular-nums w-28" style={{ color }}>{sign}{money(f.amount)}</span>
            <span style={{ color: 'var(--color-text)' }}>{f.category.replace(/_/g, ' ')}</span>
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{f.note}</span>
          </div>
        );
      })}
    </div>
  );
}
