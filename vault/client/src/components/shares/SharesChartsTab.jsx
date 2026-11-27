import React, { useState } from 'react';
import MultiLineChart from './MultiLineChart';
import MoveHeatmap from './MoveHeatmap';
import EarningsTimeline from './EarningsTimeline';
import AllocationPie from './AllocationPie';
import HorizontalBars from './HorizontalBars';
import ChartCard from '../charts/ChartCard';
import StatTile from '../charts/StatTile';
import DivergingBars from '../charts/DivergingBars';
import ThresholdBars from '../charts/ThresholdBars';
import Sparkline from '../charts/Sparkline';
import PortfolioValueChart from './PortfolioValueChart';
import RelativePerformanceChart from './RelativePerformanceChart';
import { fmtPct, fmtAud, fmtPts } from '../charts/chartFormat.mjs';
import { changeOverRange, cardsForRange } from '../charts/chartMath.mjs';
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
  const [cashView, setCashView] = useState('total'); // Portfolio value: 'total' or 'split' (holdings + dashed cash)
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

  // ---- Movement ----
  const benchItems = (today ? charts.benchmarksToday : (bp?.items || [])).filter((it) => it.pct != null && Number.isFinite(Number(it.pct)));
  const mine = benchItems.find((it) => it.kind === 'portfolio');
  const indexes = benchItems.filter((it) => it.kind !== 'portfolio');
  const movers = (today ? charts.dayMovers : charts.periodMovers) || [];
  const moverKey = today ? 'dayChangePct' : 'periodChangePct';
  const moverAmount = today ? 'dayChangeAud' : 'changeAud';
  const moverItems = movers.filter((m) => m[moverKey] != null).slice(0, 12).map((m) => {
    const pct = Number(m[moverKey]);
    const tick = m.sectorBenchmarkPct ?? (m.vsSectorPct != null ? pct - Number(m.vsSectorPct) : null);
    const rel = m.relativeToSector;
    return {
      key: m.key || `${m.symbol}:${m.exchange}`,
      label: m.symbol,
      sublabel: m.sectorBenchmark,
      value: pct,
      tick,
      tickLabel: tick != null ? `${m.sectorBenchmark} ${fmtPct(tick)}` : undefined,
      valueText: fmtPct(pct),
      amountText: m[moverAmount] != null ? fmtAud(m[moverAmount]) : null,
      note: m.vsSectorPct == null || rel === 'unknown' ? null : `${fmtPts(m.vsSectorPct)} vs ${m.sectorBenchmark}`,
      noteTone: rel === 'beat' ? 'gain' : rel === 'lagged' ? 'loss' : undefined,
    };
  });
  const peakTrigger = thresholds.peakOffPct ?? 10;
  const costTrigger = thresholds.avgCostOffPct ?? 4;
  // Status comes from the server's flag (portfolioAlerts.js), so it matches the alert emails; it counts the cost trigger too.
  const drawdownItems = (rows) => [...(rows || [])]
    .sort((a, b) => (a.pctOffPeak ?? 0) - (b.pctOffPeak ?? 0))
    .map((r) => {
      const peak = Number(r.pctOffPeak);
      const cost = Number(r.pctOffAvgCost);
      return {
        key: r.key || `${r.label}:${r.exchange || ''}`,
        label: r.label,
        size: Number.isFinite(peak) ? Math.max(0, -peak) : 0,
        status: r.flag === '🔴' ? 'past' : r.flag === '⚠️' ? 'near' : 'within',
        valueText: Number.isFinite(peak) ? `${fmtPct(peak)} off peak` : '—',
        subText: Number.isFinite(cost) ? `${fmtPct(cost)} vs cost` : null,
      };
    });
  const drawdownLabels = { within: 'Within limits', near: 'Near a trigger', past: 'Trigger hit' };
  const trailingItems = (charts.trailingReturns || []).filter((t) => t.dataAvailable).map((t) => ({
    key: `${t.symbol}:${t.exchange || ''}`, label: t.symbol, value: Number(t.trailingPct), valueText: fmtPct(t.trailingPct),
    amountText: t.changeAud != null ? fmtAud(t.changeAud) : null,
  }));
  const trailingDays = charts.trailingWindowDays ?? 5;
  const showTrailing = cardsForRange(range).trailingReturn;

  const movement = (
    <Grid>
      <ChartCard
        span
        title={today ? 'Portfolio vs benchmarks' : `Portfolio vs benchmarks, ${rangeLabel}`}
        subtitle={today ? 'Your holdings today against the market indexes.' : bp?.available ? `${bp.from} to ${bp.to}, holdings only.` : 'Not enough daily Portfolio Notes for this range yet.'}
        info={today
          ? "Holdings day move (cash excluded) compared to Nasdaq, SOX, and ASX 200 ETF proxies — same basis as the Portfolio Note header. The dollar figure is your holdings' move in AUD. Nasdaq and SOX are USD-priced ETFs; your holdings are in AUD."
          : bp?.available
            ? `Return over ${bp.from} to ${bp.to} (${bp.observationCount} daily Portfolio Notes), holdings only, cash excluded. The dollar figure is the price change on the units you hold today${bp.changeAudCoverage && bp.changeAudCoverage.included < bp.changeAudCoverage.total ? ` (${bp.changeAudCoverage.included} of ${bp.changeAudCoverage.total} holdings have a stored price in this range)` : ''} — buys and sells inside the range aren't adjusted for. Nasdaq and SOX are USD-priced ETF proxies; your holdings are in AUD. An index with no recorded move is left out.`
            : 'Not enough daily Portfolio Notes recorded for this range yet.'}
      >
        {benchItems.length ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
            {mine && <StatTile primary label="Your holdings" value={fmtPct(mine.pct, 2)} sub={mine.changeAud != null ? fmtAud(mine.changeAud) : 'Holdings only, cash excluded'} />}
            {indexes.map((it) => {
              const diff = mine ? Number(mine.pct) - Number(it.pct) : null;
              return (
                <StatTile
                  key={it.label}
                  label={it.label}
                  value={fmtPct(it.pct, 2)}
                  sub={diff == null ? null : Math.abs(diff) < 0.05 ? 'Level with it' : diff > 0 ? `You beat it by ${Math.abs(diff).toFixed(1)} pts` : `You lagged by ${Math.abs(diff).toFixed(1)} pts`}
                  tone={diff == null || Math.abs(diff) < 0.05 ? undefined : diff > 0 ? 'gain' : 'loss'}
                />
              );
            })}
          </div>
        ) : (
          <Note>Benchmark data unavailable — check quote API keys, or pick a range with daily Portfolio Notes.</Note>
        )}
      </ChartCard>

      <ChartCard
        title={today ? 'Day movers & beat/lag' : `Movers & beat/lag, ${rangeLabel}`}
        subtitle={today ? 'Each holding today; the dark tick is its sector index.' : `Each holding over ${phrase}; the dark tick is its sector index.`}
        info={`${today
          ? 'Per-holding day % and day $ (AUD) with divergence vs assigned sector benchmark (SOX for semis, ASX 200 for ASX, Nasdaq otherwise).'
          : `Each holding's move over ${phrase} (from its first stored price in that window) against its sector index over the same range. The dollar figure is the price change on the units you hold today.`} The dark tick on each bar marks its sector index's move. The trailing return card shows on Today only: over 7 days and longer it would measure the same window as this card.`}
      >
        {moverItems.length
          ? <DivergingBars items={moverItems} ariaLabel={`Bars centred on zero: each holding's move ${today ? 'today' : `over ${phrase}`}, with a tick at its sector index move`} />
          : <Note>{today ? 'No priced holdings for today’s move chart.' : 'No holdings have stored prices in this range yet.'}</Note>}
      </ChartCard>

      <ChartCard
        title="Drawdown & alert status"
        badge={SNAPSHOT}
        subtitle={`Triggers: ${peakTrigger}% off peak, ${costTrigger}% off average cost.`}
        info={`% off high-water mark since purchase. Triggers: ${peakTrigger}% off peak · ${costTrigger}% off avg cost. The badge counts both triggers, the same as the alert emails: "Near a trigger" within ${thresholds.proximityPp ?? 1} point of either, "Trigger hit" at or past either.`}
      >
        {charts.alertRows?.length
          ? <ThresholdBars items={drawdownItems(charts.alertRows)} trigger={peakTrigger} triggerLabel={`${peakTrigger}% off peak trigger`} labels={drawdownLabels} ariaLabel={`Bars of how far each holding is below its peak, with a line at the ${peakTrigger}% trigger`} />
          : <Note>No alert data — add holdings with live quotes.</Note>}
      </ChartCard>

      {showTrailing && (
        <ChartCard
          title={`${trailingDays}-day trailing return`}
          badge={`Last ${trailingDays} days`}
          subtitle="Price change over the last few days."
          info="Price change from the earliest snapshot in the last ~5 days — same metric cited in Portfolio Note movers. On longer ranges this card is hidden, because Movers already shows that window."
        >
          {trailingItems.length
            ? <DivergingBars items={trailingItems} ariaLabel={`Bars centred on zero: each holding's price change over ${trailingDays} days`} />
            : <Note>No snapshots in the last few days yet — data fills in as polls accumulate.</Note>}
          {(charts.trailingReturns || []).some((t) => !t.dataAvailable) && trailingItems.length > 0 && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Some holdings have no snapshot in this window — data fills in as polls accumulate.</p>
          )}
        </ChartCard>
      )}
    </Grid>
  );

  // ---- Performance ----
  const snaps = charts.portfolioSnapshots || [];
  const lastSnap = snaps[snaps.length - 1];
  const valueKey = cashView === 'split' ? 'holdingsValueAud' : 'totalValueAud';
  const valueChange = changeOverRange(snaps, valueKey);
  const lastOf = (pts, key) => { for (let i = pts.length - 1; i >= 0; i--) if (pts[i]?.[key] != null) return Number(pts[i][key]); return null; };

  const performance = (
    <Grid>
      <ChartCard
        title="Portfolio value"
        subtitle={today ? 'Intraday snapshots.' : `Daily snapshots over ${phrase}.`}
        info={today ? 'Intraday snapshots from quote polls and manual refresh.' : `Daily snapshots over ${phrase}.`}
        actions={(
          <SegmentedToggle
            label="What the value line shows"
            size="xs"
            value={cashView}
            onChange={setCashView}
            options={[
              { value: 'total', label: 'Total', tip: 'One line: holdings and cash together.' },
              { value: 'split', label: 'Holdings + cash', tip: 'Holdings as the filled line, cash as a dashed line.' },
            ]}
          />
        )}
      >
        {snaps.length ? (
          <>
            <div>
              <p className="text-3xl font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtAud(lastOf(snaps, valueKey), { signed: false })}</p>
              {valueChange && (
                <p className="text-sm tabular-nums" style={{ color: valueChange.change >= 0 ? 'var(--chart-gain)' : 'var(--chart-loss)' }}>
                  {fmtAud(valueChange.change)} ({fmtPct(valueChange.pct)}) <span style={{ color: 'var(--color-muted)' }}>{today ? 'today' : `over ${phrase}`}</span>
                </p>
              )}
              {lastSnap?.pnlPct != null && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Unrealised P&L {fmtPct(lastSnap.pnlPct, 2)} vs cost basis</p>
              )}
            </div>
            <PortfolioValueChart points={snaps} split={cashView === 'split'} intraday={today} />
          </>
        ) : (
          <Note>No snapshot data for this period — use Refresh or wait for the next poll.</Note>
        )}
      </ChartCard>

      <ChartCard
        title="Relative performance (rebased to 100)"
        subtitle="Your holdings against the index proxies."
        info="Cumulative daily returns from stored Portfolio Note observations — portfolio vs index proxies (Nasdaq and SOX are USD-priced)."
      >
        {charts.normalizedPerformance?.length > 1
          ? <RelativePerformanceChart points={charts.normalizedPerformance} />
          : <Note>Needs at least two daily Portfolio Notes in this range — run the Portfolio Note for a few days.</Note>}
      </ChartCard>

      {symbolKeys.length > 0 && (
        <ChartCard
          span
          title="Price by holding"
          subtitle={today ? 'Intraday price in AUD.' : `Price in AUD over ${phrase}${charts.range?.days > 90 ? ' (one point a day)' : ''}.`}
          info={today ? 'Intraday price AUD (quantity changes do not affect this line).' : `Price history over ${phrase}${charts.range?.days > 90 ? ' (one point a day)' : ''}.`}
        >
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {symbolKeys.map((key) => {
              const pts = charts.bySymbol[key];
              if (!pts?.length || (today && pts.length < 2)) return null;
              const ch = changeOverRange(pts, 'priceAud');
              const up = !ch || ch.change >= 0;
              const [sym, ex] = key.split(':');
              return (
                <div key={key} className="rounded-xl border p-4 min-w-0" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{sym}<span className="text-xs font-normal ml-1" style={{ color: 'var(--color-muted)' }}>{ex}</span></p>
                    <p className="text-sm font-medium tabular-nums" style={{ color: up ? 'var(--chart-gain)' : 'var(--chart-loss)' }}>{ch ? fmtPct(ch.pct) : '—'}</p>
                  </div>
                  <p className="text-xs tabular-nums" style={{ color: 'var(--color-muted)' }}>{fmtAud(lastOf(pts, 'priceAud'), { signed: false, digits: 2 })}</p>
                  <Sparkline points={pts} dataKey="priceAud" up={up} ariaLabel={`${sym} price ${today ? 'today' : `over ${phrase}`}: ${ch ? fmtPct(ch.pct) : 'no change measured'}`} />
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
          <ThresholdBars items={drawdownItems(charts.metals.alertRows)} trigger={peakTrigger} triggerLabel={`${peakTrigger}% off peak trigger`} labels={drawdownLabels} ariaLabel="Bars of how far each metal holding is below its peak" />
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
