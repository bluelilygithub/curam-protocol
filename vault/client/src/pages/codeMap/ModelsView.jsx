import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { ExportButton, Pill, SEV_COLOR, card, fmt, fmtSecs, fmtWhen } from './shared';
import { datedName } from './exportRun.mjs';
import { modelActions, modelsByRole, modelsCsv, modelsHtml, modelsMd, modelsSheets } from './exportModels.mjs';

// Code Map "Models" tab: which model each tool uses (default tier, backup, dedicated), how its calls went in the last 30 days, and what to
// change. Recommendations only; the admin swaps a model in Settings. Server: server/services/codeMap/models/ (GET /api/code-map/models,
// POST /api/code-map/models/run). Docs: docs/code-map.md "Models".

const toast = (message, type = 'error') => useToastStore.getState().addToast(message, type);
const BTN = 'text-sm font-medium px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 hover:opacity-70 transition-opacity duration-200 disabled:opacity-50';
const SEVS = ['high', 'medium', 'low'];
const KIND_WORD = {
  capabilityMismatch: 'Capability', hardcodedModel: 'Hardcoded id', unavailableModel: 'Unavailable', backupOften: 'Backup often',
  highErrorRate: 'Errors', newerModel: 'Newer model', cheaperTier: 'Trial light',
};
const pct = (r) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);
const usd = (n) => (n == null ? '—' : `US$${Number(n).toFixed(n < 1 ? 4 : 2)}`);

// Where each model is chosen. Tiers and most job models are on Settings → Models; some tools have their own section or page.
const SETTINGS_FOR_KEY = {
  topic_research_model: '/settings?tab=Topic%20Research', topic_research_review_model: '/settings?tab=Topic%20Research',
  email_follow_up_ask_model: '/settings?tab=Email%20Follow-Up', pdf_html_model: '/settings?tab=PDF%20Tools',
  translate_model: '/settings?tab=Translation', translate_review_model: '/settings?tab=Translation',
  product_scout_model: '/settings?tab=Amazon%20Search', gmail_pdf_model: '/settings?tab=Integrations',
  skill_scan_model: '/skill-scan', news_digest_primary_model: '/news-digest', news_digest_fallback_model: '/news-digest',
};
const settingsPath = (via) => SETTINGS_FOR_KEY[String(via || '').replace('setting:', '')] || '/settings?tab=Models';

function Chips({ findings }) {
  if (!findings.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {findings.map((f, i) => <Pill key={i} color={SEV_COLOR[f.severity]} tip={f.title}>{KIND_WORD[f.kind] || f.kind}</Pill>)}
    </span>
  );
}

function FindingCard({ f }) {
  return (
    <li className="rounded-xl border p-3 space-y-1" style={{ ...card, borderLeft: `4px solid ${SEV_COLOR[f.severity]}` }}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill color={SEV_COLOR[f.severity]}>{f.severity}</Pill>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{f.title}</span>
      </div>
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{f.detail}</p>
      <details className="text-xs" style={{ color: 'var(--color-muted)' }}>
        <summary className="cursor-pointer hover:opacity-70 transition-opacity duration-200">Evidence</summary>
        <pre className="mt-1 whitespace-pre-wrap break-all font-mono">{JSON.stringify(f.evidence, null, 1)}</pre>
      </details>
    </li>
  );
}

// Who wrote a summary part: the light model (its numbers checked against the evidence) or the app.
function SummaryText({ part, className = 'text-sm' }) {
  if (!part?.text) return null;
  return (
    <p className={`${className} leading-relaxed`} style={{ color: 'var(--color-text)' }}>
      {part.text}
      {part.source === 'model'
        ? <Tooltip text="Written by the light AI model from this report's evidence; every number in it was checked against the evidence."><span className="ml-1 text-[11px] align-middle" style={{ color: 'var(--color-muted)' }} tabIndex={0}>(AI, figures checked)</span></Tooltip>
        : null}
    </p>
  );
}

