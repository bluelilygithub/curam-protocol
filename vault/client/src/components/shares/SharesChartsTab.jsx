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

// Charts are grouped into tabs. Each chart is tagged as either following the range buttons or
// being a current snapshot, so it's clear why some charts don't move when the range changes.
const GROUPS = [
  { id: 'movement', label: 'Movement', tip: 'How your holdings moved against the market — follows the range.' },
  { id: 'performance', label: 'Performance', tip: 'Value, relative performance and price history over the range.' },
  { id: 'holdings', label: 'Holdings', tip: 'What you hold and how each holding stands now (current snapshot).' },
  { id: 'calendar', label: 'Calendar & patterns', tip: 'Upcoming earnings and the daily move heatmap.' },
  { id: 'metals', label: 'Metals', tip: 'Gold holdings and spot price.' },
  { id: 'dividends', label: 'Dividends', tip: 'Dividend income by holding and by month.' },
];

function RangeTag({ follows, label }) {
  return (
    <span
      className="ml-2 align-middle text-[10px] font-normal px-1.5 py-0.5 rounded border"
      style={{
        borderColor: follows ? 'var(--color-primary)' : 'var(--color-border)',
        color: follows ? 'var(--color-primary)' : 'var(--color-muted)',
      }}
    >
      {label || (follows ? 'Follows range' : 'Current snapshot')}
    </span>
  );
}

