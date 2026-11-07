import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTip, XAxis, YAxis } from 'recharts';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import EmptyState from '../../components/EmptyState';
import Skeleton from '../../components/Skeleton';
import { chartDomain, changeText } from './keywordsHelpers.mjs';
import { rankText, rankChange, readsLine } from './trackingHelpers.mjs';

// SERP Tracker, Keywords tab, second section: the positions Vault tracks every day through DataForSEO (daily tracking, switched on per site in Site
// setup; see docs/serp-tracker.md "Daily tracking"). These are scraped Google results, each one read up to three times when it misses the site, so they
// are shown with how many reads found the site. For your own sites the Search Console figures above are Google's own and are the ones to trust.

const CARD = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
const muted = { color: 'var(--color-muted)' };
const btn = 'px-3 py-1.5 rounded-lg border text-xs font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });
const ranges = [['30', '30 days'], ['90', '3 months'], ['all', 'All history']];

function RankingChart({ siteId, keyword, device, onClose }) {
  const addToast = useToastStore((s) => s.addToast);
  const [range, setRange] = useState('90');
  const [asTable, setAsTable] = useState(false);
  const [days, setDays] = useState(null);

  useEffect(() => {
    let live = true;
    setDays(null);
    (async () => {
      try {
        const res = await api.post(`/api/serp-tracker/sites/${siteId}/rankings/history`, { keyword, device, days: range });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load that keyword.');
        if (live) setDays(data.days);
      } catch (err) { if (live) { setDays([]); addToast(err.message, 'error'); } }
    })();
    return () => { live = false; };
  }, [siteId, keyword, device, range, addToast]);

  const series = useMemo(() => (days || []).map((d) => ({ ...d, label: dayLabel(d.day) })), [days]);
  const domain = useMemo(() => chartDomain(series), [series]);
  const ink = { fill: 'var(--color-muted)', fontSize: 11 };

  return (
    <section className="rounded-2xl border p-5 space-y-3 mt-4" style={CARD} aria-labelledby="rk-chart-title" data-guide="rk-chart">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="rk-chart-title" className="text-sm font-semibold break-words min-w-0" style={{ color: 'var(--color-text)' }}>{keyword} · {device === 'mobile' ? 'Mobile' : 'Desktop'}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip text="How far back the chart goes.">
            <select aria-label="Chart range" value={range} onChange={(e) => setRange(e.target.value)} className="px-2 py-1.5 rounded-lg border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              {ranges.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Tooltip>
          <button type="button" onClick={() => setAsTable((v) => !v)} className={btn} style={BTN_STYLE}>{asTable ? 'Show chart' : 'Show table'}</button>
          <button type="button" onClick={onClose} className={btn} style={BTN_STYLE}>Close</button>
        </div>
      </div>
      {days === null ? <Skeleton lines={3} label="Loading the chart" /> : series.length === 0 ? <p className="text-sm" style={muted}>No checks in that range yet.</p> : asTable ? (
        <div className="max-h-72 overflow-y-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0" style={{ background: 'var(--color-surface)' }}><tr style={muted}><th className="text-left p-2 font-medium">Day</th><th className="text-right p-2 font-medium">Result</th></tr></thead>
            <tbody>{[...series].reverse().map((d) => (
              <tr key={d.day} className="border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <td className="p-2">{d.label}</td><td className="p-2 text-right">{d.status === 'found' ? `#${d.position}` : d.status === 'not_found' ? 'Not found' : 'Failed'}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ) : (
        <>
          <div role="img" aria-label={`Tracked position of ${keyword} by day, ${series.length} checks. Use Show table for the figures.`} style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />
                <XAxis dataKey="label" tick={ink} tickLine={false} axisLine={{ stroke: 'var(--color-border)' }} minTickGap={48} />
                <YAxis reversed domain={domain} allowDecimals={false} tick={ink} tickLine={false} axisLine={false} width={40} />
                <ChartTip cursor={{ stroke: 'var(--color-muted)', strokeDasharray: '3 3' }}
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12, color: 'var(--color-text)' }}
                  labelStyle={{ color: 'var(--color-text)', fontWeight: 600 }}
                  formatter={(v) => [v == null ? 'Not found' : `#${v}`, 'Position']} />
                <Line type="monotone" dataKey="position" name="Position" stroke="var(--color-primary)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5, stroke: 'var(--color-surface)', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs" style={muted}>Position 1 is the top of Google, so the line is drawn upside down: up is better. A gap means the site was not found in the top results that day, or the check failed. See Show table for which.</p>
        </>
      )}
    </section>
  );
}

export default function RankingsPanel({ siteId, site, onOpenSetup, refreshKey = 0 }) {
  const addToast = useToastStore((s) => s.addToast);
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(null); // { keyword, device }

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/api/serp-tracker/sites/${siteId}/rankings`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the tracked rankings.');
      setRows(data.rankings);
    } catch (err) { setRows([]); addToast(err.message, 'error'); }
  }, [siteId, addToast]);
  useEffect(() => { setRows(null); setSelected(null); load(); }, [siteId, refreshKey, load]);

  const on = site && site.dailyTracking === true;

  return (
    <section className="rounded-2xl border p-5 space-y-3 mt-4" style={CARD} aria-labelledby="rk-title" data-guide="tracked-rankings">
      <div>
        <h2 id="rk-title" className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Tracked rankings (checked through DataForSEO)</h2>
        <p className="text-xs mt-1" style={muted}>
          Where Vault found your site each day, from scraped Google results. A keyword that misses your site is read again, up to three times, before it is called not found. These can differ from what you see in your browser, and for your own sites the Search Console figures above are Google's own and the ones to trust.
        </p>
      </div>

      {rows === null ? <Skeleton lines={4} label="Loading tracked rankings" /> : rows.length === 0 ? (
        <EmptyState icon="line-chart" title={on ? 'Nothing tracked yet' : 'Daily tracking is off'}
          body={on ? 'Daily tracking is on. The first results appear after the next daily run at 6:00 am Brisbane time, or press Run tracking now on the Runs tab.' : 'Switch it on in Site setup to have Vault search your keywords every day. It shows what it would cost first, and it is off until you say so.'}
          action={<button type="button" onClick={onOpenSetup} className={btn} style={BTN_STYLE}>Go to Site setup</button>} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full text-sm">
              <thead style={{ background: 'var(--color-bg)', ...muted }}>
                <tr className="text-xs">
                  <th scope="col" className="p-2 font-medium text-left">Keyword</th>
                  <th scope="col" className="p-2 font-medium text-left">Device</th>
                  <th scope="col" className="p-2 font-medium text-right">Position</th>
                  <th scope="col" className="p-2 font-medium text-right">Change</th>
                  <th scope="col" className="p-2 font-medium text-left">Reads</th>
                  <th scope="col" className="p-2 font-medium text-right">Checked</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const l = r.latest;
                  const ch = changeText(rankChange(l, r.previous));
                  const on2 = selected && selected.keyword === r.keyword && selected.device === r.device;
                  return (
                    <tr key={`${r.keyword}|${r.device}`} className="border-t" style={{ borderColor: 'var(--color-border)', background: on2 ? 'var(--color-bg)' : undefined, color: 'var(--color-text)' }}>
                      <td className="p-2 max-w-[24rem]">
                        <button type="button" onClick={() => setSelected(on2 ? null : { keyword: r.keyword, device: r.device })} aria-pressed={on2} title="Show the history for this keyword" className="text-left break-words underline-offset-2 hover:underline transition-opacity duration-200 hover:opacity-70">{r.keyword}</button>
                      </td>
                      <td className="p-2">{r.device === 'mobile' ? 'Mobile' : 'Desktop'}</td>
                      <td className="p-2 text-right whitespace-nowrap font-medium" style={l.status === 'failed' ? { color: '#b91c1c' } : undefined} title={l.status === 'failed' ? l.error || 'The search failed.' : undefined}>{rankText(l)}</td>
                      <td className="p-2 text-right whitespace-nowrap" style={{ color: ch.dir === 'up' ? '#15803d' : ch.dir === 'down' ? '#b91c1c' : 'var(--color-muted)' }}>{ch.text}</td>
                      <td className="p-2 text-xs" style={muted}>{l.status === 'failed' ? (l.error || 'The search failed.') : readsLine(l.reads)}</td>
                      <td className="p-2 text-right text-xs whitespace-nowrap" style={muted}>{dayLabel(l.day)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs" style={muted}>Position is among ordinary results only (ads and boxes are not counted). A failed search is shown as failed and is never counted as not found.</p>
        </>
      )}
      {selected && <RankingChart key={`${selected.keyword}|${selected.device}`} siteId={siteId} keyword={selected.keyword} device={selected.device} onClose={() => setSelected(null)} />}
    </section>
  );
}
