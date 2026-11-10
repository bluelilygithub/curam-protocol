import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import EmptyState from '../components/EmptyState';
import Dialog from '../components/Dialog';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import PageSpeedTutorChat from './pageSpeed/PageSpeedTutorChat';
import { HOW_IT_WORKS, GUIDE_TOOLS } from './pageSpeed/pageSpeedTools.mjs';
import {
  buildActions, actionsText, PRIORITY_GROUPS, CATEGORY_FILTERS, humanEvidence, cleanLighthouseText,
  METRIC_HELP, FIELD_HELP, FIELD_CATEGORY_HELP, SECTION_HELP,
} from './pageSpeed/pageSpeedActions.mjs';

const FIELD = {
  background: 'var(--color-bg)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};

// "Done" ticks used to live only in this browser (before they were saved on the run). Read once so old ticks move to the server.
function legacyDoneKey(auditId, view) {
  return `vault:pagespeed-done:${auditId}:${view}`;
}
function readLegacyDone(auditId, view) {
  try {
    const raw = localStorage.getItem(legacyDoneKey(auditId, view));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((k) => typeof k === 'string') : [];
  } catch { return []; }
}
function clearLegacyDone(auditId, view) {
  try { localStorage.removeItem(legacyDoneKey(auditId, view)); } catch { /* ignore */ }
}

function fmtShortDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// A note on one action ("what was done"), saved when the box loses focus.
function ActionNote({ value, onSave, done }) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { setDraft(value || ''); }, [value]);
  return (
    <Tooltip text="Optional: say what was done (or what is in progress). Saved with the run and printed in the PDF report.">
      <div>
        <VoiceInput
          value={draft}
          onChange={setDraft}
          onBlur={() => { if ((draft || '').trim() !== (value || '').trim()) onSave(draft); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          placeholder={done ? 'What was done? (optional)' : 'Add a note (optional)'}
          label="Note on this action"
          className="!py-1.5 !text-xs"
        />
      </div>
    </Tooltip>
  );
}

const PDF_DEFAULTS = { devices: ['mobile', 'desktop'], which: 'all', includeScores: true, includeDeveloper: false, title: '', preparedFor: '', preparedBy: '', summary: '' };

function PdfReportDialog({ audit, onClose, onBuild }) {
  const [opts, setOpts] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('vault:pagespeed-pdf-opts') || '{}');
      return { ...PDF_DEFAULTS, preparedBy: saved.preparedBy || '', includeDeveloper: !!saved.includeDeveloper, which: saved.which || 'all' };
    } catch { return { ...PDF_DEFAULTS }; }
  });
  const set = (k, v) => setOpts((o) => ({ ...o, [k]: v }));
  const has = { mobile: !!audit?.report?.mobile, desktop: !!audit?.report?.desktop };
  const devices = opts.devices.filter((d) => has[d]);
  const toggleDevice = (d) => set('devices', opts.devices.includes(d) ? opts.devices.filter((x) => x !== d) : [...opts.devices, d]);
  const radio = (name, value, label, tip) => (
    <Tooltip key={value} text={tip}>
      <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
        <input type="radio" name={name} checked={opts.which === value} onChange={() => set('which', value)} />
        {label}
      </label>
    </Tooltip>
  );
  const build = () => {
    try { localStorage.setItem('vault:pagespeed-pdf-opts', JSON.stringify({ preparedBy: opts.preparedBy, includeDeveloper: opts.includeDeveloper, which: opts.which })); } catch { /* ignore */ }
    onBuild({ ...opts, devices });
  };
  return (
    <Dialog
      title="PDF report"
      onClose={onClose}
      size="lg"
      footer={(
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity duration-200 hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
          <Tooltip text={devices.length ? 'Build the PDF and download it.' : 'Pick at least one device.'}>
            <button
              type="button"
              disabled={!devices.length}
              onClick={build}
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
              style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}
            >
              Download PDF
            </button>
          </Tooltip>
        </div>
      )}
    >
      <div className="space-y-4" data-guide="pdf-report">
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          A formatted report of this run to send to a client, a manager or a developer: scores, timings and the plain-English action list, with your ticks, done dates and notes.
        </p>
        <div className="space-y-1.5">
          <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Devices</p>
          <div className="flex gap-4">
            {['mobile', 'desktop'].map((d) => (
              <Tooltip key={d} text={has[d] ? `Include the ${d} test.` : `This run has no ${d} result.`}>
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: has[d] ? 'var(--color-text)' : 'var(--color-muted)' }}>
                  <input type="checkbox" disabled={!has[d]} checked={has[d] && opts.devices.includes(d)} onChange={() => toggleDevice(d)} />
                  {d === 'mobile' ? 'Mobile' : 'Desktop'}
                </label>
              </Tooltip>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Which actions</p>
          <div className="flex flex-wrap gap-4">
            {radio('which', 'all', 'All (ticked and not)', 'Every action, with a ticked box for the ones marked done. Good for a progress report.')}
            {radio('which', 'outstanding', 'Still to do', 'Only actions not yet ticked. Good as a to-do list for a developer.')}
            {radio('which', 'done', 'Done only', 'Only ticked actions, with their dates and notes. Good for showing a client what has been fixed.')}
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <Tooltip text="Add the four scores, the lab timings and real-visitor data for each device, with a line on what each means.">
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={opts.includeScores} onChange={(e) => set('includeScores', e.target.checked)} />
              Scores and timings
            </label>
          </Tooltip>
          <Tooltip text="Add the technical version under each action (Google's wording, exact fix, files and page elements). Leave off for a client; turn on for a developer.">
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={opts.includeDeveloper} onChange={(e) => set('includeDeveloper', e.target.checked)} />
              Developer detail
            </label>
          </Tooltip>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Title (optional)</span>
            <VoiceInput value={opts.title} onChange={(v) => set('title', v)} placeholder={`Page speed report: ${audit?.name || ''}`} label="Report title" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Prepared for (optional)</span>
            <VoiceInput value={opts.preparedFor} onChange={(v) => set('preparedFor', v)} placeholder="Client or business name" label="Prepared for" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Prepared by (optional)</span>
            <VoiceInput value={opts.preparedBy} onChange={(v) => set('preparedBy', v)} placeholder="Your name or business" label="Prepared by" />
          </label>
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Summary at the top (optional)</span>
            <VoiceInput type="textarea" append rows={3} value={opts.summary} onChange={(v) => set('summary', v)} placeholder="A few lines for the reader, e.g. what has been fixed since the last report." label="Report summary" />
          </label>
        </div>
      </div>
    </Dialog>
  );
}

