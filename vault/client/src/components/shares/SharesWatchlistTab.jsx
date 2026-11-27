import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import { useIcon } from '../../providers/IconProvider';
import { mdComponents } from '../../utils/mdComponents';
import { offerUndo } from '../../utils/binUndo';
import { downloadBlob } from '../../utils/exportHelpers';
import Tooltip from '../Tooltip';
import EmptyState from '../EmptyState';
import OverflowMenu from '../OverflowMenu';
import { fmtPct } from '../charts/chartFormat.mjs';
import SharesWatchlistReport, { ToneBadge, fmtMoney } from './SharesWatchlistReport';
import { isUsableStructured, peakBar } from './watchlistReport.mjs';
import { VoiceInputProvider, VoiceInput } from '../voiceInput/VoiceInput';

// Shares → Watchlist. Companies you are researching but do not hold. "Research" runs a dated report (web search, live quote, Finnhub
// figures for US shares, your holdings and your investor profile from Settings → Shares). Reports describe the business and the
// trade-offs in their own voice; the "Analyst consensus" section reports the Buy / Hold / Sell majority of ratings published by named
// sources, and the last section argues whether the company fits your profile. Never a size. Copy / Download give Markdown. Server: routes/sharesWatchlist.js, services/sharesWatchlist.js.
// Docs: docs/shares-watchlist.md.

const BAD = '#ef4444';
const keyOf = (w) => `${w.symbol}:${w.exchange}`;
const fmtWhen = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return String(iso).slice(0, 10); }
};
const DISCLAIMER = 'Written by AI from web search snippets, Finnhub figures (US shares only) and your Vault data, not company filings. Check any figure before relying on it. Sentences marked "(background)" come from the model’s general knowledge and may be out of date. The analyst consensus is what the named sources published, not a recommendation from Vault. Information, not advice.';
// The report as one Markdown document: heading, body, numbered sources (so the [n] citations still resolve), disclaimer.
const reportMarkdown = (w, r) => [
  `# ${w.symbol} (${w.exchange})${w.name ? ` · ${w.name}` : ''}`,
  `Research report · ${fmtWhen(r.createdAt)}${r.priceAtReport ? ` · price then ${r.priceAtReport}` : ''}`,
  r.markdown,
  r.sources?.length ? `## Sources\n\n${r.sources.map((s, i) => `${i + 1}. [${s.title || s.url}](${s.url}) ${s.source || ''}`).join('\n')}` : '',
  `_${DISCLAIMER}_`,
].filter(Boolean).join('\n\n');
const fmtQuote = (q) => (q ? `${q.currency} ${Number(q.price).toLocaleString('en-AU', { maximumFractionDigits: 2 })}` : '—');

