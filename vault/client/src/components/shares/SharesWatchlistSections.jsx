import React from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../Tooltip';
import ChartCard from '../charts/ChartCard';
import StatTile from '../charts/StatTile';
import DivergingBars from '../charts/DivergingBars';
import GroupedColumns from '../charts/GroupedColumns';
import AreaTrend from '../charts/AreaTrend';
import { priceAxisDomain, axisPct, stackLanes } from '../charts/chartMath.mjs';
import { fmtPct } from '../charts/chartFormat.mjs';
import CitationChips from './CitationChips';
import { TONE_ICON, TONE_COLOR, fmtFigure, nowPrice, targetRows, psMultiple, riskIcon } from './watchlistReport.mjs';

// Financials, valuation and risks of the visual watchlist report (redesign M3). Every Finnhub figure here was mapped in code on the
// server from the report's evidence snapshot; targets, peer P/S, assumptions, risks and warnings come from the checked extraction.
// A section or card with no data is left out. Docs: docs/shares-watchlist.md.

const pctAxis = (v) => `${Number(v).toFixed(1)}%`;
const GROWTH_LABEL = { '5-year': '5 years', 'Trailing 12 months': '12 months', 'Latest quarter': 'Last quarter' };
const pctTip = (v) => fmtFigure(v, '%');
const money = (v, c) => `${c ? `${c} ` : ''}${Number(v).toLocaleString('en-AU', { maximumFractionDigits: 2 })}`;

function SectionTitle({ id, children, sub }) {
  return (
    <div id={id} className="scroll-mt-4 pt-2">
      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{children}</h2>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  );
}

function Callout({ title, items, sources, icon = 'alert-triangle' }) {
  const getIcon = useIcon();
  if (!items?.length) return null;
  return (
    <div className="rounded-2xl border p-5 xl:col-span-2" style={{ borderColor: 'var(--chart-warn)', background: 'var(--color-surface)' }}>
      <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--chart-warn)' }}>{getIcon(icon, { size: 15 })} {title}</p>
      <ul className="mt-2 space-y-1.5 list-disc pl-5">
        {items.map((w, i) => (
          <li key={i} className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>{w.text}<CitationChips cites={w.cites} sources={sources} /></li>
        ))}
      </ul>
    </div>
  );
}

function FigureTile({ t }) {
  const getIcon = useIcon();
  const tone = t.signal in TONE_ICON ? t.signal : 'neutral';
  return (
    <div className="rounded-xl border p-3 min-w-0" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
      <p className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>{t.label}</p>
      <p className="text-xl font-bold tabular-nums mt-0.5 flex items-center gap-1.5" style={{ color: TONE_COLOR[tone] }}>
        {tone !== 'neutral' && <span aria-hidden="true">{getIcon(TONE_ICON[tone], { size: 15 })}</span>}
        {fmtFigure(t.value, t.unit, { signed: t.unit === '%' && /growth/i.test(t.label) })}
      </p>
      {tone === 'warn' && <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{t.label === 'Debt/equity' ? 'Debt above equity' : 'Under 1: short-term bills exceed short-term assets'}</p>}
    </div>
  );
}

export function FinancialsSection({ s, sources }) {
  const f = s.financials;
  const warnings = s.dataWarnings || [];
  if (!f && !warnings.length) return null;
  const marginPoints = (f?.margins || []).map((q) => ({ label: q.label, operating: q.operating, net: q.net }));
  return (
    <>
      <SectionTitle id="wl-sec-financials" sub={f ? `Reported figures from ${f.source || 'Finnhub'} at the time of the report, quarters labelled by the month they ended.` : 'No reported figures for this report.'}>Financials</SectionTitle>
      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-2 xl:items-start">
        {f?.tiles?.length > 0 && (
          <ChartCard span title="Key figures" subtitle="Green is a positive figure, red a negative one, amber a caution" info="Margins and return on equity above zero are shown as positive and below zero as negative; debt/equity over 1 or a current ratio under 1 are a caution. Each tile also carries its sign and an icon.">
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">{f.tiles.map((t) => <FigureTile key={t.label} t={t} />)}</div>
          </ChartCard>
        )}
        {f?.growth?.length > 0 && (
          <ChartCard title="Revenue growth" subtitle="Year on year, over three time spans" info="Revenue growth over five years (a yearly average), the trailing 12 months, and the latest quarter against the same quarter a year earlier.">
            <DivergingBars ariaLabel="Revenue growth" items={f.growth.map((g) => ({ key: g.label, label: GROWTH_LABEL[g.label] || g.label, value: g.value, valueText: fmtFigure(g.value, '%') }))} />
          </ChartCard>
        )}
        {marginPoints.length > 0 && (
          <ChartCard title="Operating and net margin" subtitle="By quarter; below the line is a loss" info="Operating margin is profit from the business before interest and tax; net margin is what is left after everything. Each as a share of revenue.">
            <GroupedColumns points={marginPoints} xKey="label" series={[{ key: 'operating', name: 'Operating margin', color: 'var(--chart-2)' }, { key: 'net', name: 'Net margin', color: 'var(--chart-4)' }]} format={pctTip} height={220} ariaLabel="Operating and net margin by quarter" />
          </ChartCard>
        )}
        {f?.grossMargin?.length > 1 && (
          <ChartCard title="Gross margin" subtitle="By quarter" info="Revenue left after the direct cost of delivering the product, as a share of revenue.">
            <AreaTrend points={f.grossMargin} xKey="label" yKey="value" name="Gross margin" format={pctAxis} height={160} ariaLabel="Gross margin by quarter" />
          </ChartCard>
        )}
        <Callout title="Check before relying on the figures" items={warnings} sources={sources} />
      </div>
    </>
  );
}