function ToolDetailRow({ t, colSpan, summary }) {
  const getIcon = useIcon();
  const s = t.stats;
  const needs = t.needs || {};
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 pb-4" style={{ background: 'var(--color-bg)' }}>
        <div className="grid gap-4 lg:grid-cols-2 pt-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Models and how each was chosen</p>
            <ul className="space-y-2">
              {t.models.map((m, i) => (
                <li key={i} className="text-xs rounded-lg border p-2" style={card}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span style={{ color: 'var(--color-text)' }}><strong>{m.role}</strong> · {m.via.replace('tier:', 'tier ').replace('setting:', 'setting ')} · <code>{m.modelId || 'none'}</code></span>
                    <Tooltip text="Open the place in Vault where this model is chosen.">
                      <Link to={settingsPath(m.via)} className="flex items-center gap-1 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-primary)' }}>
                        Open in Settings {getIcon('external-link', { size: 11 })}
                      </Link>
                    </Tooltip>
                  </div>
                  <div className="mt-1" style={{ color: 'var(--color-muted)' }}>{m.resolvedFrom}</div>
                  {m.capabilities && (
                    <div className="mt-1" style={{ color: 'var(--color-muted)' }}>
                      Vision {m.capabilities.vision == null ? 'unknown' : m.capabilities.vision ? 'yes' : 'no'} · context {m.capabilities.context == null ? 'unknown' : fmt(m.capabilities.context)} · JSON {m.capabilities.json == null ? 'unknown' : m.capabilities.json ? 'yes' : 'no'}
                      {m.capabilities.source === 'family' ? ' (guessed from the model family)' : ''}
                      {m.price ? ` · $${m.price.input}/$${m.price.output} per M tokens${m.price.priced ? '' : ' (estimated)'}` : ''}
                      {m.providerKey === false ? ` · ${m.provider} key not set` : ''}
                    </div>
                  )}
                </li>
              ))}
              {!t.models.length && <li className="text-xs" style={{ color: 'var(--color-muted)' }}>No model choice found in this tool's own code (it picks one in shared code).</li>}
            </ul>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Declared needs: vision {needs.vision ? 'yes' : 'no'} · JSON {needs.json ? 'yes' : 'no'} · context {needs.minContext ? fmt(needs.minContext) : 'no minimum'} · {needs.mode || 'interactive'}
              {t.needsDeclared ? '' : ' (not declared: add it to server/config/modelNeeds.js)'}
            </p>
          </div>
          <div className="space-y-2">
            <SummaryText part={summary} />
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Last 30 days</p>
            {s ? (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                {fmt(s.calls)} calls, {fmt(s.errors)} failed · {usd(s.costUsd)} total, {usd(s.avgCostUsd)} each · about {fmt(s.avgInputTokens)} tokens in, {fmt(s.avgOutputTokens)} out ·
                median {s.medianMs == null ? '—' : fmtSecs(s.medianMs)}, p90 {s.p90Ms == null ? '—' : fmtSecs(s.p90Ms)} ({fmt(s.timedCalls)} timed) · backup used {fmt(s.fallbacks)} times
              </p>
            ) : <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No calls logged in the last 30 days.</p>}
            {t.notEnoughData && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Not enough data (fewer than 20 calls): no error, backup or cost findings for this tool yet.</p>}
            {t.findings.length > 0 && <ul className="space-y-2">{t.findings.map((f, i) => <FindingCard key={i} f={f} />)}</ul>}
          </div>
        </div>
      </td>
    </tr>
  );
}

// Excel: the xlsx package is loaded only when this button is pressed, so it stays out of the page bundle.
async function downloadXlsx(data, tools, name) {
  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    for (const [sheet, rows] of Object.entries(modelsSheets(data, tools))) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
    XLSX.writeFile(wb, name);
  } catch (err) {
    toast(err.message || 'The Excel file could not be built.');
  }
}

function printHtml(html) {
  const w = window.open('', '_blank');
  if (!w) { toast('Pop-ups are blocked. Allow pop-ups to print or save as PDF.'); return; }
  w.document.write(html); w.document.close(); w.focus(); w.print();
}


