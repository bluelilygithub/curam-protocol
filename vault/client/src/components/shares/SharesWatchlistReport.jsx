import React from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../Tooltip';
import ChartCard from '../charts/ChartCard';
import LevelMeter from '../charts/LevelMeter';
import { fmtPct } from '../charts/chartFormat.mjs';
import CitationChips from './CitationChips';
import { FinancialsSection, ValuationSection, RisksSection } from './SharesWatchlistSections';
import {
  TONE_ICON, TONE_COLOR, LEVELS, consensusTone, moatTone, labelTone, pctFrom, levelIndex, groupCompetitors, sectionPills,
} from './watchlistReport.mjs';

// The visual watchlist report: verdict tiles, section pills, summary, moat scorecard and competitors. Drawn only from the validated
// `structured` data (share_research_reports.structured); SharesWatchlistTab shows the prose instead when there is none.
// Financials, valuation and risks are in SharesWatchlistSections.jsx. Docs: docs/shares-watchlist.md.

const BUILT = ['summary', 'moat', 'financials', 'valuation', 'risks'];
const LEVEL_LABELS = ['Weak', 'Moderate', 'Strong'];
const LEVEL_COLOR = { weak: 'var(--chart-loss)', moderate: 'var(--chart-warn)', strong: 'var(--chart-gain)' };
export const fmtMoney = (v, currency) => (v == null ? '—' : `${currency ? `${currency} ` : ''}${Number(v).toLocaleString('en-AU', { maximumFractionDigits: 2 })}`);

