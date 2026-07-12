import React, { useState } from 'react';
import MultiLineChart from './MultiLineChart';
import BenchmarkBarChart from './BenchmarkBarChart';
import DayMoversChart from './DayMoversChart';
import DrawdownBars from './DrawdownBars';
import MoveHeatmap from './MoveHeatmap';
import EarningsTimeline from './EarningsTimeline';
import AllocationPie from './AllocationPie';
import HorizontalBars from './HorizontalBars';

const DAY_OPTIONS = [
  { value: 1, label: 'Today' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

function ChartSection({ title, subtitle, children }) {
  return (
    <section
      className="mb-6 p-4 rounded-lg border"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <h2 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{title}</h2>
      {subtitle && (
        <p className="text-xs mt-0.5 mb-3" style={{ color: 'var(--color-muted)' }}>{subtitle}</p>
      )}
      {!subtitle && <div className="mb-3" />}
      {children}
    </section>
  );
}

export default function SharesChartsTab({
  charts,
  days,
  onDaysChange,
  loading,
  positions = [],
  realized = [],
  PortfolioPnlBarChart,
}) {
  const [showCash, setShowCash] = useState(false);

  if (loading && !charts) {
    return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading charts…</p>;
  }
  if (!charts) {
    return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Charts unavailable.</p>;
  }

  const symbolKeys = Object.keys(charts.bySymbol || {});
  const pattern = charts.patternSummary || {};
  const thresholds = pattern.alertThresholds || {};

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Insight charts aligned with the daily Portfolio Note — benchmarks, beat/lag, drawdowns, and history.
        </p>
        <div className="flex gap-1 p-0.5 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          {DAY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onDaysChange(opt.value)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-opacity hover:opacity-70"
              style={{
                background: days === opt.value ? 'var(--color-primary)' : 'transparent',
                color: days === opt.value ? '#fff' : 'var(--color-muted)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Today ── */}
      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-primary)' }}>Today</p>

      <ChartSection
        title="Portfolio vs benchmarks"
        subtitle="Holdings day move (cash excluded) compared to Nasdaq, SOX, and ASX 200 ETF proxies — same basis as the Portfolio Note header."
      >
        <BenchmarkBarChart items={charts.benchmarksToday} />
      </ChartSection>

      <ChartSection
        title="Day movers & beat/lag"
        subtitle="Per-holding day % with divergence vs assigned sector benchmark (SOX for semis, ASX 200 for ASX, Nasdaq otherwise)."
      >
        <DayMoversChart movers={charts.dayMovers} />
      </ChartSection>

      <ChartSection
        title="Drawdown & alert status"
        subtitle={`% off high-water mark since purchase. Triggers: ${thresholds.peakOffPct ?? 10}% off peak · ${thresholds.avgCostOffPct ?? 4}% off avg cost.`}
      >
        <DrawdownBars
          rows={charts.alertRows}
          peakTrigger={-(thresholds.peakOffPct ?? 10)}
          costTrigger={-(thresholds.avgCostOffPct ?? 4)}
        />
      </ChartSection>

      {/* ── Performance ── */}
      <p className="text-xs font-semibold uppercase tracking-wide mb-2 mt-2" style={{ color: 'var(--color-primary)' }}>Performance</p>

      {charts.normalizedPerformance?.length > 1 && (
        <ChartSection
          title="Relative performance (rebased to 100)"
          subtitle="Cumulative daily returns from stored Portfolio Note observations — portfolio vs index proxies."
        >
          <MultiLineChart
            points={charts.normalizedPerformance}
            dateKey="date"
            series={[
              { key: 'portfolio', label: 'Your holdings', color: 'var(--color-primary)' },
              { key: 'nasdaq', label: 'Nasdaq', color: '#5B6FAD' },
              { key: 'sox', label: 'SOX', color: '#8A5C8A' },
              { key: 'asx', label: 'ASX 200', color: '#6B97B5' },
            ]}
            emptyMessage="Run Portfolio Note for a few days to build relative performance history."
          />
        </ChartSection>
      )}

      <ChartSection
        title="Portfolio value"
        subtitle={days === 1 ? 'Intraday snapshots from quote polls and manual refresh.' : `Daily snapshots over the last ${days} days.`}
      >
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => setShowCash(false)}
            className="text-[10px] px-2 py-0.5 rounded border transition-opacity hover:opacity-70"
            style={{
              borderColor: 'var(--color-border)',
              background: !showCash ? 'var(--color-bg)' : 'transparent',
              color: 'var(--color-text)',
            }}
          >
            Holdings + cash
          </button>
          <button
            type="button"
            onClick={() => setShowCash(true)}
            className="text-[10px] px-2 py-0.5 rounded border transition-opacity hover:opacity-70"
            style={{
              borderColor: 'var(--color-border)',
              background: showCash ? 'var(--color-bg)' : 'transparent',
              color: 'var(--color-text)',
            }}
          >
            Show cash line
          </button>
        </div>
        <MultiLineChart
          points={charts.portfolioSnapshots}
          series={showCash
            ? [
              { key: 'totalValueAud', label: 'Total' },
              { key: 'holdingsValueAud', label: 'Holdings' },
              { key: 'cashAud', label: 'Cash' },
            ]
            : [
              { key: 'totalValueAud', label: 'Total' },
              { key: 'holdingsValueAud', label: 'Holdings' },
            ]}
        />
        {charts.portfolioSnapshots?.length > 0 && charts.portfolioSnapshots[charts.portfolioSnapshots.length - 1]?.pnlPct != null && (
          <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
            Book unrealised P&L: {charts.portfolioSnapshots[charts.portfolioSnapshots.length - 1].pnlPct >= 0 ? '+' : ''}
            {charts.portfolioSnapshots[charts.portfolioSnapshots.length - 1].pnlPct.toFixed(2)}% vs cost basis
          </p>
        )}
      </ChartSection>

      {/* ── Holdings ── */}
      <p className="text-xs font-semibold uppercase tracking-wide mb-2 mt-2" style={{ color: 'var(--color-primary)' }}>Holdings</p>

      <ChartSection
        title="Allocation by benchmark bucket"
        subtitle="Grouped by the sector proxy used in the Portfolio Note (not just ticker weight)."
      >
        {charts.allocationByBenchmark?.length > 0 ? (
          <AllocationPie
            slices={charts.allocationByBenchmark.map((b) => ({
              symbol: b.label,
              pct: b.pct,
              detail: b.symbols?.join(', '),
            }))}
          />
        ) : (
          <AllocationPie slices={charts.allocation} />
        )}
      </ChartSection>

      <ChartSection
        title="5-day trailing return"
        subtitle="Price change from earliest snapshot in the last ~5 days — same metric cited in Portfolio Note movers."
      >
        <HorizontalBars
          items={charts.trailingReturns?.filter((t) => t.dataAvailable) || []}
          valueKey="trailingPct"
          labelKey="symbol"
        />
        {(charts.trailingReturns || []).some((t) => !t.dataAvailable) && (
          <p className="text-[10px] mt-2" style={{ color: 'var(--color-muted)' }}>
            Some holdings lack snapshot history — trailing data fills in after a few polling days.
          </p>
        )}
      </ChartSection>

      <ChartSection
        title="Total return vs cost"
        subtitle="Unrealised gain/loss since purchase (not today&apos;s move)."
      >
        <HorizontalBars items={charts.holdingPnl} valueKey="pnlPct" />
      </ChartSection>

      {PortfolioPnlBarChart && (
        <ChartSection
          title="P&L by stock"
          subtitle="Open positions: unrealised. Closed: realised from sell trades."
        >
          <PortfolioPnlBarChart positions={positions} realized={realized} />
        </ChartSection>
      )}

      {symbolKeys.length > 0 && (
        <ChartSection
          title="Price by holding"
          subtitle={days === 1 ? 'Intraday price AUD (quantity changes do not affect this line).' : `Price history over ${days} days.`}
        >
          <div className="space-y-6">
            {symbolKeys.map((key) => {
              const pts = charts.bySymbol[key];
              if (!pts?.length) return null;
              if (days === 1 && pts.length < 2) return null;
              return (
                <div key={key}>
                  <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>{key}</p>
                  <MultiLineChart
                    points={pts}
                    series={[{ key: 'priceAud', label: 'Price AUD' }]}
                    height={140}
                  />
                </div>
              );
            })}
          </div>
        </ChartSection>
      )}

      {/* ── Calendar & patterns ── */}
      <p className="text-xs font-semibold uppercase tracking-wide mb-2 mt-2" style={{ color: 'var(--color-primary)' }}>Calendar & patterns</p>

      <ChartSection
        title="Upcoming earnings"
        subtitle="US symbols only — Finnhub calendar for the next 90 days."
      >
        <EarningsTimeline events={charts.earningsTimeline} />
      </ChartSection>

      <ChartSection
        title="Move heatmap"
        subtitle="Daily price moves from snapshots. Amber outline = unexplained material move logged in observations."
      >
        <MoveHeatmap heatmap={charts.moveHeatmap} />
        {(pattern.recurringUnexplained?.length > 0 || pattern.laggingSymbols?.length > 0) && (
          <div className="mt-3 text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
            {pattern.laggingSymbols?.length > 0 && (
              <p>Lagging cluster today: {pattern.laggingSymbols.join(', ')}</p>
            )}
            {pattern.recurringUnexplained?.map((r) => (
              <p key={r.symbol}>
                {r.symbol}: {r.count} unexplained material moves in recent observations
              </p>
            ))}
          </div>
        )}
      </ChartSection>

      {/* ── Metals ── */}
      {charts.metals?.hasHoldings && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2 mt-2" style={{ color: 'var(--color-primary)' }}>Metals</p>

          <ChartSection
            title="Gold book day move"
            subtitle="Physical holdings vs XAU/AUD spot — parallel to the METALS block in the Portfolio Note."
          >
            {charts.metals.portfolioMove ? (
              <div className="flex flex-wrap gap-4 text-sm">
                <span style={{ color: charts.metals.portfolioMove.changePct >= 0 ? '#16a34a' : '#dc2626' }}>
                  Book {charts.metals.portfolioMove.changePct >= 0 ? '+' : ''}{charts.metals.portfolioMove.changePct}%
                </span>
                {charts.metals.spotDayChangePct != null && (
                  <span style={{ color: 'var(--color-muted)' }}>
                    Spot {charts.metals.spotDayChangePct >= 0 ? '+' : ''}{charts.metals.spotDayChangePct}%
                  </span>
                )}
                {charts.metals.unrealizedPnlPct != null && (
                  <span style={{ color: 'var(--color-muted)' }}>
                    Unrealised {charts.metals.unrealizedPnlPct >= 0 ? '+' : ''}{charts.metals.unrealizedPnlPct}% vs cost
                  </span>
                )}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Spot quote unavailable.</p>
            )}
            {charts.metals.spotHistory?.length > 1 && (
              <div className="mt-4">
                <MultiLineChart
                  points={charts.metals.spotHistory}
                  series={[{ key: 'audPerOz', label: 'XAU/AUD per oz' }]}
                  height={140}
                />
              </div>
            )}
          </ChartSection>

          {charts.metals.alertRows?.length > 0 && (
            <ChartSection title="Metals drawdown" subtitle="Same peak/cost alert logic as shares.">
              <DrawdownBars rows={charts.metals.alertRows} peakTrigger={-10} costTrigger={-4} />
            </ChartSection>
          )}
        </>
      )}
    </>
  );
}
