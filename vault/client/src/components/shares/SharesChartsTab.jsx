import React, { useState } from 'react';
import MultiLineChart from './MultiLineChart';
import BenchmarkBarChart from './BenchmarkBarChart';
import DayMoversChart from './DayMoversChart';
import DrawdownBars from './DrawdownBars';
import MoveHeatmap from './MoveHeatmap';
import EarningsTimeline from './EarningsTimeline';
import AllocationPie from './AllocationPie';
import HorizontalBars from './HorizontalBars';
import ChartCard from '../charts/ChartCard';
import RangeToggle from '../charts/RangeToggle';
import SegmentedToggle from '../charts/SegmentedToggle';
import Skeleton from '../Skeleton';
import EmptyState from '../EmptyState';
import Tooltip from '../Tooltip';

// value = the ?range= key the API takes. 'fy' is the Australian financial year to date (from 1 July);
// 'all' is everything recorded so far.
const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '12m', label: '12 months' },
  { value: 'fy', label: 'Financial year' },
  { value: 'all', label: 'All time' },
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

// Cards the range drives carry no badge; the rest say what window they show instead (Current snapshot, Next 90 days, ...).
const SNAPSHOT = 'Current snapshot';
// One panel of cards: one column, two from xl (DESIGN.md "Wide screens").
const Grid = ({ children }) => <div className="flex flex-col gap-6 xl:grid xl:grid-cols-2 xl:items-start">{children}</div>;
const Note = ({ children }) => <p className="text-xs py-4 text-center" style={{ color: 'var(--color-muted)' }}>{children}</p>;