export default function SharesWatchlistTab({ onWriteThesis }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null); // watch id
  const [adding, setAdding] = useState(null); // the add form, when open
  const [saving, setSaving] = useState(false);
  const [reports, setReports] = useState([]);
  const [reportIdx, setReportIdx] = useState(0);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [editNote, setEditNote] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/shares/watchlist');
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || 'Could not load the watchlist');
      setItems(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load the watchlist');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const current = items.find((w) => w.id === selected) || null;
  const report = reports[reportIdx] || null;

  const loadReports = useCallback(async (id) => {
    try {
      const res = await api.get(`/api/shares/watchlist/${id}/reports`);
      const data = await res.json().catch(() => []);
      setReports(res.ok && Array.isArray(data) ? data : []);
    } catch {
      setReports([]);
    }
    setReportIdx(0);
    setReportsLoading(false);
  }, []);
  useEffect(() => {
    setReportsLoading(!!selected);
    setConfirmDelete(false);
    setEditNote(null);
    setReports([]);
    if (selected) loadReports(selected);
  }, [selected, loadReports]);

  const add = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await api.post('/api/shares/watchlist', adding);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not add');
      setAdding(null);
      await load();
      setSelected(data.id);
      addToast(`${data.symbol} added to your watchlist`, 'success');
    } catch (err) {
      addToast(err.message || 'Could not add', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveNote = async () => {
    try {
      const res = await api.put(`/api/shares/watchlist/${current.id}`, { name: current.name, note: editNote });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      setEditNote(null);
      await load();
    } catch (err) {
      addToast(err.message || 'Save failed', 'error');
    }
  };

  const research = async () => {
    if (!current) return;
    startProcessing(`Researching ${current.symbol}…`, 'Searching the web, reading the quote and reported figures, your holdings and your investor profile, then writing the report and pulling out its key figures. This can take two or three minutes.');
    try {
      const res = await api.post(`/api/shares/watchlist/${current.id}/research`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Research failed');
      await Promise.all([load(), loadReports(current.id)]);
    } catch (err) {
      addToast(err.message || 'Research failed', 'error');
    } finally {
      stopProcessing();
    }
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportMarkdown(current, report));
      addToast('Report copied as Markdown', 'success');
    } catch {
      addToast('Could not copy the report', 'error');
    }
  };
  const downloadReport = () => downloadBlob(
    new Blob([reportMarkdown(current, report)], { type: 'text/markdown;charset=utf-8' }),
    `${current.symbol}-${current.exchange}-research-${new Date(report.createdAt).toLocaleDateString('en-CA')}.md`, // en-CA = local YYYY-MM-DD, matching the date shown
  );

  const remove = async () => {
    if (!current) return;
    try {
      const res = await api.delete(`/api/shares/watchlist/${current.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setSelected(null);
      await load();
      offerUndo({ message: `${current.symbol} removed. Kept 30 days with its reports.`, binIds: data.binId, after: load });
    } catch (err) {
      addToast(err.message || 'Delete failed', 'error');
    }
  };

  const card = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
  const field = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
  const btnPrimary = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
  const btnGhost = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
  const btnCls = 'text-sm px-3 py-1.5 rounded-md hover:opacity-70 transition-opacity duration-200 disabled:opacity-40';

  if (loading) {
    return <div className="space-y-2 max-w-3xl" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: 'var(--color-surface)' }} />)}</div>;
  }

  const structured = report && isUsableStructured(report.structured) ? report.structured : null;
  const peak = structured?.price ? peakBar(structured.price.current, structured.price.yearHigh) : null;
  const picker = reports.length > 1 ? (
    <Tooltip text="Read an earlier report.">
      <select value={reportIdx} onChange={(e) => setReportIdx(Number(e.target.value))} aria-label="Pick a report" className="text-xs px-2 py-1 rounded-md border" style={field}>
        {reports.map((r, i) => <option key={r.id} value={i}>{fmtWhen(r.createdAt)}{i === 0 ? ' (latest)' : ''}</option>)}
      </select>
    </Tooltip>
  ) : report ? <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Report · {fmtWhen(report.createdAt)}</span> : null;
  const sourcesBlock = report ? (
    <div className="rounded-2xl border p-5 mt-0" style={card}>
      {report.sources?.length > 0 && (
        <details id="wl-sec-sources" className="scroll-mt-4">
          <summary className="text-sm font-semibold cursor-pointer hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-text)' }}>Sources ({report.sources.length})</summary>
          <ol className="mt-2 space-y-1 text-xs list-decimal pl-5" style={{ color: 'var(--color-text)' }}>
            {report.sources.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-70 transition-opacity duration-200">{s.title || s.url}</a> <span style={{ color: 'var(--color-muted)' }}>{s.source}</span></li>)}
          </ol>
        </details>
      )}
      <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{DISCLAIMER}</p>
    </div>
  ) : null;

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="max-w-[1700px]" data-tour="shares-watchlist">
        <div className="mb-5">
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Companies you are researching</p>
          <p className="text-xs mt-0.5 max-w-3xl" style={{ color: 'var(--color-muted)' }}>
            Companies you are looking at but do not hold. Research writes a dated report on the business, its moat, figures, valuation and risks, an analyst consensus (the Buy / Hold / Sell majority of ratings from at least five named sources where found), and a final summary arguing whether it fits your profile and holdings. Vault never says how much to buy.
          </p>
        </div>
        {error && <p className="text-xs mb-3 px-3 py-2 rounded-md" style={{ background: '#fff1f2', color: BAD }}>{error}</p>}

        <div className="grid gap-6 xl:grid-cols-[1fr_340px] items-start">
          <div className="space-y-2 xl:order-2">
            {items.map((w) => (
              <button
                key={w.id} type="button" onClick={() => { setSelected(w.id); setAdding(null); }}
                className="w-full text-left px-3 py-2.5 rounded-lg border hover:opacity-70 transition-opacity duration-200"
                style={{ ...card, outline: selected === w.id ? '2px solid var(--color-primary)' : 'none' }}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{w.symbol}<span className="text-xs ml-1" style={{ color: 'var(--color-muted)' }}>{w.exchange}</span></span>
                  <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                    {fmtQuote(w.quote)}
                    {w.quote?.changePct != null && <span className="text-xs ml-1" style={{ color: w.quote.changePct < 0 ? BAD : 'var(--color-muted)' }}>{w.quote.changePct >= 0 ? '+' : ''}{w.quote.changePct.toFixed(2)}%</span>}
                  </span>
                </span>
                <span className="block text-xs mt-1 truncate" style={{ color: 'var(--color-muted)' }}>
                  {w.name ? `${w.name} · ` : ''}{w.lastReportAt ? `Report ${fmtWhen(w.lastReportAt)}` : 'Not researched yet'}
                </span>
              </button>
            ))}
            <Tooltip text="Add a company by its ticker. Quotes refresh every 15 minutes for US shares and every 6 hours for ASX (to save the daily ASX quote allowance).">
              <button type="button" onClick={() => { setAdding({ symbol: '', exchange: 'NASDAQ', name: '', note: '' }); setSelected(null); }} className={`${btnCls} border w-full mt-2`} style={btnGhost}>Add a company</button>
            </Tooltip>
          </div>

          <div className="min-w-0 xl:order-1">
            {adding && (
              <div className="rounded-xl border p-4 space-y-3" style={card}>
                <div className="flex flex-wrap gap-2">
                  <label className="text-xs w-32" style={{ color: 'var(--color-muted)' }}>Ticker
                    <input value={adding.symbol} onChange={(e) => setAdding({ ...adding, symbol: e.target.value.toUpperCase() })} placeholder="CRWD" className="block w-full mt-1 px-3 py-2 rounded-lg border text-sm" style={field} />
                  </label>
                  <label className="text-xs w-32" style={{ color: 'var(--color-muted)' }}>Exchange
                    <select value={adding.exchange} onChange={(e) => setAdding({ ...adding, exchange: e.target.value })} className="block w-full mt-1 px-3 py-2 rounded-lg border text-sm" style={field}>
                      <option>NASDAQ</option><option>NYSE</option><option>ASX</option>
                    </select>
                  </label>
                  <div className="text-xs flex-1 min-w-[12rem]" style={{ color: 'var(--color-muted)' }}>Company name (optional, helps the web search)
                    <div className="mt-1"><VoiceInput value={adding.name} onChange={(v) => setAdding({ ...adding, name: v })} placeholder="CrowdStrike" label="Company name" /></div>
                  </div>
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Why are you looking at it? (optional; the report reads this)</p>
                  <VoiceInput type="textarea" append rows={2} value={adding.note} onChange={(v) => setAdding({ ...adding, note: v })} placeholder="e.g. Want cybersecurity exposure; worried about the valuation and the Zscaler deal." label="Why you are looking at it" />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={add} disabled={saving || !adding.symbol.trim()} className={btnCls} style={btnPrimary}>{saving ? 'Adding…' : 'Add to watchlist'}</button>
                  <button type="button" onClick={() => setAdding(null)} className={`${btnCls} border`} style={btnGhost}>Cancel</button>
                </div>
              </div>
            )}

            {!adding && current && (
              <div className="space-y-5">
                <section className="rounded-2xl border p-5 space-y-4" style={card}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>{current.name || current.symbol}</h2>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{current.symbol} · {current.exchange}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Tooltip text="Write a new dated report: web search, the live quote, reported figures for US shares, your holdings and your investor profile (Settings → Shares). Two AI calls: the report, then its key figures for the charts. Earlier reports are kept and the new one says what changed.">
                        <button type="button" onClick={research} className={btnCls} style={btnPrimary}>{reports.length ? 'Research again' : 'Research'}</button>
                      </Tooltip>
                      {onWriteThesis && (
                        <Tooltip text="Open the Thesis tab with this company, to write down why you would own it and what would prove you wrong.">
                          <button type="button" onClick={() => onWriteThesis(current.symbol, current.exchange)} className={`${btnCls} border`} style={btnGhost}>Write a thesis</button>
                        </Tooltip>
                      )}
                      <Tooltip text={report ? 'Download this report, with its sources, as a Markdown (.md) file.' : 'Run a report first.'}>
                        <button type="button" onClick={downloadReport} disabled={!report} className={`${btnCls} border inline-flex items-center gap-1`} style={btnGhost}>{getIcon('download', { size: 14 })} Download</button>
                      </Tooltip>
                      {confirmDelete ? (
                        <span className="text-sm" style={{ color: 'var(--color-text)' }}>Remove? <button type="button" onClick={remove} className="underline hover:opacity-60 transition-opacity duration-200" style={{ color: BAD }}>Yes</button> / <button type="button" onClick={() => setConfirmDelete(false)} className="underline hover:opacity-60 transition-opacity duration-200">No</button></span>
                      ) : (
                        <Tooltip text="More: copy the report, or remove this company.">
                          <span><OverflowMenu title="More actions" actions={[
                            { label: 'Copy report as Markdown', icon: 'copy', disabled: !report, onClick: copyReport },
                            { label: 'Remove from watchlist', icon: 'trash', danger: true, onClick: () => setConfirmDelete(true) },
                          ]} /></span>
                        </Tooltip>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                    {current.quote && <div>
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Price now</p>
                      <p className="flex flex-wrap items-baseline gap-2">
                        <span className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtQuote(current.quote)}</span>
                        {current.quote?.changePct != null && (
                          <ToneBadge tone={current.quote.changePct > 0 ? 'gain' : current.quote.changePct < 0 ? 'loss' : 'neutral'}>{fmtPct(current.quote.changePct, 2)} today</ToneBadge>
                        )}
                      </p>
                    </div>}
                    {report?.priceAtReport && (
                      <div>
                        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>At the report, {fmtWhen(report.createdAt)}</p>
                        <p className="text-lg font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{report.priceAtReport}</p>
                      </div>
                    )}
                    {peak && (
                      <div className="flex-1 min-w-[14rem] max-w-md">
                        <Tooltip text="Price at the report against the highest price of the past year (Finnhub). Shown for US shares only.">
                          <p className="text-xs inline-block" style={{ color: 'var(--color-muted)' }}>
                            {fmtPct(peak.fromHighPct)} from the 1-year high of {fmtMoney(structured.price.yearHigh, structured.price.currency)}{structured.price.yearHighDate ? ` (${fmtWhen(structured.price.yearHighDate)})` : ''}
                          </p>
                        </Tooltip>
                        <div className="h-2 mt-1.5 rounded-full" style={{ background: 'var(--chart-grid)' }} role="img" aria-label={`Price at the report is ${fmtPct(peak.fromHighPct)} from the 1-year high`}>
                          <div className="h-2 rounded-full" style={{ width: `${peak.fillPct}%`, background: 'var(--chart-1)' }} />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl p-3" style={{ background: 'var(--color-bg)' }}>
                    <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Your research question</p>
                    {editNote == null ? (
                      <p className="text-sm" style={{ color: current.note ? 'var(--color-text)' : 'var(--color-muted)' }}>
                        {current.note || 'No note on why you are looking at it.'}{' '}
                        <Tooltip text="Edit why you are looking at this company. The next report reads it."><button type="button" onClick={() => setEditNote(current.note || '')} className="text-xs hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }}>Edit</button></Tooltip>
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <VoiceInput type="textarea" append rows={2} value={editNote} onChange={setEditNote} label="Why you are looking at it" />
                        <div className="flex gap-2">
                          <Tooltip text="Save the question. The next report reads it."><button type="button" onClick={saveNote} className={btnCls} style={btnPrimary}>Save</button></Tooltip>
                          <Tooltip text="Keep the question as it was."><button type="button" onClick={() => setEditNote(null)} className={`${btnCls} border`} style={btnGhost}>Cancel</button></Tooltip>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {reportsLoading && <div className="space-y-3" aria-busy="true">{[0, 1].map((i) => <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: 'var(--color-surface)' }} />)}</div>}

                {!reportsLoading && report && (structured ? (
                  <SharesWatchlistReport s={structured} sources={report.sources || []} picker={picker}>
                    <details className="rounded-2xl border p-5" style={card} open>
                      <summary className="text-sm font-semibold cursor-pointer hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-text)' }}>Full written report</summary>
                      <div className="prose max-w-none text-sm mt-3">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{report.markdown}</ReactMarkdown>
                      </div>
                    </details>
                    {sourcesBlock}
                  </SharesWatchlistReport>
                ) : (
                  <div className="rounded-2xl border p-5" style={card}>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Report · {fmtWhen(report.createdAt)}{report.priceAtReport ? ` · price then ${report.priceAtReport}` : ''}</p>
                      {picker}
                    </div>
                    <div className="prose max-w-none text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{report.markdown}</ReactMarkdown>
                    </div>
                    {sourcesBlock}
                  </div>
                ))}
                {!reportsLoading && !report && (
                  <EmptyState
                    icon="info" title="No report yet"
                    body="Press Research to write the first one. For a report that fits you, fill in your investor profile in Settings → Shares."
                  />
                )}
              </div>
            )}

            {!adding && !current && (
              <EmptyState
                icon="info"
                title={items.length ? 'Pick a company on the left' : 'Your watchlist is empty'}
                body={items.length ? 'Open a company to read or run its research report.' : 'Add a company by its ticker, then press Research for a report on the business, its figures and how it fits your profile.'}
                action={!items.length ? <button type="button" onClick={() => setAdding({ symbol: '', exchange: 'NASDAQ', name: '', note: '' })} className={`${btnCls} inline-flex items-center gap-1`} style={btnPrimary}>{getIcon('plus', { size: 14 })} Add a company</button> : null}
              />
            )}
          </div>
        </div>
      </div>
    </VoiceInputProvider>
  );
}
