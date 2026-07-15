import React, { useMemo, useState } from 'react';
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