function SectionTitle({ children, tip, small = false }) {
  return (
    <div className="flex items-center gap-1.5">
      <p className={small ? 'text-xs font-semibold' : 'text-base font-semibold'} style={{ color: 'var(--color-text)' }}>{children}</p>
      {tip ? (
        <Tooltip text={tip}>
          <span className="inline-flex cursor-help" style={{ color: 'var(--color-muted)' }} tabIndex={0} aria-label={`About ${children}`}>
            <InfoGlyph />
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

function InfoGlyph() {
  const getIcon = useIcon();
  return getIcon('info', { size: 13 });
}

function Badge({ children, tip, strong = false }) {
  const el = (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider whitespace-nowrap"
      style={strong
        ? { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }
        : { background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
    >
      {children}
    </span>
  );
  return tip ? <Tooltip text={tip}>{el}</Tooltip> : el;
}

// "Where on the page": each flagged element or file in plain words (Link "logo" · in the header · goes to /contact).
function WhereList({ items }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 5);
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
        Where on the page <span className="font-normal" style={{ color: 'var(--color-muted)' }}>({items.length})</span>
      </p>
      <ul className="space-y-1">
        {shown.map((w, i) => (
          <li key={`${w.where}-${i}`} className="flex items-start gap-2 text-xs leading-relaxed">
            <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full" style={{ background: 'var(--color-primary)' }} />
            <span className="min-w-0 break-words">
              <span style={{ color: 'var(--color-text)' }}>{w.where}</span>
              {w.detail ? <span style={{ color: 'var(--color-muted)' }}> · {w.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {items.length > 5 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="text-xs transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

// The technical half of an action, laid out for a developer: Google's wording once, why each item failed once (not repeated per
// element), then each element with its code.
function DeveloperDetail({ a }) {
  const code = { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: '11px' };
  return (
    <div className="space-y-3 pl-4 border-l" style={{ borderColor: 'var(--color-border)' }}>
      <div className="space-y-1">
        <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{a.technicalTitleClean}</p>
        {a.technicalActionClean ? <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{a.technicalActionClean}</p> : null}
        {a.docsUrl ? (
          <a href={a.docsUrl} target="_blank" rel="noreferrer" className="text-xs transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
            Google's guide to this check
          </a>
        ) : null}
      </div>
      {a.flagged.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Why Google flagged {a.where.length > 1 ? 'these' : 'this'}</p>
          {a.flagged.map((groups, gi) => (
            <div key={gi} className="space-y-1.5">
              {groups.map((g) => (
                <div key={g.heading}>
                  <p className="text-[11px] font-medium" style={{ color: 'var(--color-muted)' }}>{g.heading}:</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {g.points.map((p) => <li key={p} className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>{p}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {a.where.some((w) => w.code.length) && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Code to look for</p>
          <ol className="space-y-2 list-decimal pl-5">
            {a.where.filter((w) => w.code.length).map((w, i) => (
              <li key={`${w.where}-${i}`} className="text-xs" style={{ color: 'var(--color-text)' }}>
                <span>{w.where}{w.detail ? <span style={{ color: 'var(--color-muted)' }}> · {w.detail}</span> : null}</span>
                {w.code.map((c) => (
                  <code key={c} className="block mt-0.5 px-2 py-1 rounded break-all" style={{ ...code, background: 'var(--color-bg)', color: 'var(--color-muted)' }}>{c}</code>
                ))}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function ActionsPanel({ actions, strategy, otherLabel, doneMap, onToggle, onNote, onCopy, onPdf }) {
  const done = useMemo(() => new Set(Object.entries(doneMap || {}).filter(([, v]) => v?.done).map(([k]) => k)), [doneMap]);
  const getIcon = useIcon();
  const [filter, setFilter] = useState('all');
  const [hideDone, setHideDone] = useState(false);
  const [openDetail, setOpenDetail] = useState(() => new Set());

  if (!actions.length) {
    return (
      <EmptyState
        icon="check"
        title={`Nothing to fix on ${strategy}`}
        body="Google found no failed checks or savings worth listing for this device. Run the test again after big site changes."
      />
    );
  }

  const counts = {};
  for (const a of actions) counts[a.category] = (counts[a.category] || 0) + 1;
  const doneCount = actions.filter((a) => done.has(a.key)).length;
  const pct = Math.round((doneCount / actions.length) * 100);
  const shown = actions.filter((a) => (filter === 'all' || a.category === filter) && (!hideDone || !done.has(a.key)));
  const toggleDetail = (key) => setOpenDetail((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-5 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionTitle tip="The findings from this test as a plain-English to-do list, most important first. The technical version for a developer is under each one.">
              {actions.length} action{actions.length === 1 ? '' : 's'} for {strategy}
            </SectionTitle>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
              {actions.filter((a) => a.priority === 'P0').length} to fix first. Each says what is wrong, why it matters, what to do and who usually does it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tooltip text="Copy this to-do list as plain text (with your ticks) to paste into an email or a task.">
              <button
                type="button"
                onClick={() => onCopy(actionsText(actions, { strategy, done }))}
                className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Copy action list
              </button>
            </Tooltip>
            <Tooltip text="Make a formatted PDF of this run (scores and actions with your ticks, dates and notes) to send to a client or developer.">
              <button
                type="button"
                onClick={onPdf}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70"
                style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}
              >
                {getIcon('download', { size: 14 })}
                PDF report
              </button>
            </Tooltip>
          </div>
        </div>
        <Tooltip text="How many of these actions are ticked as done. Ticks are saved with this run, so they show on any computer and in the PDF report. Run a new test to confirm a fix worked.">
          <div className="space-y-1">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg)' }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Actions done">
              <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, background: 'var(--color-primary)' }} />
            </div>
            <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{doneCount} of {actions.length} done</p>
          </div>
        </Tooltip>
        <div className="flex flex-wrap items-center gap-1.5" data-guide="action-filter">
          {CATEGORY_FILTERS.filter((c) => c.id === 'all' || counts[c.id]).map((c) => (
            <Tooltip key={c.id} text={c.id === 'all' ? 'Show every action.' : `Show only the actions that improve the ${c.label} score.`}>
              <button
                type="button"
                onClick={() => setFilter(c.id)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity duration-200 hover:opacity-70"
                style={filter === c.id
                  ? { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }
                  : { border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
              >
                {c.label} {c.id === 'all' ? actions.length : counts[c.id]}
              </button>
            </Tooltip>
          ))}
          <Tooltip text="Hide the actions you have ticked as done.">
            <label className="ml-auto flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
              Hide done
            </label>
          </Tooltip>
        </div>
      </div>

      {shown.length === 0 && (
        <EmptyState icon="check" title="Nothing left in this view" body="Every action here is done or filtered out. Change the filter or untick Hide done." />
      )}

      {PRIORITY_GROUPS.map((g) => {
        const rows = shown.filter((a) => a.priority === g.id);
        if (!rows.length) return null;
        return (
          <div key={g.id} className="space-y-2">
            <SectionTitle tip={g.tip}>{g.label} <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>({rows.length})</span></SectionTitle>
            <ul className="grid gap-3 xl:grid-cols-2">
              {rows.map((a, i) => {
                const isDone = done.has(a.key);
                const detailOpen = openDetail.has(a.key);
                const first = g.id === shown[0]?.priority && i === 0;
                return (
                  <li
                    key={a.key}
                    className="rounded-xl border p-4 space-y-2 transition-opacity duration-200"
                    style={{ borderColor: 'var(--color-border)', background: isDone ? 'var(--color-bg)' : 'var(--color-surface)' }}
                  >
                    <div className="flex items-start gap-3">
                      <Tooltip text={isDone ? 'Untick: mark this as not done yet.' : 'Tick when this has been fixed. Saved with this run (with today\'s date) and shown in the PDF report; run a new test to confirm it worked.'}>
                        <input
                          type="checkbox"
                          checked={isDone}
                          onChange={() => onToggle(a.key, !isDone)}
                          aria-label={`Mark "${a.title}" as done`}
                          className="mt-1 shrink-0"
                          data-guide={first ? 'action-done' : undefined}
                        />
                      </Tooltip>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isDone ? <Badge strong tip="Ticked as done on this date.">Done {fmtShortDate(doneMap?.[a.key]?.doneAt)}</Badge> : null}
                          <Badge tip={`This affects the ${a.categoryLabel} score.`}>{a.categoryLabel}</Badge>
                          {a.who ? <Badge tip="Who usually makes this change. A content editor can do it in the website editor; hosting means the web host or whoever set up the server.">{a.who}</Badge> : null}
                          {a.effort ? <Badge tip="Rough size of the job for someone who knows the site. A guide, not a quote.">{a.effort}</Badge> : null}
                          {a.alsoOther === true ? <Badge tip={`Google found this on the ${otherLabel} test too, so one fix helps both.`}>Also on {otherLabel}</Badge> : null}
                          {a.alsoOther === false ? <Badge tip={`Only found on the ${strategy} test.`}>{strategy} only</Badge> : null}
                        </div>
                        <p className="text-sm font-semibold" style={{ color: isDone ? 'var(--color-muted)' : 'var(--color-text)', textDecoration: isDone ? 'line-through' : 'none' }}>{a.title}</p>
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}><strong style={{ color: 'var(--color-text)' }}>Why it matters: </strong>{a.why}</p>
                        <p className="text-xs leading-relaxed rounded-lg p-2.5" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}><strong>What to do: </strong>{a.how}</p>
                        {a.where.length > 0 && <WhereList items={a.where} />}
                        <div data-guide={first ? 'action-note' : undefined} style={{ opacity: 1 }}>
                          <ActionNote value={doneMap?.[a.key]?.note || ''} done={isDone} onSave={(note) => onNote(a.key, note)} />
                        </div>
                        <Tooltip text="Show the technical version: Google's own wording, why each item failed, and the exact code to find on the page.">
                          <button
                            type="button"
                            onClick={() => toggleDetail(a.key)}
                            aria-expanded={detailOpen}
                            className="inline-flex items-center gap-1 text-xs transition-opacity duration-200 hover:opacity-70"
                            style={{ color: 'var(--color-primary)' }}
                            data-guide={first ? 'developer-detail' : undefined}
                          >
                            {getIcon(detailOpen ? 'chevron-down' : 'chevron-right', { size: 12 })}
                            For your developer
                          </button>
                        </Tooltip>
                        {detailOpen && <DeveloperDetail a={a} />}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// Score-over-time trend for one website. Single series -> no legend needed (the
// title names it); the app's own --color-primary token is used so the line
// tracks whichever theme (incl. dark mode) is active, rather than a fixed hex.
function ScoreTrendChart({ points }) {
  const [hover, setHover] = useState(null);
  if (!points || points.length < 2) return null;

  const W = 640;
  const H = 160;
  const padL = 28;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xAt = (i) => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yAt = (score) => padT + plotH - (Math.max(0, Math.min(100, score)) / 100) * plotH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(p.score).toFixed(1)}`).join(' ');
  const gridScores = [0, 25, 50, 75, 100];

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Performance score over time</p>
        <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{points.length} run{points.length === 1 ? '' : 's'}</p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: H, overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
      >
        {gridScores.map((g) => (
          <line
            key={g}
            x1={padL} x2={W - padR}
            y1={yAt(g)} y2={yAt(g)}
            stroke="var(--color-border)"
            strokeWidth={1}
          />
        ))}
        {gridScores.map((g) => (
          <text key={`lbl-${g}`} x={padL - 6} y={yAt(g) + 3} textAnchor="end" fontSize="9" fill="var(--color-muted)">{g}</text>
        ))}
        <path d={path} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle
            key={p.id ?? i}
            cx={xAt(i)}
            cy={yAt(p.score)}
            r={hover === i ? 5 : i === points.length - 1 ? 4 : 3}
            fill="var(--color-primary)"
            stroke="var(--color-surface)"
            strokeWidth={1.5}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHover(i)}
          />
        ))}
        {/* Larger invisible hit targets, per interaction spec — bigger than the visible mark */}
        {points.map((p, i) => (
          <circle
            key={`hit-${p.id ?? i}`}
            cx={xAt(i)}
            cy={yAt(p.score)}
            r={10}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {hover != null && points[hover] && (
        <div
          className="mt-1 inline-flex items-center gap-2 px-2 py-1 rounded-lg text-xs"
          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
        >
          <span style={{ color: 'var(--color-muted)' }}>{points[hover].dateLabel}</span>
          <span className="font-semibold tabular-nums" style={{ color: scoreTint(points[hover].score) }}>{points[hover].score}</span>
        </div>
      )}
    </div>
  );
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function scoreTint(n) {
  if (n == null) return 'var(--color-muted)';
  if (n >= 90) return '#166534';
  if (n >= 50) return '#b45309';
  return '#ef4444';
}

function viewsOf(report) {
  if (report?.mobile || report?.desktop) {
    return { mobile: report.mobile || null, desktop: report.desktop || null };
  }
  if (report?.categories) {
    const key = report.strategy === 'desktop' ? 'desktop' : 'mobile';
    return { mobile: key === 'mobile' ? report : null, desktop: key === 'desktop' ? report : null };
  }
  return { mobile: null, desktop: null };
}

function formatSave(item) {
  if (item.displayValue) return item.displayValue;
  const bits = [];
  if (item.savingsMs) bits.push(`${item.savingsMs} ms`);
  if (item.savingsBytes) bits.push(`${Math.round(item.savingsBytes / 1024)} KiB`);
  return bits.join(' · ');
}

function itemText(it) {
  const bits = [];
  if (it.selector) bits.push(it.selector);
  if (it.url) bits.push(it.url);
  if (it.subpart) bits.push(it.duration != null ? `${it.subpart}: ${it.duration} ms` : it.subpart);
  else if (it.label && it.label !== it.selector && it.label !== it.url) bits.push(it.label);
  if (it.fg && it.bg) {
    const ratio = it.contrastRatio != null ? ` ratio ${Number(it.contrastRatio).toFixed(2)} (need ≥ 4.5)` : '';
    bits.push(`text ${it.fg} on ${it.bg}${ratio}`);
  }
  if (it.fontSize) bits.push(String(it.fontSize));
  if (it.wastedMs != null) bits.push(`${it.wastedMs} ms wasted`);
  if (it.wastedBytes != null) bits.push(`${it.wastedBytes} bytes unused`);
  if (it.explanation) bits.push(it.explanation);
  if (!bits.length && it.snippet) bits.push(it.snippet);
  return bits.join(' · ');
}

function FindingList({ title, items, tip }) {
  if (!items?.length) return null;
  return (
    <div className="rounded-2xl border p-6 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <SectionTitle>{title}</SectionTitle>
      {tip ? <p className="text-xs -mt-2 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{tip}</p> : null}
      <ul className="space-y-3">
        {items.map((o) => (
          <li
            key={o.id}
            className="rounded-xl border p-4 space-y-1"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{o.title}</p>
              {formatSave(o) ? (
                <span className="text-xs tabular-nums" style={{ color: 'var(--color-muted)' }}>{formatSave(o)}</span>
              ) : null}
            </div>
            {o.description ? (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{cleanLighthouseText(o.description)}</p>
            ) : null}
            {o.docsUrl ? (
              <a
                href={o.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-primary)' }}
              >
                Developer docs
              </a>
            ) : null}
            {(o.items || []).length > 0 && (
              <ul className="pt-1 space-y-1">
                {o.items.map((it, i) => {
                  const h = humanEvidence(it);
                  return (
                    <li key={`${o.id}-${i}`} className="flex items-start gap-2 text-xs leading-relaxed">
                      <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full" style={{ background: 'var(--color-primary)' }} />
                      {h ? (
                        <Tooltip text={h.code.join('\n') || itemText(it)}>
                          <span className="min-w-0 break-words">
                            <span style={{ color: 'var(--color-text)' }}>{h.where}</span>
                            {h.detail ? <span style={{ color: 'var(--color-muted)' }}> · {h.detail}</span> : null}
                          </span>
                        </Tooltip>
                      ) : (
                        <span className="min-w-0 break-all" style={{ color: 'var(--color-text)' }}>{itemText(it)}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'score', label: 'Score' },
];

function runStamp(a) {
  const raw = a?.createdAt || a?.updatedAt;
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isNaN(t) ? 0 : t;
}

function sortAudits(list, sort) {
  const rows = [...list];
  if (sort === 'oldest') return rows.sort((a, b) => runStamp(a) - runStamp(b));
  if (sort === 'name') return rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  if (sort === 'score') return rows.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  return rows.sort((a, b) => runStamp(b) - runStamp(a));
}

function formatRunDate(audit) {
  const raw = audit?.createdAt || audit?.report?.mobile?.fetchTime || audit?.report?.desktop?.fetchTime || audit?.report?.fetchTime;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function HtmlAuditPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.html !== false;

  const [audits, setAudits] = useState([]);
  const [audit, setAudit] = useState(null);
  const [search, setSearch] = useState('');
  const [hostFilter, setHostFilter] = useState('');
  const info = useToolInfoModal('vault_pagespeed_info_seen');
  const [tab, setTab] = useState('report');
  const [showPdf, setShowPdf] = useState(false);
  const [sort, setSort] = useState(() => {
    try {
      const saved = localStorage.getItem('vault:htmlListSort');
      if (SORT_OPTIONS.some((o) => o.id === saved)) return saved;
    } catch { /* ignore */ }
    return 'newest';
  });
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [view, setView] = useState('mobile');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  const loadList = useCallback(async () => {
    const res = await api.get('/api/html/audits');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load audits');
    setAudits(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!canUse) return;
    loadList().catch((err) => addToast(err.message, 'error'));
  }, [canUse, loadList, addToast]);

  useEffect(() => {
    if (!canUse || !id) {
      setAudit(null);
      return undefined;
    }
    let cancelled = false;
    api.get(`/api/html/audits/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Not found');
        if (!cancelled) {
          setAudit(data);
          const v = viewsOf(data.report);
          setView(v.mobile ? 'mobile' : 'desktop');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          addToast(err.message, 'error');
          navigate('/html');
        }
      });
    return () => { cancelled = true; };
  }, [canUse, id, addToast, navigate]);

  const hostnames = useMemo(() => {
    const set = new Set(audits.map((a) => a.hostname || hostOf(a.url)).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [audits]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = audits;
    if (hostFilter) rows = rows.filter((a) => (a.hostname || hostOf(a.url)) === hostFilter);
    if (q) rows = rows.filter((a) => `${a.name} ${a.url} ${a.hostname || ''}`.toLowerCase().includes(q));
    return sortAudits(rows, sort);
  }, [audits, search, sort, hostFilter]);

  // Score-over-time points for the currently filtered website (or, with no
  // filter set, the currently open audit's own site) — oldest first for the chart.
  const trendHost = hostFilter || (audit ? (audit.hostname || hostOf(audit.url)) : '');
  const trendPoints = useMemo(() => {
    if (!trendHost) return [];
    const rows = audits
      .filter((a) => (a.hostname || hostOf(a.url)) === trendHost && a.score != null)
      .sort((a, b) => runStamp(a) - runStamp(b));
    return rows.map((a) => ({
      id: a.id,
      score: Number(a.score),
      dateLabel: formatRunDate(a) || '',
    }));
  }, [audits, trendHost]);

  const handleCreate = async () => {
    if (!url.trim()) {
      addToast('Paste a website URL', 'error');
      return;
    }
    startProcessing(
      'Running Lighthouse on mobile and desktop…',
      'Two PageSpeed runs in parallel. This often takes about a minute.',
    );
    try {
      const res = await api.post('/api/html/audits', {
        url: url.trim(),
        name: name.trim() || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lighthouse run failed');
      setUrl('');
      setName('');
      await loadList();
      addToast(data.summary || `Performance ${data.score}`, 'success');
      navigate(`/html/${data.id}`);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleDelete = async (auditId) => {
    const target = Number(auditId);
    if (!target) return;
    try {
      const res = await api.delete(`/api/html/audits/${target}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setDeleteConfirm(false);
      setPendingDeleteId(null);
      await loadList();
      addToast('Audit deleted', 'success');
      if (String(id) === String(target)) navigate('/html');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const copyBrief = async (text, what = 'Developer brief') => {
    try {
      await navigator.clipboard.writeText(text);
      addToast(`${what} copied`, 'success');
    } catch {
      addToast('Could not copy', 'error');
    }
  };

  // Ticks and notes are saved on the run (audit.actionsDone[view]). The screen updates at once and goes back if the save fails.
  const saveAction = useCallback(async (auditId, device, body) => {
    const res = await api.put(`/api/html/audits/${auditId}/actions/${device}`, body);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save');
    return data.actionsDone;
  }, []);

  const updateAction = async (key, change) => {
    if (!audit?.id) return;
    const auditId = audit.id;
    const device = view;
    const before = audit.actionsDone || {};
    const prev = before[device]?.[key] || {};
    const optimistic = {
      ...prev,
      ...('done' in change ? { done: change.done, doneAt: change.done ? (prev.doneAt || new Date().toISOString()) : null } : {}),
      ...('note' in change ? { note: change.note } : {}),
    };
    setAudit((a) => (a && a.id === auditId ? { ...a, actionsDone: { ...before, [device]: { ...(before[device] || {}), [key]: optimistic } } } : a));
    try {
      const saved = await saveAction(auditId, device, { key, ...change });
      setAudit((a) => (a && a.id === auditId ? { ...a, actionsDone: saved } : a));
      if ('note' in change) addToast('Note saved', 'success');
    } catch (err) {
      setAudit((a) => (a && a.id === auditId ? { ...a, actionsDone: before } : a));
      addToast(err.message, 'error');
    }
  };

  // One-off: ticks made before they were saved on the run lived in this browser; move them up, then forget the local copy.
  useEffect(() => {
    if (!audit?.id) return;
    const auditId = audit.id;
    ['mobile', 'desktop'].forEach((device) => {
      const local = readLegacyDone(auditId, device);
      if (!local.length) return;
      const onServer = audit.actionsDone?.[device] || {};
      const todo = local.filter((k) => !onServer[k]?.done);
      (async () => {
        let latest = null;
        for (const key of todo) {
          try { latest = await saveAction(auditId, device, { key, done: true }); } catch { return; }
        }
        clearLegacyDone(auditId, device);
        if (latest) setAudit((a) => (a && a.id === auditId ? { ...a, actionsDone: latest } : a));
      })();
    });
  }, [audit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildPdf = async (options) => {
    setShowPdf(false);
    startProcessing('Building the PDF report…', 'Laying out the scores and actions.');
    try {
      const { downloadPageSpeedPdf } = await import('./pageSpeed/pageSpeedReportPdf');
      await downloadPageSpeedPdf(audit, options);
      addToast('PDF report downloaded', 'success');
    } catch (err) {
      addToast(err.message || 'Could not build the PDF', 'error');
    } finally {
      stopProcessing();
    }
  };

  const pair = viewsOf(audit?.report);
  const active = view === 'desktop' ? (pair.desktop || pair.mobile) : (pair.mobile || pair.desktop);
  const activeKey = active === pair.desktop ? 'desktop' : 'mobile';
  const otherView = activeKey === 'desktop' ? pair.mobile : pair.desktop;
  const actions = useMemo(() => (active ? buildActions(active, otherView) : []), [active, otherView]);

  // The guide's Open buttons: go to the right screen / tab, then scroll to the part marked data-guide="<id>".
  const openToolById = (guideId) => {
    const target = GUIDE_TOOLS.find((t) => t.id === guideId);
    if (!target) return;
    if (target.tool === 'new-run' && guideId === 'new-run' && id) navigate('/html');
    if ((target.tool === 'report' || target.tool === 'actions') && !id) {
      addToast('Open a saved run from the list on the left first (or run a new test).', 'info');
      return;
    }
    if (target.tool === 'report' || target.tool === 'actions') setTab(target.tool);
    setTimeout(() => {
      const el = document.querySelector(`[data-guide="${guideId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  };

  if (!canUse) return <Navigate to="/" replace />;

  const cats = active?.categories || {};
  const score = active ? Number(active.score) : (audit ? Number(audit.score) : null);
  const runError = audit?.report?.errors?.[view];
  const currentTool = !id ? 'new-run' : tab;

  return (
    <VoiceInputProvider lang="en-AU">
    <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
      <aside
        className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto p-4 space-y-3"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
            {getIcon('gauge', { size: 16 })}
          </div>
          <h1 className="text-sm font-semibold flex-1" style={{ color: 'var(--color-text)' }}>Page speed</h1>
          <Tooltip text="How Page speed works: the scores, Mobile vs Desktop, the Report and Actions tabs, and what it cannot do.">
            <button
              type="button"
              onClick={info.open}
              aria-label="How Page speed works"
              className="flex items-center justify-center hover:opacity-60 transition-opacity duration-200 flex-shrink-0"
              style={{ color: 'var(--color-muted)', background: 'none', border: 'none', padding: 0 }}
            >
              {getIcon('info', { size: 16 })}
            </button>
          </Tooltip>
        </div>

        <Tooltip text="Filter your saved runs by name, URL, or hostname.">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search runs…"
            className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
            style={FIELD}
          />
        </Tooltip>

        {hostnames.length > 1 && (
          <Tooltip text="Show only runs for one website, and drive the progress chart from just that site.">
            <select
              aria-label="Filter by website"
              value={hostFilter}
              onChange={(e) => setHostFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
              style={FIELD}
            >
              <option value="">All websites</option>
              {hostnames.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </Tooltip>
        )}

        <Tooltip text="Order the run list by date, name, or score.">
          <select
            aria-label="Sort runs"
            value={sort}
            onChange={(e) => {
              const next = e.target.value;
              setSort(next);
              try { localStorage.setItem('vault:htmlListSort', next); } catch { /* ignore */ }
            }}
            className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
            style={FIELD}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>Sort: {o.label}</option>
            ))}
          </select>
        </Tooltip>

        <Tooltip text="Start a fresh page speed run on a new URL.">
          <button
            type="button"
            onClick={() => navigate('/html')}
            className="w-full px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-70"
            style={
              !id
                ? { background: 'var(--color-primary)', color: '#fff' }
                : { background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text)' }
            }
          >
            New page speed run
          </button>
        </Tooltip>

        <ul className="space-y-0.5" data-guide="saved-runs">
          {filtered.length === 0 && (
            <li className="px-2 py-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>No runs yet</li>
          )}
          {filtered.map((a) => (
            <li key={a.id}>
              {String(pendingDeleteId) === String(a.id) ? (
                <div className="px-2 py-1.5 text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
                  <span className="block truncate" style={{ color: 'var(--color-text)' }}>{a.name}</span>
                  <span className="flex items-center gap-2">
                    Delete?
                    <button type="button" onClick={() => handleDelete(a.id)} className="transition-opacity hover:opacity-70" style={{ color: '#ef4444' }}>Yes</button>
                    <button type="button" onClick={() => setPendingDeleteId(null)} className="transition-opacity hover:opacity-70">No</button>
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-0.5">
                  <button
                    type="button"
                    onClick={() => navigate(`/html/${a.id}`)}
                    className="min-w-0 flex-1 text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
                    style={{
                      background: String(id) === String(a.id) ? 'var(--color-bg)' : 'transparent',
                      color: String(id) === String(a.id) ? 'var(--color-text)' : 'var(--color-muted)',
                    }}
                  >
                    <span className="block truncate">{a.name}</span>
                    <span className="block truncate" style={{ color: 'var(--color-muted)' }}>
                      {[
                        a.score != null ? String(a.score) : null,
                        formatRunDate(a) || null,
                        a.hostname || hostOf(a.url),
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                  <Tooltip text={`Delete this saved run.`}>
                    <button
                      type="button"
                      aria-label={`Delete ${a.name}`}
                      onClick={() => setPendingDeleteId(a.id)}
                      className="shrink-0 p-1.5 rounded-lg transition-opacity hover:opacity-70"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {getIcon('trash', { size: 14 })}
                    </button>
                  </Tooltip>
                </div>
              )}
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex-1 overflow-y-auto p-6 space-y-4 max-w-6xl">
        {id && !audit && (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading audit…</p>
        )}

        {!id && (
          <section className="space-y-4" data-guide="new-run">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Page speed</h2>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                Tests a public web page with Google PageSpeed Insights on <span className="font-medium" style={{ color: 'var(--color-text)' }}>mobile and desktop</span>, then saves a <span className="font-medium" style={{ color: 'var(--color-text)' }}>Report</span> (scores, timings, every finding) and an <span className="font-medium" style={{ color: 'var(--color-text)' }}>Actions</span> list (what to fix, in plain English, most important first). One page at a time; for a whole-site crawl use the SEO tool. Not sure where to start? Press the round guide button at the bottom right.
              </p>
            </div>
            {hostFilter && trendPoints.length >= 2 && (
              <ScoreTrendChart points={trendPoints} />
            )}
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Website URL</span>
              <Tooltip text="Any public URL — Vault runs a real Google PageSpeed Insights audit against it, mobile and desktop.">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.example.com.au"
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                  style={FIELD}
                />
              </Tooltip>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Name (optional)</span>
              <Tooltip text="A label to find this run later in the sidebar list — defaults to the site's hostname.">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Defaults to the hostname"
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                  style={FIELD}
                />
              </Tooltip>
            </label>
            <Tooltip text="Takes about a minute — two PageSpeed Insights runs (mobile + desktop) in parallel.">
              <button
                type="button"
                onClick={handleCreate}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-primary)' }}
              >
                Run page speed test
              </button>
            </Tooltip>
          </section>
        )}

        {id && audit && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                  {audit.name}{formatRunDate(audit) ? ` (${formatRunDate(audit)})` : ''}
                </h2>
                <a
                  href={audit.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs transition-opacity hover:opacity-70 break-all"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {audit.url}
                </a>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  {audit.summary}
                </p>
                {!hostFilter && trendPoints.length >= 2 && (
                  <Tooltip text="Filter by this website in the sidebar to see this chart on the landing page too.">
                    <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                      {trendPoints.length} runs recorded for {trendHost}
                    </span>
                  </Tooltip>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-semibold tabular-nums"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: scoreTint(score) }}
                >
                  {score ?? '—'}
                </div>
                {deleteConfirm ? (
                  <span className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                    Delete?
                    <button type="button" onClick={() => handleDelete(id)} className="transition-opacity hover:opacity-70" style={{ color: '#ef4444' }}>Yes</button>
                    <button type="button" onClick={() => setDeleteConfirm(false)} className="transition-opacity hover:opacity-70">No</button>
                  </span>
                ) : (
                  <Tooltip text="Delete this saved run.">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(true)}
                      className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                    >
                      Delete
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2" data-guide="mobile-desktop">
              {['mobile', 'desktop'].map((s) => (
                <Tooltip key={s} text={s === 'mobile'
                  ? 'Show the phone test: a mid-range phone on a slower mobile connection. Usually the lower score, and the one Google mostly ranks on. Both the Report and Actions tabs follow this.'
                  : 'Show the desktop computer test: a fast connection and big screen. Both the Report and Actions tabs follow this.'}>
                  <button
                    type="button"
                    onClick={() => setView(s)}
                    className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
                    style={view === s
                      ? { background: 'var(--color-primary)', color: '#fff' }
                      : { border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                  >
                    {s === 'mobile' ? 'Mobile' : 'Desktop'}
                    {pair[s]?.score != null ? ` ${pair[s].score}` : ''}
                  </button>
                </Tooltip>
              ))}
              {active?.developerBrief ? (
                <Tooltip text="Copy the technical report (developer work order, metrics and findings) for the device chosen (mobile or desktop) as plain text, to paste to a developer.">
                  <button
                    data-guide="copy"
                    type="button"
                    onClick={() => copyBrief(active.developerBrief)}
                    className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    Copy this report
                  </button>
                </Tooltip>
              ) : null}
              {audit?.report?.developerBrief ? (
                <Tooltip text="Copy both the mobile and desktop reports together as plain text.">
                  <button
                    type="button"
                    onClick={() => copyBrief(audit.report.developerBrief)}
                    className="px-3.5 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    Copy mobile + desktop
                  </button>
                </Tooltip>
              ) : null}
              {active ? (
                <Tooltip text="Make a formatted PDF report of this run: scores, timings and the plain-English actions with your ticks, done dates and notes. Choose devices and what to include.">
                  <button
                    type="button"
                    onClick={() => setShowPdf(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm border transition-opacity duration-200 hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    {getIcon('download', { size: 14 })}
                    PDF report
                  </button>
                </Tooltip>
              ) : null}
            </div>

            {runError && !active ? (
              <p className="text-sm leading-relaxed" style={{ color: '#ef4444' }}>{runError}</p>
            ) : null}

            {active && (
              <div className="flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }} role="tablist" aria-label="Report or actions">
                {[
                  { id: 'report', label: 'Report', tip: `The scores, timings and every finding for the ${activeKey} test.` },
                  { id: 'actions', label: `Actions${actions.length ? ` (${actions.length})` : ''}`, tip: `What to fix on ${activeKey}, in plain English, most important first, with who usually does it. Tick each off as it is done.` },
                ].map((t) => (
                  <Tooltip key={t.id} text={t.tip}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === t.id}
                      onClick={() => setTab(t.id)}
                      data-guide={t.id}
                      className="px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-opacity duration-200 hover:opacity-70"
                      style={{
                        borderColor: tab === t.id ? 'var(--color-primary)' : 'transparent',
                        color: tab === t.id ? 'var(--color-text)' : 'var(--color-muted)',
                      }}
                    >
                      {t.label}
                    </button>
                  </Tooltip>
                ))}
              </div>
            )}

            {active && tab === 'actions' && (
              <ActionsPanel
                key={activeKey}
                actions={actions}
                strategy={activeKey}
                otherLabel={activeKey === 'mobile' ? 'desktop' : 'mobile'}
                doneMap={audit.actionsDone?.[activeKey] || {}}
                onToggle={(key, isDone) => updateAction(key, { done: isDone })}
                onNote={(key, note) => updateAction(key, { note })}
                onCopy={(text) => copyBrief(text, 'Action list')}
                onPdf={() => setShowPdf(true)}
              />
            )}

            {active && tab === 'report' && (
              <>
                {trendPoints.length >= 2 && <div data-guide="trend"><ScoreTrendChart points={trendPoints} /></div>}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-guide="scores">
                  {[
                    ['Performance', cats.performance, 'How fast the page appears and responds. Built mostly from the main-picture time, how much it jumps and how long it is too busy to respond. 90+ good, 50–89 needs work, under 50 poor. What to fix is on the Actions tab.'],
                    ['Accessibility', cats.accessibility, 'How usable the page is for people using a screen reader, only a keyboard, or with poor eyesight (contrast, labels, alt text). 90+ good, 50–89 needs work, under 50 poor.'],
                    ['Best practices', cats.bestPractices, 'General safety and quality: secure https, no browser errors, no outdated features, pictures shown at the right shape. 90+ good, 50–89 needs work, under 50 poor.'],
                    ['Lighthouse SEO', cats.seo, 'Search engine basics on this one page: title, description, crawlable links, not blocked from Google. 90+ good. For a whole-site crawl use the separate SEO tool.'],
                  ].map(([label, n, tip]) => (
                    <Tooltip key={label} text={tip}>
                      <div
                        className="rounded-2xl border p-4"
                        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{label}</p>
                        <p className="text-xl font-semibold tabular-nums mt-1" style={{ color: scoreTint(n) }}>{n ?? '—'}</p>
                      </div>
                    </Tooltip>
                  ))}
                </div>

                {active.environment?.lighthouseVersion ? (
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    Lighthouse {active.environment.lighthouseVersion}
                    {active.environment.formFactor ? ` · ${active.environment.formFactor}` : ''}
                    {active.environment.throttlingMethod ? ` · ${active.environment.throttlingMethod} throttling` : ''}
                    {active.fetchTime ? ` · ${active.fetchTime}` : ''}
                  </p>
                ) : null}

                {actions.length > 0 && (
                  <div className="rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                    <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                      <strong>{actions.length} thing{actions.length === 1 ? '' : 's'} to fix on {activeKey}</strong>
                      <span style={{ color: 'var(--color-muted)' }}>, {actions.filter((a) => a.priority === 'P0').length} of them first. The Actions tab lists them in plain English.</span>
                    </p>
                    <Tooltip text="Open the plain-English to-do list for this device.">
                      <button
                        type="button"
                        onClick={() => setTab('actions')}
                        className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70"
                        style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}
                      >
                        See actions
                      </button>
                    </Tooltip>
                  </div>
                )}

                <div className="grid gap-4 xl:grid-cols-2 items-start">
                  {(active.metrics || []).length > 0 && (
                    <div className="rounded-2xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-guide="lab-metrics">
                      <SectionTitle small tip={SECTION_HELP.labMetrics}>Lab metrics</SectionTitle>
                      <ul className="space-y-1">
                        {active.metrics.map((m) => (
                          <li key={m.id}>
                            <Tooltip text={METRIC_HELP[m.id] || m.title}>
                              <div className="flex justify-between gap-3 text-xs cursor-help">
                                <span style={{ color: 'var(--color-text)' }}>{m.title}</span>
                                <span className="tabular-nums shrink-0" style={{ color: scoreTint(m.score == null ? null : Math.round(m.score * 100)) }}>{m.displayValue || '—'}</span>
                              </div>
                            </Tooltip>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="rounded-2xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-guide="field-data">
                    <SectionTitle small tip={SECTION_HELP.fieldData}>Field data (real visitors)</SectionTitle>
                    {(active.fieldData || []).length > 0 ? (
                      <ul className="space-y-1">
                        {active.fieldData.map((m) => {
                          const [label, help] = FIELD_HELP[m.id] || [m.id.replace(/_/g, ' ').toLowerCase(), ''];
                          return (
                            <li key={m.id}>
                              <Tooltip text={`${help ? `${help} ` : ''}${FIELD_CATEGORY_HELP}`}>
                                <div className="flex justify-between gap-3 text-xs cursor-help">
                                  <span style={{ color: 'var(--color-text)' }}>{label}</span>
                                  <span style={{ color: m.category === 'FAST' ? '#166534' : m.category === 'SLOW' ? '#ef4444' : m.category === 'AVERAGE' ? '#b45309' : 'var(--color-muted)' }}>
                                    {m.category || '—'}{m.percentile != null ? ` · ${m.percentile}` : ''}
                                  </span>
                                </div>
                              </Tooltip>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                        Google has no real-visitor data for this page yet. It needs enough Chrome visitors over the last 28 days; small or new sites often have none. The lab metrics still apply.
                      </p>
                    )}
                  </div>
                </div>

                <div data-guide="findings" className="space-y-4">
                  <FindingList title="Opportunities" items={active.opportunities} tip={SECTION_HELP.opportunities} />
                  <FindingList title="Diagnostics" items={active.diagnostics} tip={SECTION_HELP.diagnostics} />
                  <FindingList title="Failed checks" items={active.failedAudits} tip={SECTION_HELP.failedAudits} />
                  <FindingList title="Warnings" items={active.warnings} tip={SECTION_HELP.warnings} />
                </div>
              </>
            )}
          </section>
        )}
      </main>

      {info.show && (
        <ToolInfoModal title="How Page speed works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Test how fast and healthy a public web page is, on a phone and on a computer, and get a plain-English list of what to fix. Hover anything for a short explanation. Not sure where to look? Press the round guide button at the bottom right and say what you want to do.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      {showPdf && audit && <PdfReportDialog audit={audit} onClose={() => setShowPdf(false)} onBuild={buildPdf} />}

      <PageSpeedTutorChat currentTool={currentTool} onOpenTool={openToolById} />
    </div>
    </VoiceInputProvider>
  );
}