function ChartSection({ title, subtitle, children, tag }) {
  return (
    <section
      className="mb-6 p-4 rounded-lg border"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <h2 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        {title}
        {tag}
      </h2>
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
  dividendSummary,
}) {
  const [showCash, setShowCash] = useState(false);
  const [group, setGroup] = useState('movement');

  if (loading && !charts) {
    return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading charts…</p>;
  }
  if (!charts) {
    return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Charts unavailable.</p>;
  }

  const symbolKeys = Object.keys(charts.bySymbol || {});
  const pattern = charts.patternSummary || {};
  const thresholds = pattern.alertThresholds || {};
  const today = days === 1;
  const rangeLabel = DAY_OPTIONS.find((o) => o.value === days)?.label || `${days}d`;
  const bp = charts.benchmarksPeriod;
  const historyDays = charts.history?.availableDays || 0;
  const thinHistory = !today && historyDays > 0 && historyDays < days;

  const visibleGroups = GROUPS.filter((g) => {
    if (g.id === 'metals') return !!charts.metals?.hasHoldings;
    if (g.id === 'dividends') return dividendSummary?.totalCount > 0;
    return true;
  });
  const activeGroup = visibleGroups.some((g) => g.id === group) ? group : 'movement';

  const movement = (
    <>
      <ChartSection
        title={today ? 'Portfolio vs benchmarks' : `Portfolio vs benchmarks — ${rangeLabel}`}
        tag={<RangeTag follows />}
        subtitle={today
          ? "Holdings day move (cash excluded) compared to Nasdaq, SOX, and ASX 200 ETF proxies — same basis as the Portfolio Note header. Nasdaq and SOX are USD-priced ETFs; your holdings are in AUD."
          : bp?.available
            ? `Return over ${bp.from} to ${bp.to} (${bp.observationCount} daily Portfolio Notes), holdings only, cash excluded. Nasdaq and SOX are USD-priced ETF proxies; your holdings are in AUD.`
            : 'Not enough daily Portfolio Notes recorded for this range yet.'}
      >
        <BenchmarkBarChart items={today ? charts.benchmarksToday : (bp?.items || [])} />
      </ChartSection>

      <ChartSection
        title={today ? 'Day movers & beat/lag' : `Movers & beat/lag — ${rangeLabel}`}
        tag={<RangeTag follows />}
        subtitle={today
          ? 'Per-holding day % with divergence vs assigned sector benchmark (SOX for semis, ASX 200 for ASX, Nasdaq otherwise).'
          : `Each holding's move over the last ${days} days (from its first stored price in that window) against its sector index over the same range.`}
      >
        {today
          ? <DayMoversChart movers={charts.dayMovers} />
          : <DayMoversChart movers={charts.periodMovers} valueKey="periodChangePct" periodLabel={rangeLabel} />}
      </ChartSection>

      <ChartSection
        title="Drawdown & alert status"
        tag={<RangeTag />}
        subtitle={`% off high-water mark since purchase. Triggers: ${thresholds.peakOffPct ?? 10}% off peak · ${thresholds.avgCostOffPct ?? 4}% off avg cost.`}
      >
        <DrawdownBars
          rows={charts.alertRows}
          peakTrigger={-(thresholds.peakOffPct ?? 10)}
          costTrigger={-(thresholds.avgCostOffPct ?? 4)}
        />
      </ChartSection>
    </>
  );

  const trailingItems = charts.trailingReturns?.filter((t) => t.dataAvailable) || [];
  const trailingDays = charts.trailingWindowDays ?? 5;

  const performance = (
    <>
      {charts.normalizedPerformance?.length > 1 ? (
        <ChartSection
          title="Relative performance (rebased to 100)"
          tag={<RangeTag follows />}
          subtitle="Cumulative daily returns from stored Portfolio Note observations — portfolio vs index proxies (Nasdaq and SOX are USD-priced)."
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
      ) : (
        <ChartSection title="Relative performance (rebased to 100)" tag={<RangeTag follows />}>
          <p className="text-xs py-4 text-center" style={{ color: 'var(--color-muted)' }}>
            Needs at least two daily Portfolio Notes in this range — run the Portfolio Note for a few days.
          </p>
        </ChartSection>
      )}

      <ChartSection
        title="Portfolio value"
        tag={<RangeTag follows />}
        subtitle={today ? 'Intraday snapshots from quote polls and manual refresh.' : `Daily snapshots over the last ${days} days.`}
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

      <ChartSection
        title={`${trailingDays}-day trailing return`}
        tag={today ? <RangeTag label="Fixed 5 days" /> : <RangeTag follows />}
        subtitle={today
          ? 'Price change from the earliest snapshot in the last ~5 days — same metric cited in Portfolio Note movers. Pick 7d, 30d or 90d to widen it.'
          : `Price change over the last ${days} days, from each holding's first stored price in that window.`}
      >
        <HorizontalBars items={trailingItems} valueKey="trailingPct" labelKey="symbol" />
        {(charts.trailingReturns || []).some((t) => !t.dataAvailable) && (
          <p className="text-[10px] mt-2" style={{ color: 'var(--color-muted)' }}>
            Some holdings have no snapshot in this window — data fills in as polls accumulate.
          </p>
        )}
      </ChartSection>

      {symbolKeys.length > 0 && (
        <ChartSection
          title="Price by holding"
          tag={<RangeTag follows />}
          subtitle={today ? 'Intraday price AUD (quantity changes do not affect this line).' : `Price history over ${days} days.`}
        >
          <div className="space-y-6">
            {symbolKeys.map((key) => {
              const pts = charts.bySymbol[key];
              if (!pts?.length) return null;
              if (today && pts.length < 2) return null;
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
    </>
  );

  const holdings = (
    <>
      <ChartSection
        title="Allocation by benchmark bucket"
        tag={<RangeTag />}
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
        title="Total return vs cost"
        tag={<RangeTag />}
        subtitle="Unrealised gain/loss since purchase (not today&apos;s move)."
      >
        <HorizontalBars items={charts.holdingPnl} valueKey="pnlPct" />
      </ChartSection>

      {PortfolioPnlBarChart && (
        <ChartSection
          title="P&L by stock"
          tag={<RangeTag />}
          subtitle="Open positions: unrealised. Closed: realised from sell trades."
        >
          <PortfolioPnlBarChart positions={positions} realized={realized} />
        </ChartSection>
      )}
    </>
  );

  const calendar = (
    <>
      <ChartSection
        title="Upcoming earnings"
        tag={<RangeTag label="Next 90 days" />}
        subtitle="US symbols only — Finnhub calendar for the next 90 days."
      >
        <EarningsTimeline events={charts.earningsTimeline} />
      </ChartSection>

      <ChartSection
        title="Move heatmap"
        tag={<RangeTag follows label={`Follows range · max 14 days`} />}
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
    </>
  );

  const metals = charts.metals?.hasHoldings ? (
    <>
      <ChartSection
        title="Gold book day move"
        tag={<RangeTag />}
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
      </ChartSection>

      <ChartSection
        title="XAU/AUD spot history"
        tag={today ? <RangeTag label="Needs 7d or more" /> : <RangeTag follows />}
        subtitle={today ? 'Pick 7d, 30d or 90d to see the spot price history.' : `Gold spot over the last ${days} days.`}
      >
        {charts.metals.spotHistory?.length > 1 ? (
          <MultiLineChart
            points={charts.metals.spotHistory}
            series={[{ key: 'audPerOz', label: 'XAU/AUD per oz' }]}
            height={140}
          />
        ) : (
          <p className="text-xs py-4 text-center" style={{ color: 'var(--color-muted)' }}>
            {today ? 'Choose a longer range.' : 'Not enough spot history recorded for this range.'}
          </p>
        )}
      </ChartSection>

      {charts.metals.alertRows?.length > 0 && (
        <ChartSection title="Metals drawdown" tag={<RangeTag />} subtitle="Same peak/cost alert logic as shares.">
          <DrawdownBars rows={charts.metals.alertRows} peakTrigger={-10} costTrigger={-4} />
        </ChartSection>
      )}
    </>
  ) : null;

  const dividends = dividendSummary?.totalCount > 0 ? (
    <>
      <ChartSection
        title="By holding"
        tag={<RangeTag label="All time" />}
        subtitle={`Gross (before withholding tax) — all-time total across ${dividendSummary.totalCount} payment(s). FY to date (from ${dividendSummary.fyStart}) shown as the Portfolio tab stat tile.`}
      >
        <HorizontalBars items={dividendSummary.bySymbol} valueKey="totalAud" labelKey="symbol" format="aud" />
      </ChartSection>
      {dividendSummary.monthly.length > 1 && (
        <ChartSection title="By month" tag={<RangeTag label="All time" />} subtitle="All-time, month received.">
          <HorizontalBars items={dividendSummary.monthly} valueKey="totalAud" labelKey="month" format="aud" />
        </ChartSection>
      )}
    </>
  ) : null;

  const panels = { movement, performance, holdings, calendar, metals, dividends };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Insight charts aligned with the daily Portfolio Note. The range applies to charts tagged “Follows range”; the rest are current snapshots.
        </p>
        <div className="flex items-center gap-2">
          {loading && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Updating…</span>}
          <div className="flex gap-1 p-0.5 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            {DAY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onDaysChange(opt.value)}
                disabled={loading}
                className="px-3 py-1 rounded-md text-xs font-medium transition-opacity hover:opacity-70 disabled:opacity-60"
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
      </div>

      {thinHistory && (
        <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
          Only {historyDays} day{historyDays === 1 ? '' : 's'} of history recorded so far, so {rangeLabel} shows everything available.
        </p>
      )}

      <div className="flex gap-1 mb-4 overflow-x-auto border-b" style={{ borderColor: 'var(--color-border)' }}>
        {visibleGroups.map((g) => {
          const active = activeGroup === g.id;
          return (
            <button
              key={g.id}
              type="button"
              title={g.tip}
              onClick={() => setGroup(g.id)}
              className="flex-shrink-0 text-sm px-3 py-2 border-b-2 transition-opacity duration-200 hover:opacity-70"
              style={{
                color: active ? 'var(--color-primary)' : 'var(--color-muted)',
                borderBottomColor: active ? 'var(--color-primary)' : 'transparent',
                fontWeight: active ? 600 : 400,
              }}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 200ms', pointerEvents: loading ? 'none' : 'auto' }}>
        {panels[activeGroup]}
      </div>
    </>
  );
}