/** Scroll to a report section; opens the Sources <details>. Honours reduced motion. */
export function jumpTo(id) {
  const el = document.getElementById(`wl-sec-${id}`);
  if (!el) return;
  if (el.tagName === 'DETAILS') el.open = true;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

export function ToneBadge({ tone, children, size = 'sm' }) {
  const getIcon = useIcon();
  return (
    <span className={`inline-flex items-start gap-1.5 font-semibold leading-snug ${size === 'lg' ? (String(children).length > 14 ? 'text-base' : 'text-lg') : 'text-sm'}`} style={{ color: TONE_COLOR[tone] || TONE_COLOR.neutral }}>
      <span className="shrink-0 mt-[0.2em]">{getIcon(TONE_ICON[tone] || TONE_ICON.neutral, { size: size === 'lg' ? 16 : 14 })}</span>
      <span>{children}</span>
    </span>
  );
}

function VerdictTile({ title, tone, verdict, note, sub, cites, sources, info }) {
  return (
    <div className="rounded-xl border p-4 min-w-0" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
      <Tooltip text={info}><p className="text-xs inline-block" style={{ color: 'var(--color-muted)' }}>{title}</p></Tooltip>
      <div className="mt-1"><ToneBadge tone={tone} size="lg">{verdict}</ToneBadge></div>
      {note && <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--color-text)' }}>{note}<CitationChips cites={cites} sources={sources} /></p>}
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  );
}

function VerdictTiles({ s, sources }) {
  const v = s.verdicts;
  const price = s.price?.current;
  const tiles = [];
  if (v.consensus) {
    const c = v.consensus;
    const vsPrice = pctFrom(c.averageTarget, price);
    tiles.push(
      <VerdictTile
        key="consensus" title="Analyst consensus" tone={consensusTone(c.rating)} verdict={c.rating} sources={sources} cites={c.cites}
        info="The majority of the ratings that named sources published, as found in the web search. Their view, not advice from Vault."
        note={[c.analysts ? `${c.analysts} analysts` : '', c.averageTarget ? `average target ${fmtMoney(c.averageTarget, c.currency)}${vsPrice != null ? ` (${fmtPct(vsPrice)} vs the price at report)` : ''}` : ''].filter(Boolean).join(', ') || c.source}
        sub={c.analysts || c.averageTarget ? c.source : ''}
      />,
    );
  }
  if (v.moat) {
    const n = v.moat.counts || {};
    tiles.push(
      <VerdictTile
        key="moat" title="Moat" tone={moatTone(n)} verdict={v.moat.label} note={v.moat.note}
        info="How well the business is protected from competitors. The colour follows the most common level across the moat factors below."
        sub={LEVELS.filter((l) => n[l]).map((l) => `${n[l]} ${l}`).join(' · ')}
      />,
    );
  }
  for (const [k, title, info] of [
    ['valuation', 'Valuation', 'What today\'s price assumes, in the report\'s words. A description, not a recommendation.'],
    ['growth', 'Growth', 'How fast the business is growing and which way growth is heading, in the report\'s words.'],
  ]) {
    if (v[k]) tiles.push(<VerdictTile key={k} title={title} tone={labelTone(k, v[k].label)} verdict={v[k].label} note={v[k].reason} cites={v[k].cites} sources={sources} info={info} />);
  }
  return <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">{tiles}</div>;
}

function MoatCard({ s, sources }) {
  const getIcon = useIcon();
  const factors = s.moat?.factors || [];
  const conflicts = s.moat?.conflicts || [];
  if (!factors.length && !conflicts.length) return null;
  const counts = s.verdicts.moat?.counts;
  return (
    <ChartCard
      title="Moat scorecard" subtitle="What protects the business, factor by factor"
      info="Weak, moderate or strong for each factor, as the report judged it from the sources. The overall badge is the report's own label."
      actions={s.verdicts.moat ? <ToneBadge tone={moatTone(counts)}>{s.verdicts.moat.label}</ToneBadge> : null}
    >
      {factors.length > 0 && (
        <ul className="space-y-3">
          {factors.map((f) => (
            <li key={f.factor} className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{f.factor}</p>
                <LevelMeter labels={LEVEL_LABELS} index={levelIndex(f.level)} color={LEVEL_COLOR[f.level]} label={`${f.factor}: ${f.level}`} />
              </div>
              {f.reason && <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{f.reason}<CitationChips cites={f.cites} sources={sources} /></p>}
            </li>
          ))}
        </ul>
      )}
      {conflicts.length > 0 && (
        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--chart-warn)', background: 'var(--color-bg)' }}>
          <p className="text-sm font-medium flex items-center gap-1.5" style={{ color: 'var(--chart-warn)' }}>{getIcon('alert-triangle', { size: 14 })} Readings that disagree</p>
          <ul className="mt-1.5 space-y-1.5">
            {conflicts.map((c, i) => (
              <li key={i} className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>
                {c.reading}{c.source ? <span style={{ color: 'var(--color-muted)' }}> ({c.source})</span> : null}<CitationChips cites={c.cites} sources={sources} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}

function CompetitorsCard({ s, sources }) {
  const getIcon = useIcon();
  const groups = groupCompetitors(s.competitors);
  if (!groups.length) return null;
  return (
    <ChartCard title="Competitors" subtitle="Grouped by the kind of pressure" info="From the report and its sources. A company can appear in more than one group.">
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.key}>
            <p className="text-xs font-medium flex items-center gap-1.5 mb-2" style={{ color: 'var(--color-muted)' }}>{getIcon(g.icon, { size: 14 })} {g.label}</p>
            <div className="space-y-2">
              {g.rows.map((row, i) => (
                <div key={i}>
                  <div className="flex flex-wrap gap-1.5">
                    {row.names.map((n) => (
                      <span key={n} className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}>{n}</span>
                    ))}
                  </div>
                  {row.note && <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{row.note}<CitationChips cites={row.cites} sources={sources} /></p>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

/** The top half of the visual report. `picker` is the report date picker; `children` follow the drawn sections. */
export default function SharesWatchlistReport({ s, sources, picker, liveQuote, companyName, children }) {
  const pills = sectionPills(s, sources?.length || 0, BUILT);
  return (
    <div className="space-y-5">
      <VerdictTiles s={s} sources={sources} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Report sections" className="flex flex-wrap gap-1.5">
          {pills.map((p) => (
            <Tooltip key={p.id} text={`Jump to ${p.label.replace(/ \(\d+\)$/, '')}`}>
              <button type="button" onClick={(e) => { jumpTo(p.id); if (e.detail > 0) e.currentTarget.blur(); /* mouse click: drop the tip, keep it for keyboard */ }} className="text-xs px-3 py-1 rounded-full border hover:opacity-70 transition-opacity duration-200" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' }}>
                {p.label}
              </button>
            </Tooltip>
          ))}
        </nav>
        {picker}
      </div>

      <section id="wl-sec-summary" className="rounded-2xl border p-6 space-y-3 scroll-mt-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>The central question</p>
        <blockquote className="text-lg xl:text-xl font-semibold leading-snug pl-4 border-l-4" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-text)' }}>
          {s.centralQuestion}
        </blockquote>
        {s.summary && <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{s.summary}</p>}
      </section>

      {(s.moat || s.competitors) && (
        <div id="wl-sec-moat" className="flex flex-col gap-6 xl:grid xl:grid-cols-2 xl:items-start scroll-mt-4">
          <MoatCard s={s} sources={sources} />
          <CompetitorsCard s={s} sources={sources} />
        </div>
      )}

      <FinancialsSection s={s} sources={sources} />
      <ValuationSection s={s} sources={sources} liveQuote={liveQuote} companyName={companyName} />
      <RisksSection s={s} sources={sources} />

      {children}
    </div>
  );
}