export default function SharesChartsTab({
  charts,
  range,
  onRangeChange,
  loading,
  positions = [],
  realized = [],
  PortfolioPnlBarChart,
  dividendSummary,
}) {
  const [showCash, setShowCash] = useState(false);
  const [group, setGroup] = useState('movement');

  if (loading && !charts) {
    // Mirrors the panel: a header row, then cards in two columns.
    return (
      <div className="max-w-[1700px] space-y-6" aria-busy="true">
        <Skeleton className="h-10" label="Loading charts" />
        <div className="flex flex-col gap-6 xl:grid xl:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border p-6 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <Skeleton className="h-5" label="Loading chart" />
              <Skeleton className="h-40" label="Loading chart" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!charts) {
    return (
      <EmptyState
        icon="line-chart"
        title="Charts are not available"
        body="Nothing came back for the charts. Press Refresh quotes in the menu, then open Charts again."
      />
    );
  }

  const symbolKeys = Object.keys(charts.bySymbol || {});
  const pattern = charts.patternSummary || {};
  const thresholds = pattern.alertThresholds || {};
  const today = range === 'today';
  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)?.label || range;
  // "the last 30 days", "the current financial year (since 1 Jul 2026)", "all recorded history (since …)" —
  // supplied by the server so the wording always matches the window it actually used.
  const phrase = charts.range?.phrase || 'the selected range';
  const bp = charts.benchmarksPeriod;
  const historyDays = charts.history?.availableDays || 0;
  // All time is by definition everything there is, so every other range can come up short.
  const thinHistory = !today && range !== 'all' && historyDays > 0 && historyDays < (charts.range?.days || 0);

  const visibleGroups = GROUPS.filter((g) => {
    if (g.id === 'metals') return !!charts.metals?.hasHoldings;
    if (g.id === 'dividends') return dividendSummary?.totalCount > 0;
    return true;
  });
  const activeGroup = visibleGroups.some((g) => g.id === group) ? group : 'movement';

  const movement = (
    <Grid>
      <ChartCard
        span
        title={today ? 'Portfolio vs benchmarks' : `Portfolio vs benchmarks, ${rangeLabel}`}
        subtitle={today ? 'Your holdings today against the market indexes.' : bp?.available ? `${bp.from} to ${bp.to}, holdings only.` : 'Not enough daily Portfolio Notes for this range yet.'}
        info={today
          ? "Holdings day move (cash excluded) compared to Nasdaq, SOX, and ASX 200 ETF proxies — same basis as the Portfolio Note header. The dollar figure is your holdings' move in AUD. Nasdaq and SOX are USD-priced ETFs; your holdings are in AUD."
          : bp?.available
            ? `Return over ${bp.from} to ${bp.to} (${bp.observationCount} daily Portfolio Notes), holdings only, cash excluded. The dollar figure is the price change on the units you hold today${bp.changeAudCoverage && bp.changeAudCoverage.included < bp.changeAudCoverage.total ? ` (${bp.changeAudCoverage.included} of ${bp.changeAudCoverage.total} holdings have a stored price in this range)` : ''} — buys and sells inside the range aren't adjusted for. Nasdaq and SOX are USD-priced ETF proxies; your holdings are in AUD.`
            : 'Not enough daily Portfolio Notes recorded for this range yet.'}
      >
        <BenchmarkBarChart items={today ? charts.benchmarksToday : (bp?.items || [])} />
      </ChartCard>

      <ChartCard
        title={today ? 'Day movers & beat/lag' : `Movers & beat/lag, ${rangeLabel}`}
        subtitle={today ? 'Each holding today against its sector index.' : `Each holding over ${phrase} against its sector index.`}
        info={today
          ? 'Per-holding day % and day $ (AUD) with divergence vs assigned sector benchmark (SOX for semis, ASX 200 for ASX, Nasdaq otherwise).'
          : `Each holding's move over ${phrase} (from its first stored price in that window) against its sector index over the same range. The dollar figure is the price change on the units you hold today.`}
      >
        {today
          ? <DayMoversChart movers={charts.dayMovers} />
          : <DayMoversChart movers={charts.periodMovers} valueKey="periodChangePct" amountKey="changeAud" periodLabel={rangeLabel} />}
      </ChartCard>

      <ChartCard
        title="Drawdown & alert status"
        badge={SNAPSHOT}
        subtitle={`Triggers: ${thresholds.peakOffPct ?? 10}% off peak, ${thresholds.avgCostOffPct ?? 4}% off average cost.`}
        info={`% off high-water mark since purchase. Triggers: ${thresholds.peakOffPct ?? 10}% off peak · ${thresholds.avgCostOffPct ?? 4}% off avg cost.`}
      >
        <DrawdownBars
          rows={charts.alertRows}
          peakTrigger={-(thresholds.peakOffPct ?? 10)}
          costTrigger={-(thresholds.avgCostOffPct ?? 4)}
        />
      </ChartCard>
    </Grid>
  );

  const trailingItems = charts.trailingReturns?.filter((t) => t.dataAvailable) || [];
  const trailingDays = charts.trailingWindowDays ?? 5;
  const lastSnap = charts.portfolioSnapshots?.[charts.portfolioSnapshots.length - 1];

  const performance = (
    <Grid>
      <ChartCard
        title="Portfolio value"
        subtitle={today ? 'Intraday snapshots.' : `Daily snapshots over ${phrase}.`}
        info={today ? 'Intraday snapshots from quote polls and manual refresh.' : `Daily snapshots over ${phrase}.`}
        actions={(
          <SegmentedToggle
            label="Cash line"
            size="xs"
            value={showCash ? 'cash' : 'plain'}
            onChange={(v) => setShowCash(v === 'cash')}
            options={[
              { value: 'plain', label: 'Holdings + cash', tip: 'Total value and holdings value.' },
              { value: 'cash', label: 'Show cash line', tip: 'Add a line for cash.' },
            ]}
          />
        )}
      >
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
        {lastSnap?.pnlPct != null && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Book unrealised P&L: {lastSnap.pnlPct >= 0 ? '+' : '−'}{Math.abs(lastSnap.pnlPct).toFixed(2)}% vs cost basis
          </p>
        )}
      </ChartCard>

      <ChartCard
        title="Relative performance (rebased to 100)"
        subtitle="Your holdings against the index proxies."
        info="Cumulative daily returns from stored Portfolio Note observations — portfolio vs index proxies (Nasdaq and SOX are USD-priced)."
      >
        {charts.normalizedPerformance?.length > 1 ? (
          <MultiLineChart
            points={charts.normalizedPerformance}
            dateKey="date"
            series={[
              { key: 'portfolio', label: 'Your holdings', color: 'var(--chart-1)' },
              { key: 'nasdaq', label: 'Nasdaq', color: 'var(--chart-2)' },
              { key: 'sox', label: 'SOX', color: 'var(--chart-3)' },
              { key: 'asx', label: 'ASX 200', color: 'var(--chart-4)' },
            ]}
            emptyMessage="Run Portfolio Note for a few days to build relative performance history."
          />
        ) : (
          <Note>Needs at least two daily Portfolio Notes in this range — run the Portfolio Note for a few days.</Note>
        )}
      </ChartCard>

      <ChartCard
        title={today ? `${trailingDays}-day trailing return` : `Trailing return, ${rangeLabel}`}
        badge={today ? `Last ${trailingDays} days` : undefined}
        subtitle={today ? 'Price change over the last few days.' : `Price change over ${phrase}.`}
        info={today
          ? 'Price change from the earliest snapshot in the last ~5 days — same metric cited in Portfolio Note movers. Pick a longer range to widen it.'
          : `Price change over ${phrase}, from each holding's first stored price in that window.`}
      >
        <HorizontalBars items={trailingItems} valueKey="trailingPct" labelKey="symbol" />
        {(charts.trailingReturns || []).some((t) => !t.dataAvailable) && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Some holdings have no snapshot in this window — data fills in as polls accumulate.
          </p>
        )}
      </ChartCard>

      {symbolKeys.length > 0 && (
        <ChartCard
          span
          title="Price by holding"
          subtitle={today ? 'Intraday price in AUD.' : `Price in AUD over ${phrase}${charts.range?.days > 90 ? ' (one point a day)' : ''}.`}
          info={today ? 'Intraday price AUD (quantity changes do not affect this line).' : `Price history over ${phrase}${charts.range?.days > 90 ? ' (one point a day)' : ''}.`}
        >
          <div className="grid gap-6 xl:grid-cols-2">
            {symbolKeys.map((key) => {
              const pts = charts.bySymbol[key];
              if (!pts?.length) return null;
              if (today && pts.length < 2) return null;
              return (
                <div key={key} className="min-w-0">
                  <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>{key}</p>
                  <MultiLineChart points={pts} series={[{ key: 'priceAud', label: 'Price AUD' }]} height={140} />
                </div>
              );
            })}
          </div>
        </ChartCard>
      )}
    </Grid>
  );

  const holdings = (
    <Grid>
      <ChartCard
        title="Allocation by benchmark bucket"
        badge={SNAPSHOT}
        subtitle="Grouped by the sector index each holding is compared with."
        info="Grouped by the sector proxy used in the Portfolio Note (not just ticker weight)."
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
      </ChartCard>

      <ChartCard
        title="Total return vs cost"
        badge={SNAPSHOT}
        subtitle="Unrealised gain or loss since purchase."
        info="Unrealised gain/loss since purchase (not today's move)."
      >
        <HorizontalBars items={charts.holdingPnl} valueKey="pnlPct" />
      </ChartCard>

      {PortfolioPnlBarChart && (
        <ChartCard
          span
          title="P&L by stock"
          badge={SNAPSHOT}
          subtitle="Open positions unrealised, closed positions realised."
          info="Open positions: unrealised. Closed: realised from sell trades."
        >
          <PortfolioPnlBarChart positions={positions} realized={realized} />
        </ChartCard>
      )}
    </Grid>
  );

  const calendar = (
    <Grid>
      <ChartCard
        title="Upcoming earnings"
        badge="Next 90 days"
        subtitle="US holdings only."
        info="US symbols only — Finnhub calendar for the next 90 days."
      >
        <EarningsTimeline events={charts.earningsTimeline} />
      </ChartCard>

      <ChartCard
        title="Move heatmap"
        badge="Max 14 days"
        subtitle="Daily price moves from snapshots."
        info="Daily price moves from snapshots. Amber outline = unexplained material move logged in observations. It follows the range, up to 14 days."
      >
        <MoveHeatmap heatmap={charts.moveHeatmap} />
        {(pattern.recurringUnexplained?.length > 0 || pattern.laggingSymbols?.length > 0) && (
          <div className="text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
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
      </ChartCard>
    </Grid>
  );

  const signed = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n)}%`;
  const metals = charts.metals?.hasHoldings ? (
    <Grid>
      <ChartCard
        title="Gold book day move"
        badge={SNAPSHOT}
        subtitle="Physical holdings against XAU/AUD spot."
        info="Physical holdings vs XAU/AUD spot — parallel to the METALS block in the Portfolio Note."
      >
        {charts.metals.portfolioMove ? (
          <div className="flex flex-wrap gap-4 text-sm">
            <span style={{ color: charts.metals.portfolioMove.changePct >= 0 ? 'var(--chart-gain)' : 'var(--chart-loss)' }}>
              Book {signed(charts.metals.portfolioMove.changePct)}
            </span>
            {charts.metals.spotDayChangePct != null && (
              <span style={{ color: 'var(--color-muted)' }}>Spot {signed(charts.metals.spotDayChangePct)}</span>
            )}
            {charts.metals.unrealizedPnlPct != null && (
              <span style={{ color: 'var(--color-muted)' }}>Unrealised {signed(charts.metals.unrealizedPnlPct)} vs cost</span>
            )}
          </div>
        ) : (
          <Note>Spot quote unavailable.</Note>
        )}
      </ChartCard>

      <ChartCard
        title="XAU/AUD spot history"
        subtitle={today ? 'Pick 7d or longer to see the history.' : `Gold spot over ${phrase}.`}
      >
        {charts.metals.spotHistory?.length > 1 ? (
          <MultiLineChart points={charts.metals.spotHistory} series={[{ key: 'audPerOz', label: 'XAU/AUD per oz' }]} height={140} />
        ) : (
          <Note>{today ? 'Choose a longer range.' : 'Not enough spot history recorded for this range.'}</Note>
        )}
      </ChartCard>

      {charts.metals.alertRows?.length > 0 && (
        <ChartCard title="Metals drawdown" badge={SNAPSHOT} subtitle="Same peak and cost alerts as shares.">
          <DrawdownBars
            rows={charts.metals.alertRows}
            peakTrigger={-(thresholds.peakOffPct ?? 10)}
            costTrigger={-(thresholds.avgCostOffPct ?? 4)}
          />
        </ChartCard>
      )}
    </Grid>
  ) : null;

  const dividends = dividendSummary?.totalCount > 0 ? (
    <Grid>
      <ChartCard
        title="By holding"
        badge="All time"
        subtitle={`Gross, across ${dividendSummary.totalCount} payment${dividendSummary.totalCount === 1 ? '' : 's'}.`}
        info={`Gross (before withholding tax) — all-time total across ${dividendSummary.totalCount} payment(s). FY to date (from ${dividendSummary.fyStart}) shown as the Portfolio tab stat tile.`}
      >
        <HorizontalBars items={dividendSummary.bySymbol} valueKey="totalAud" labelKey="symbol" format="aud" />
      </ChartCard>
      {dividendSummary.monthly.length > 1 && (
        <ChartCard title="By month" badge="All time" subtitle="By the month received.">
          <HorizontalBars items={dividendSummary.monthly} valueKey="totalAud" labelKey="month" format="aud" />
        </ChartCard>
      )}
    </Grid>
  ) : null;

  const panels = { movement, performance, holdings, calendar, metals, dividends };

  return (
    <div className="max-w-[1700px]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Cards without a tag follow the range.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {loading && <span className="text-xs" role="status" style={{ color: 'var(--color-muted)' }}>Updating…</span>}
          <RangeToggle options={RANGE_OPTIONS} value={range} onChange={onRangeChange} disabled={loading} />
        </div>
      </div>

      {thinHistory && (
        <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
          Only {historyDays} day{historyDays === 1 ? '' : 's'} of history recorded so far, so {rangeLabel} shows everything available.
        </p>
      )}

      <div className="flex gap-1 mb-6 overflow-x-auto border-b" style={{ borderColor: 'var(--color-border)' }}>
        {visibleGroups.map((g) => {
          const active = activeGroup === g.id;
          return (
            <Tooltip key={g.id} text={g.tip}>
              <button
                type="button"
                onClick={() => setGroup(g.id)}
                aria-pressed={active}
                className="flex-shrink-0 text-sm px-3 py-2 border-b-2 transition-opacity duration-200 hover:opacity-70"
                style={{
                  color: active ? 'var(--color-primary)' : 'var(--color-muted)',
                  borderBottomColor: active ? 'var(--color-primary)' : 'transparent',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {g.label}
              </button>
            </Tooltip>
          );
        })}
      </div>

      <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 200ms', pointerEvents: loading ? 'none' : 'auto' }}>
        {panels[activeGroup]}
      </div>
    </div>
  );
}