// What to do: one plain action per finding, built in code (exportModels.mjs modelActions), most urgent first.
function ActionList({ actions }) {
  return (
    <section className="rounded-2xl border p-5 space-y-2" style={card} data-guide="models-actions">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>What to do</h3>
      {!actions.length ? <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Nothing to do: no findings.</p> : (
        <ol className="space-y-1.5 list-decimal pl-5">
          {actions.map((a, i) => (
            <li key={i} className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
              <Pill color={SEV_COLOR[a.severity]} tip={a.why}>{a.priority}</Pill>{' '}
              {a.action}
              {a.via && <> <Link to={settingsPath(a.via)} className="text-xs hover:opacity-70" style={{ color: 'var(--color-primary)' }}>Open in Settings</Link></>}
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Built from the findings by the app, not the AI. Hover a priority for the evidence. Nothing has been changed.</p>
    </section>
  );
}

export default function ModelsView() {
  const getIcon = useIcon();
  const [report, setReport] = useState(undefined); // undefined while loading, null before the first check
  const [running, setRunning] = useState(false);
  const [onlyFindings, setOnlyFindings] = useState(false);
  const [sev, setSev] = useState('all');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let live = true;
    api.get('/api/code-map/models')
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'The Models report could not be loaded.'); return d; })
      .then((d) => { if (live) setReport(d.report || null); })
      .catch((err) => { if (live) { setReport(null); toast(err.message); } });
    return () => { live = false; };
  }, []);

  const runCheck = async () => {
    setRunning(true);
    try {
      const r = await api.post('/api/code-map/models/run', {});
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'The check could not run.');
      setReport(d.report);
      const c = d.report.result.counts;
      toast(`Models check done: ${c.high} high, ${c.medium} medium, ${c.low} low.`, 'success');
    } catch (err) {
      toast(err.message || 'The check could not run.');
    } finally {
      setRunning(false);
    }
  };

  const data = report?.result;
  const tools = useMemo(() => (data?.tools || []).filter((t) => {
    const f = sev === 'all' ? t.findings : t.findings.filter((x) => x.severity === sev);
    return onlyFindings || sev !== 'all' ? f.length > 0 : true;
  }).sort((a, b) => b.findings.length - a.findings.length || (b.stats?.calls || 0) - (a.stats?.calls || 0)), [data, onlyFindings, sev]);
  const workspace = (data?.workspaceFindings || []).filter((f) => sev === 'all' || f.severity === sev);
  const actions = useMemo(() => (data ? modelActions(data) : []), [data]);

  if (report === undefined) return <Skeleton lines={6} className="h-10" label="Loading the Models report" />;

  const COLS = 10;
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border p-5" style={card} data-guide="run-models-check" data-tour="cm-models">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-3xl">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Which model each tool uses, and how it is doing</h2>
            <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
              The default, backup and dedicated models of every tool, what the tool needs, and the last 30 days of its calls. It recommends only: nothing in Settings changes. High and medium findings also go to your Suggestions inbox, once each.
            </p>
            <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
              {data
                ? <>Checked {fmtWhen(report.createdAt)} · usage {data.range.from} to {data.range.to} · {data.counts.high} high, {data.counts.medium} medium, {data.counts.low} low · took {fmtSecs(report.durationMs)}. Also runs every Sunday after the analysis.</>
                : 'Not checked yet.'}
            </p>
          </div>
          <Tooltip text={running ? 'Checking. It takes a few seconds.' : 'Check every tool now from Settings, the code and the last 30 days of usage (plain code), then one light-model call writes the summary, its numbers checked against the evidence. Counts towards the AI rate limit. Needs a Code Map analysis run first.'}>
            <button type="button" onClick={runCheck} disabled={running} className={BTN} style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
              {getIcon(running ? 'loader' : 'play', { size: 14, className: running ? 'animate-spin' : undefined })}{running ? 'Checking…' : 'Run check'}
            </button>
          </Tooltip>
        </div>
      </section>

      {data?.summary && (
        <section className="rounded-2xl border p-5 space-y-2" style={card}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>In short</h3>
          <SummaryText part={data.summary.overall} />
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{data.summary.reason}</p>
        </section>
      )}

      {data && <ActionList actions={actions} />}

      {!data ? (
        <EmptyState icon="code-map" title="No models check yet" body="Run check reads which model each tool uses and how its calls went. It needs a Code Map analysis run first." />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Tooltip text="Show only the tools that have at least one finding.">
                <label className="text-xs flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--color-text)' }}>
                  <input type="checkbox" checked={onlyFindings} onChange={(e) => setOnlyFindings(e.target.checked)} /> Has findings
                </label>
              </Tooltip>
              <Tooltip text="Show only findings of this severity (and the tools that have one).">
                <select value={sev} onChange={(e) => setSev(e.target.value)} aria-label="Severity" className="text-xs px-2 py-1 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
                  <option value="all">All severities</option>
                  {SEVS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)} ({data.counts[s]})</option>)}
                </select>
              </Tooltip>
            </div>
            <div className="flex flex-wrap gap-2">
              <ExportButton label="Copy findings" what="Models report" getText={() => modelsMd(data, tools)} tip="Copy the summary, what to do, the findings and the tools shown as Markdown." />
              <ExportButton kind="download" label="Markdown" name={datedName('vault-models', 'md', report.createdAt)} getText={() => modelsMd(data, tools)} tip="The summary, what to do, the findings and the tools shown, as a .md file." />
              <ExportButton kind="download" label="Excel" onClick={() => downloadXlsx(data, tools, datedName('vault-models', 'xlsx', report.createdAt))} tip="An Excel workbook with three sheets: What to do, Findings, and the tools shown." />
              <ExportButton kind="download" label="CSV" name={datedName('vault-models', 'csv', report.createdAt)} type="text/csv" getText={() => modelsCsv(data, tools)} tip="The tools shown, one row each, as a spreadsheet file." />
              <ExportButton kind="download" label="HTML" name={datedName('vault-models', 'html', report.createdAt)} type="text/html" getText={() => modelsHtml(data, tools)} tip="A web page of the summary, what to do and the tools shown. Opens in a browser or Word." />
              <ExportButton kind="download" label="Print / PDF" onClick={() => printHtml(modelsHtml(data, tools))} tip="Open a printable copy. Choose Save as PDF in the print dialog to keep a PDF." />
              <ExportButton kind="download" label=".json" name={datedName('vault-models', 'json', report.createdAt)} type="application/json" getText={() => JSON.stringify(data, null, 1)} tip="The whole report exactly as stored." />
            </div>
          </div>

          {workspace.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Across the workspace</h3>
              <ul className="space-y-2">{workspace.map((f, i) => <FindingCard key={i} f={f} />)}</ul>
            </section>
          )}

          {!tools.length ? (
            <EmptyState icon="check" title="Nothing to show" body="No tool matches these filters." />
          ) : (
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs" style={{ color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
                    {['Tool', 'Default', 'Backup', 'Dedicated', 'Calls (30d)', 'Cost', 'Median', 'Errors', 'Backup used', 'Findings'].map((h) => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {tools.map((t) => {
                    const m = modelsByRole(t);
                    const s = t.stats || {};
                    const isOpen = open === t.tool;
                    const shown = sev === 'all' ? t.findings : t.findings.filter((f) => f.severity === sev);
                    return (
                      <React.Fragment key={t.tool}>
                        <tr className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <Tooltip text={isOpen ? 'Hide the evidence.' : 'Show how each model was chosen, the numbers and the evidence.'}>
                              <button type="button" onClick={() => setOpen(isOpen ? null : t.tool)} aria-expanded={isOpen} className="flex items-center gap-1 font-medium hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-text)' }}>
                                {getIcon(isOpen ? 'chevron-down' : 'chevron-right', { size: 13 })}{t.label}
                              </button>
                            </Tooltip>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--color-text)' }}>{m.default.join(', ') || '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--color-text)' }}>{m.backup.join(', ') || '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--color-text)' }}>{m.dedicated.join(', ') || '—'}</td>
                          <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>{fmt(s.calls || 0)}{t.notEnoughData ? <span style={{ color: 'var(--color-muted)' }}> · too few</span> : null}</td>
                          <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>{usd(s.costUsd)}</td>
                          <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>{s.medianMs == null ? '—' : fmtSecs(s.medianMs)}</td>
                          <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>{pct(s.errorRate)}</td>
                          <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text)' }}>{pct(s.backupRate)}</td>
                          <td className="px-3 py-2"><Chips findings={shown} /></td>
                        </tr>
                        {isOpen && <ToolDetailRow t={t} colSpan={COLS} summary={data.summary?.tools?.[t.tool]} />}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {(data.notes?.unmappedFeatures?.length > 0 || data.notes?.unattributedErrors > 0) && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              {data.notes.unmappedFeatures.length > 0 && <>Usage logged under features no tool claims (add them to server/config/modelNeeds.js): {data.notes.unmappedFeatures.join(', ')}. </>}
              {data.notes.unattributedErrors > 0 && <>{fmt(data.notes.unattributedErrors)} failed calls could not be traced to a tool.</>}
            </p>
          )}
        </>
      )}
    </div>
  );
}