function PriceAxis({ rows, now, sources }) {
  const getIcon = useIcon();
  const domain = priceAxisDomain(rows.map((r) => r.value), now?.price);
  if (!domain) return null;
  const nowPct = now ? axisPct(now.price, domain) : null;
  const pos = rows.map((r) => axisPct(r.value, domain));
  const lanes = stackLanes(pos, 3.5);
  const laneCount = Math.max(1, ...lanes.map((l) => l + 1));
  return (
    <div>
      <div className="relative mx-2" style={{ height: 40 + laneCount * 22 }} role="img" aria-label={`Price targets and fair values from ${money(domain.min, '')} to ${money(domain.max, '')}${now ? `, ${now.label.toLowerCase()} ${money(now.price, now.currency)}` : ''}`}>
        <div className="absolute left-0 right-0 h-px" style={{ top: 30, background: 'var(--chart-grid)' }} />
        {now && (
          <div className="absolute top-0 bottom-0" style={{ left: `${nowPct}%` }}>
            <span className="absolute top-0 text-[11px] font-semibold whitespace-nowrap -translate-x-1/2" style={{ color: 'var(--chart-ink)' }}>{now.label}</span>
            <div className="absolute bottom-0 w-0.5 -ml-px" style={{ top: 18, background: 'var(--chart-ink)' }} />
          </div>
        )}
        {rows.map((r, i) => (
          <Tooltip key={i} text={`${r.source}, ${r.kind}: ${money(r.value, r.currency)}${r.pct != null ? ` (${fmtPct(r.pct)} from ${now.label.toLowerCase()})` : ''}`}>
            <span
              tabIndex={0} aria-label={`${i + 1}: ${r.source} ${money(r.value, r.currency)}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 text-[10px] font-semibold flex items-center justify-center tabular-nums"
              style={{ left: `${pos[i]}%`, top: 30 + lanes[i] * 22, background: 'var(--color-surface)', borderColor: TONE_COLOR[r.tone], color: TONE_COLOR[r.tone] }}
            >{i + 1}</span>
          </Tooltip>
        ))}
      </div>
      <div className="flex justify-between text-[11px] tabular-nums mx-2" style={{ color: 'var(--color-muted)' }}>
        <span>{money(domain.min, '')}</span><span>{money(domain.max, '')}</span>
      </div>
      <ol className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {rows.map((r, i) => (
          <li key={i} className="flex items-baseline gap-2 text-xs min-w-0">
            <span className="w-4 shrink-0 text-right tabular-nums font-semibold" style={{ color: TONE_COLOR[r.tone] }}>{i + 1}</span>
            <span className="min-w-0 flex-1" style={{ color: 'var(--color-text)' }}>
              {r.source} <span style={{ color: 'var(--color-muted)' }}>{r.kind}{r.analysts ? `, ${r.analysts} analysts` : ''}{r.date ? `, ${r.date}` : ''}</span>
              <CitationChips cites={r.cites} sources={sources} />
            </span>
            <span className="tabular-nums shrink-0" style={{ color: 'var(--color-text)' }}>{money(r.value, r.currency)}</span>
            {r.pct != null && (
              <span className="tabular-nums shrink-0 inline-flex items-center gap-0.5 w-20 justify-end" style={{ color: TONE_COLOR[r.tone] }}>
                {r.tone !== 'neutral' && getIcon(TONE_ICON[r.tone], { size: 12 })}{fmtPct(r.pct)}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PeerBars({ ps, name }) {
  const max = Math.max(ps.company, ps.peers);
  const times = psMultiple(ps.company, ps.peers);
  const bars = [[name, ps.company, 'var(--chart-1)'], [ps.peerNames || 'Peers', ps.peers, 'var(--chart-neutral)']];
  return (
    <div className="space-y-3" role="img" aria-label={`Price to sales: ${name} ${ps.company.toFixed(1)}x, peers ${ps.peers.toFixed(1)}x`}>
      {bars.map(([label, v, color]) => (
        <div key={label}>
          <div className="flex justify-between text-xs gap-2"><span className="truncate" style={{ color: 'var(--color-text)' }}>{label}</span><span className="tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>{v.toFixed(1)}x</span></div>
          <div className="h-3 mt-1 rounded-full" style={{ background: 'var(--color-bg)' }}><div className="h-3 rounded-full" style={{ width: `${(v / max) * 100}%`, background: color }} /></div>
        </div>
      ))}
      {times != null && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{times >= 1 ? `${times.toFixed(1)} times the peers' price to sales` : `${(1 / times).toFixed(1)} times cheaper than the peers on price to sales`}</p>}
    </div>
  );
}

export function ValuationSection({ s, sources, liveQuote, companyName }) {
  const v = s.valuation;
  if (!v) return null;
  const now = nowPrice(liveQuote, s.price);
  const rows = targetRows(v.targets, now?.price);
  return (
    <>
      <SectionTitle id="wl-sec-valuation" sub="What others think it is worth, and what today's price assumes.">Valuation</SectionTitle>
      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-2 xl:items-start">
        {rows.length > 0 && (
          <ChartCard span title="Fair values and price targets" subtitle={now ? `Each against ${now.label === 'Now' ? 'today\'s price' : 'the price at the report'} (${money(now.price, now.currency)})` : 'As published'}
            info="Fair values and price targets that sources published, as found in the web search; their view, not Vault's. Green is above the reference price, red below, with the % difference. Targets in another currency are left out and noted under Financials.">
            <PriceAxis rows={rows} now={now} sources={sources} />
          </ChartCard>
        )}
        {v.peerPs && (
          <ChartCard title="Price to sales against peers" subtitle="Own figure from Finnhub, peers' from the sources" info="Price to sales is the market value divided by a year of revenue. The peer figure comes from a cited source.">
            <PeerBars ps={v.peerPs} name={companyName || 'This company'} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Peer figure<CitationChips cites={v.peerPs.cites} sources={sources} /></p>
          </ChartCard>
        )}
        {v.multiples?.length > 0 && (
          <ChartCard title="Multiples" subtitle="Reported by Finnhub at the time of the report" info="P/E is price to earnings, P/S price to sales, P/B price to book value. Higher means the market pays more for each dollar of that measure.">
            <div className="grid gap-3 grid-cols-2">{v.multiples.map((m) => <StatTile key={m.label} label={m.label.replace(' (USD m)', '')} value={fmtFigure(m.value, m.unit)} />)}</div>
          </ChartCard>
        )}
        {v.assumptions?.length > 0 && (
          <ChartCard span title="For today's price to hold up, all of these need to be true" info="The conditions the report found today's price depends on. If one fails, the price has less support.">
            <ol className="grid gap-3 sm:grid-cols-2">
              {v.assumptions.map((a, i) => (
                <li key={i} className="rounded-xl border p-3 flex gap-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                  <span className="shrink-0 w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>{i + 1}</span>
                  <span className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{a.text}<CitationChips cites={a.cites} sources={sources} /></span>
                </li>
              ))}
            </ol>
          </ChartCard>
        )}
      </div>
    </>
  );
}

export function RisksSection({ s, sources }) {
  const getIcon = useIcon();
  if (!s.risks?.length) return null;
  return (
    <>
      <SectionTitle id="wl-sec-risks" sub="What could hurt the investment case.">Risks</SectionTitle>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {s.risks.map((r, i) => (
          <li key={i} className="rounded-2xl border p-4 flex gap-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--chart-warn)' }}>{getIcon(riskIcon(r.title), { size: 16 })}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{r.title}</span>
              <span className="block text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{r.text}<CitationChips cites={r.cites} sources={sources} /></span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
