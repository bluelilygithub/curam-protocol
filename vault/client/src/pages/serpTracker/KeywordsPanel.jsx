import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTip, XAxis, YAxis } from 'recharts';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import EmptyState from '../../components/EmptyState';
import Skeleton from '../../components/Skeleton';
import { movingAverage, changeText, positionText, periodLabel, chartDomain } from './keywordsHelpers.mjs';

// SERP Tracker, Keywords tab: the keywords a site really ranks for and a keyword's position over time, from Google Search Console (Google's own
// figures across everyone who searched, not one scraped page). Free to use. See docs/serp-tracker.md, "Keywords".

const CARD = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const muted = { color: 'var(--color-muted)' };
const btn = 'px-3 py-1.5 rounded-lg border text-xs font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const PERIODS = [['7', 'Last 7 days'], ['28', 'Last 28 days'], ['90', 'Last 3 months'], ['180', 'Last 6 months'], ['all', 'All history']];
const CHART_RANGES = [['90', '3 months'], ['180', '6 months'], ['all', 'All history']];
const METRICS = [['position', 'Position'], ['clicks', 'Clicks'], ['impressions', 'Impressions']];
const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-AU'));
const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });

function KeywordChart({ siteId, query, onClose }) {
  const addToast = useToastStore((s) => s.addToast);
  const [range, setRange] = useState('180');
  const [metric, setMetric] = useState('position');
  const [asTable, setAsTable] = useState(false);
  const [days, setDays] = useState(null);

  useEffect(() => {
    let live = true;
    setDays(null);
    (async () => {
      try {
        const res = await api.post(`/api/serp-tracker/sites/${siteId}/keywords/history`, { query, days: range });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load that keyword.');
        if (live) setDays(data.days);
      } catch (err) { if (live) { setDays([]); addToast(err.message, 'error'); } }
    })();
    return () => { live = false; };
  }, [siteId, query, range, addToast]);

  const series = useMemo(() => {
    if (!days) return [];
    const avg = movingAverage(days, 7);
    return days.map((d, i) => ({ ...d, label: dayLabel(d.day), average: avg[i] }));
  }, [days]);
  const domain = useMemo(() => chartDomain(series), [series]);
  const ink = { fill: 'var(--color-muted)', fontSize: 11 };

  return (
    <section className="rounded-2xl border p-5 space-y-3" style={CARD} aria-labelledby="kw-chart-title" data-guide="kw-chart">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="kw-chart-title" className="text-sm font-semibold break-words min-w-0" style={{ color: 'var(--color-text)' }}>{query}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip text="What to chart: where the keyword sat on Google (lower is better, so the line is drawn with 1 at the top), how many clicks it brought, or how often your site was shown.">
            <select aria-label="What to chart" value={metric} onChange={(e) => setMetric(e.target.value)} className="px-2 py-1.5 rounded-lg border text-xs" style={FIELD}>
              {METRICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Tooltip>
          <Tooltip text="How far back the chart goes.">
            <select aria-label="Chart range" value={range} onChange={(e) => setRange(e.target.value)} className="px-2 py-1.5 rounded-lg border text-xs" style={FIELD}>
              {CHART_RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Tooltip>
          <Tooltip text="Shows the same figures as a table instead of a chart.">
            <button type="button" onClick={() => setAsTable((v) => !v)} className={btn} style={BTN_STYLE}>{asTable ? 'Show chart' : 'Show table'}</button>
          </Tooltip>
          <button type="button" onClick={onClose} className={btn} style={BTN_STYLE}>Close</button>
        </div>
      </div>

      {days === null ? <Skeleton lines={4} label="Loading the chart" /> : series.length === 0 ? (
        <p className="text-sm" style={muted}>No figures for this keyword in that range.</p>
      ) : asTable ? (
        <div className="max-h-80 overflow-y-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0" style={{ background: 'var(--color-surface)' }}><tr style={muted}><th className="text-left p-2 font-medium">Day</th><th className="text-right p-2 font-medium">Position</th><th className="text-right p-2 font-medium">Clicks</th><th className="text-right p-2 font-medium">Impressions</th></tr></thead>
            <tbody>{[...series].reverse().map((d) => (
              <tr key={d.day} className="border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <td className="p-2">{d.label}</td><td className="p-2 text-right">{positionText(d.position)}</td><td className="p-2 text-right">{num(d.clicks)}</td><td className="p-2 text-right">{num(d.impressions)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ) : (
        <>
          <div role="img" aria-label={`${METRICS.find(([v]) => v === metric)[1]} for ${query} by day, ${series.length} days. Use Show table for the figures.`} style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />
                <XAxis dataKey="label" tick={ink} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} minTickGap={48} />
                <YAxis reversed={metric === 'position'} domain={metric === 'position' ? domain : [0, 'auto']} allowDecimals={metric === 'position' ? false : false} tick={ink} tickLine={false} axisLine={false} width={40} />
                <ChartTip
                  cursor={{ stroke: 'var(--color-muted)', strokeDasharray: '3 3' }}
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12, color: 'var(--color-text)' }}
                  labelStyle={{ color: 'var(--color-text)', fontWeight: 600 }}
                  formatter={(v, name) => [metric === 'position' ? positionText(v) : num(v), name]}
                />
                <Line type="monotone" dataKey={metric} name={METRICS.find(([v]) => v === metric)[1]} stroke="var(--color-primary)" strokeWidth={2} strokeOpacity={metric === 'position' ? 0.45 : 1} dot={false} activeDot={{ r: 4, stroke: 'var(--color-surface)', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
                {metric === 'position' && <Line type="monotone" dataKey="average" name="7-day average" stroke="var(--color-primary)" strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4, stroke: 'var(--color-surface)', strokeWidth: 2 }} connectNulls isAnimationActive={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs" style={muted}>
            {metric === 'position' ? 'Position 1 is the top of Google, so the line is drawn upside down: up is better. Faint line: each day. Dashed: 7-day average.' : 'Each point is one day.'} Google's figures end about three days ago.
          </p>
        </>
      )}
    </section>
  );
}

export default function KeywordsPanel({ siteId, site }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [gsc, setGsc] = useState(null); // null = loading
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState('28');
  const [sort, setSort] = useState('clicks');
  const [dir, setDir] = useState('desc');
  const [q, setQ] = useState('');
  const [striking, setStriking] = useState(false);
  const [list, setList] = useState(null); // null = loading
  const [selected, setSelected] = useState(null);
  const qTimer = useRef(null);
  const [qDebounced, setQDebounced] = useState('');

  const loadState = useCallback(async () => {
    try {
      const res = await api.get(`/api/serp-tracker/sites/${siteId}/gsc`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load Search Console.');
      setGsc(data);
      setChoice((c) => c || data.suggested || (data.properties && data.properties[0] ? data.properties[0].siteUrl : ''));
      return data;
    } catch (err) { addToast(err.message, 'error'); setGsc({ connected: false, failed: true }); return null; }
  }, [siteId, addToast]);

  const loadList = useCallback(async () => {
    try {
      const params = new URLSearchParams({ days, sort, dir });
      if (qDebounced) params.set('q', qDebounced);
      if (striking) params.set('striking', '1');
      const res = await api.get(`/api/serp-tracker/sites/${siteId}/keywords?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the keywords.');
      setList(data);
    } catch (err) { setList({ keywords: [], total: 0 }); addToast(err.message, 'error'); }
  }, [siteId, days, sort, dir, qDebounced, striking, addToast]);

  useEffect(() => { setGsc(null); setList(null); setSelected(null); loadState(); }, [siteId, loadState]);
  useEffect(() => { if (gsc && gsc.selected) loadList(); }, [gsc && gsc.selected, loadList]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { clearTimeout(qTimer.current); qTimer.current = setTimeout(() => setQDebounced(q.trim()), 350); return () => clearTimeout(qTimer.current); }, [q]);

  // while the history is loading, check in every few seconds and show what has arrived so far (the newest months come first)
  const running = gsc && gsc.progress && gsc.progress.status === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(async () => { await loadState(); loadList(); }, 4000);
    return () => clearInterval(t);
  }, [running, loadState, loadList]);

  async function choose() {
    if (!choice) return;
    setBusy(true);
    try {
      const res = await api.put(`/api/serp-tracker/sites/${siteId}/gsc`, { siteUrl: choice });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save the choice.');
      await startSync();
    } catch (err) { addToast(err.message, 'error'); } finally { setBusy(false); }
  }

  async function startSync() {
    try {
      const res = await api.post(`/api/serp-tracker/sites/${siteId}/gsc/sync`, {});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start the update.');
      addToast('Loading your Search Console history. The newest months appear first.', 'success');
      await loadState();
    } catch (err) { addToast(err.message, 'error'); }
  }

  async function change() {
    try {
      const res = await api.put(`/api/serp-tracker/sites/${siteId}/gsc`, { siteUrl: null });
      if (!res.ok) throw new Error('Could not change the property.');
      setSelected(null); setList(null); setChoice('');
      await loadState();
    } catch (err) { addToast(err.message, 'error'); }
  }

  const sortBy = (col) => { if (sort === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSort(col); setDir(col === 'position' || col === 'keyword' ? 'asc' : 'desc'); } };
  const arrow = (col) => (sort === col ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
  const th = 'p-2 font-medium cursor-pointer select-none transition-opacity duration-200 hover:opacity-70';

  if (gsc === null) return <Skeleton lines={5} label="Loading Keywords" />;

  if (!gsc.connected) {
    return (
      <section className="rounded-2xl border" style={CARD} data-guide="kw-property">
        <EmptyState icon="line-chart" title={gsc.failed ? 'Could not load Search Console' : 'Connect Search Console first'}
          body={gsc.failed ? 'Try again in a minute.' : 'Keywords come from Google Search Console: the searches your site really shows up for, and where. Connect it once and every site here can use it.'}
          action={gsc.failed ? <button type="button" onClick={loadState} className={btn} style={BTN_STYLE}>Try again</button> : <Link to="/search-console" className={`${btn} inline-block`} style={BTN_STYLE}>Go to Search Console</Link>} />
      </section>
    );
  }

  if (!gsc.selected) {
    return (
      <section className="rounded-2xl border p-6 space-y-3" style={CARD} aria-labelledby="kw-pick-title" data-guide="kw-property">
        <h2 id="kw-pick-title" className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Choose the Search Console property for {site ? (site.name || site.domain) : 'this site'}</h2>
        <p className="text-sm" style={muted}>A property is how Google Search Console names a website. Loading takes a few minutes and pulls up to 16 months of history, the most Google keeps. It costs nothing.</p>
        {gsc.propertiesError && <p role="alert" className="text-sm" style={{ color: '#b45309' }}>{gsc.propertiesError}</p>}
        {gsc.properties.length === 0 && !gsc.propertiesError ? (
          <p className="text-sm" style={{ color: '#b45309' }}>The Google account connected ({gsc.email || 'unknown'}) has no Search Console properties. Add and verify this website in Google Search Console first, or ask the owner of the property to add you as a user.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[18rem]">
              <label htmlFor="kw-property" className="block text-xs font-medium mb-1" style={muted}>Property{gsc.suggested ? ' (matched to this site)' : ''}</label>
              <Tooltip text="The website in Search Console this site's keywords are read from. Vault suggests the one that matches the site address.">
                <select id="kw-property" value={choice} onChange={(e) => setChoice(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={FIELD}>
                  {gsc.properties.map((p) => <option key={p.siteUrl} value={p.siteUrl}>{p.siteUrl}</option>)}
                </select>
              </Tooltip>
            </div>
            <Tooltip text="Saves this choice and starts loading the history. You can watch it fill in and look at the newest months while the older ones load.">
              <button type="button" disabled={busy || !choice} onClick={choose} className="px-3.5 py-2 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50" style={{ background: 'var(--color-primary)', color: '#fff' }}>
                {busy ? 'Starting…' : 'Use this property and load history'}
              </button>
            </Tooltip>
          </div>
        )}
        {!gsc.suggested && gsc.properties.length > 0 && <p className="text-xs" style={muted}>None of these match {site ? site.domain : 'the site address'} exactly. Choose the right one, or check the site address in Site setup.</p>}
      </section>
    );
  }

  const p = gsc.progress;
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border p-4 space-y-2" style={CARD} data-guide="kw-property" aria-label="Search Console property and history">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Reading from <span className="font-semibold break-all">{gsc.selected}</span>
            {p && p.from && p.to ? <span style={muted}> · history {dayLabel(p.from)} to {dayLabel(p.to)} · {num(p.rows)} rows</span> : null}
          </p>
          <div className="flex gap-2">
            <Tooltip text="Pulls the latest days now (it also happens by itself every morning at 7:00 am Brisbane time) and carries on loading older history if it was cut off.">
              <button type="button" onClick={startSync} disabled={running} data-guide="kw-update" className={`${btn} flex items-center gap-1.5`} style={BTN_STYLE}>{getIcon('refresh-cw', { size: 12 })} {running ? 'Updating…' : 'Update'}</button>
            </Tooltip>
            <Tooltip text="Choose a different Search Console property for this site. The history already loaded is kept.">
              <button type="button" onClick={change} className={btn} style={BTN_STYLE}>Change property</button>
            </Tooltip>
          </div>
        </div>
        {running && (
          <div role="status" aria-live="polite">
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}><div className="h-full transition-all duration-200" style={{ width: `${Math.max(3, p.percent)}%`, background: 'var(--color-primary)' }} /></div>
            <p className="text-xs mt-1" style={muted}>Loading history: {p.percent}%. The newest months load first, so you can look around while the rest arrives.</p>
          </div>
        )}
        {p && p.status === 'failed' && <p role="alert" className="text-xs" style={{ color: '#b45309' }}>The last update did not finish: {p.lastError || 'unknown error'} Press Update to carry on from where it stopped.</p>}
        {!p && <p className="text-xs" style={muted}>Nothing loaded yet. Press Update to load the history.</p>}
        <p className="text-xs" style={muted}>Figures are Google's own, across everyone who searched, and end about three days ago. A brand new property has no history from before it was added.</p>
      </section>

      <section className="rounded-2xl border p-5 space-y-3" style={CARD} aria-labelledby="kw-list-title" data-guide="kw-table">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="kw-list-title" className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Keywords this site ranks for</h2>
          <div className="flex flex-wrap items-end gap-3">
            <Tooltip text="Type part of a keyword to narrow the list.">
              <input aria-label="Search keywords" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search keywords" className="px-3 py-1.5 rounded-lg border text-sm" style={FIELD} />
            </Tooltip>
            <Tooltip text="The stretch of time the figures add up over. The Change column compares with the same length of time just before it.">
              <select aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)} className="px-2 py-1.5 rounded-lg border text-sm" style={FIELD}>
                {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Tooltip>
            <Tooltip text="Keywords sitting at positions 8 to 20 with at least 10 impressions: just off page 1, so the cheapest ones to push up.">
              <label className="flex items-center gap-2 text-sm pb-1" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={striking} onChange={(e) => setStriking(e.target.checked)} /> Just off page 1
              </label>
            </Tooltip>
          </div>
        </div>

        {list === null ? <Skeleton lines={6} label="Loading keywords" /> : list.keywords.length === 0 ? (
          <EmptyState icon="line-chart" title={running ? 'Loading your history…' : q || striking ? 'No keywords match' : 'No keywords yet'}
            body={running ? 'The first months are on their way. This fills in by itself.' : q || striking ? 'Try a shorter search, or switch off Just off page 1.' : 'Search Console has no figures for this property yet. A new property takes a few days to start showing data.'} />
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
              <table className="w-full text-sm">
                <thead style={{ background: 'var(--color-bg)', ...muted }}>
                  <tr className="text-xs">
                    <th scope="col" className={`${th} text-left`} onClick={() => sortBy('keyword')} aria-sort={sort === 'keyword' ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>Keyword{arrow('keyword')}</th>
                    <th scope="col" className={`${th} text-right`} onClick={() => sortBy('position')} aria-sort={sort === 'position' ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>Position{arrow('position')}</th>
                    <th scope="col" className={`${th} text-right`} onClick={() => sortBy('change')} aria-sort={sort === 'change' ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>Change{arrow('change')}</th>
                    <th scope="col" className={`${th} text-right`} onClick={() => sortBy('clicks')} aria-sort={sort === 'clicks' ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>Clicks{arrow('clicks')}</th>
                    <th scope="col" className={`${th} text-right`} onClick={() => sortBy('impressions')} aria-sort={sort === 'impressions' ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>Impressions{arrow('impressions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.keywords.map((k) => {
                    const ch = changeText(k.change);
                    const on = selected === k.query;
                    return (
                      <tr key={k.query} className="border-t group" style={{ borderColor: 'var(--color-border)', background: on ? 'var(--color-bg)' : undefined, color: 'var(--color-text)' }}>
                        <td className="p-2 max-w-[28rem]">
                          <button type="button" onClick={() => setSelected(on ? null : k.query)} aria-pressed={on} title="Show the chart for this keyword" className="text-left break-words underline-offset-2 hover:underline transition-opacity duration-200 hover:opacity-70">{k.query}</button>
                        </td>
                        <td className="p-2 text-right whitespace-nowrap">{positionText(k.position)}</td>
                        <td className="p-2 text-right whitespace-nowrap" style={{ color: ch.dir === 'up' ? '#15803d' : ch.dir === 'down' ? '#b91c1c' : 'var(--color-muted)' }}>{ch.text}</td>
                        <td className="p-2 text-right">{num(k.clicks)}</td>
                        <td className="p-2 text-right">{num(k.impressions)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs" style={muted}>
              {periodLabel(days)}: showing {list.keywords.length} of {num(list.total)} keywords. Position is the average across the period, weighted by how often the site was shown. Change compares with the period just before: ▲ means it moved up Google. Click a keyword for its chart.
            </p>
          </>
        )}
      </section>

      {selected && <KeywordChart key={selected} siteId={siteId} query={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
