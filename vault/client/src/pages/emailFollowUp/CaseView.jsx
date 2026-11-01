import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore, { runWithStepLog } from '../../store/processingStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { offerUndo } from '../../utils/binUndo';
import { dueLabel, directionLabel, statusLabel } from './labels.mjs';
import { EF_TIPS } from './efTips.mjs';

const FIELD = 'px-3 py-2 rounded-xl border text-sm outline-none';
const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const CARD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)' };
// Status colours are deliberately outside the theme (client/DESIGN.md).
const WARN = '#f59e0b';
const BAD = '#ef4444';
const GOOD = '#16a34a';

const TABS = [
  ['ledger', 'tabLedger', (n) => `Ledger (${n.rows})`],
  ['ask', 'tabAsk', () => 'Summary and Ask'],
  ['mail', 'tabMail', (n) => `Mail (${n.sources})`],
  ['drafts', 'tabDrafts', (n) => `Drafts (${n.pending}/${n.cap} waiting)`],
  ['coverage', 'tabCoverage', () => 'What was covered'],
];

// Every button carries a hover tip (shared Tooltip, never a native title).
function Btn({ children, onClick, primary, danger, disabled, tip, small, ...rest }) {
  return (
    <Tooltip text={tip}>
      <button
        type="button" onClick={onClick} disabled={disabled} {...rest}
        className={`rounded-lg ${small ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'} font-medium border hover:opacity-70 transition-opacity disabled:opacity-40`}
        style={danger ? { background: BAD, borderColor: BAD, color: '#fff' } : primary ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' } : { borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
      >{children}</button>
    </Tooltip>
  );
}

function Badge({ children, color }) {
  return <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface)', color: color || 'var(--color-muted)' }}>{children}</span>;
}

function useCall() {
  const toast = useToastStore((s) => s.addToast);
  return useCallback(async (fn, okMsg) => {
    try {
      const r = await fn();
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.error || d.reason || 'That did not work.', 'error'); return { ok: false, data: d }; }
      if (okMsg) toast(okMsg);
      return { ok: true, data: d };
    } catch { toast('Could not reach the server.', 'error'); return { ok: false, data: {} }; }
  }, [toast]);
}

// ---------- ledger ----------

function RowCard({ row, caseId, sources, reload, onDraft, locked }) {
  const call = useCall();
  const [mode, setMode] = useState(null); // 'sub' | 'cond' | 'close'
  const [text, setText] = useState('');
  const [sub, setSub] = useState({ party: '', sourceId: '', quote: '' });
  const src = sources.find((s) => row.anchors[0] && s.id === row.anchors[0].sourceId);
  const live = row.status === 'open' || row.status === 'unverified';
  const url = `/api/email-follow-up/${caseId}/rows/${row.id}`;

  const event = async (type, note, by) => {
    const r = await call(() => api.post(`${url}/event`, { type, note, by }), type === 'human_close' ? 'Closed.' : 'Done.');
    if (r.ok) { setMode(null); setText(''); reload(); }
  };

  return (
    <div className="rounded-xl border p-4 space-y-2" style={{ ...CARD, opacity: live ? 1 : 0.65 }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{row.items.join(', ')}</span>
        <Badge>{directionLabel(row)}</Badge>
        <Badge color={row.status === 'open' ? GOOD : row.status === 'unverified' || row.status === 'suspended' ? WARN : 'var(--color-muted)'}>{statusLabel(row.status)}</Badge>
        {row.claimType !== 'agreed' && <Badge color={WARN}>{row.claimType}</Badge>}
        {row.authority === 'unconfirmed' && <Badge color={WARN}>authority unconfirmed</Badge>}
        {row.taskId && <Badge>task made</Badge>}
        {src && /tesseract/.test(src.parser || '') && <Badge color={WARN}>from a scan (OCR)</Badge>}
      </div>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        {row.partyLabel || row.party}{row.amount != null ? ` · $${row.amount}` : ''} · {dueLabel(row.due)}
      </p>
      {row.condition && <p className="text-xs" style={{ color: WARN }}>Only if: "{row.condition}" {row.conditionSatisfied ? '(shown met)' : '(not shown met)'}</p>}
      {row.delta && <p className="text-xs" style={{ color: WARN }}>Changed from the earlier ask: {row.delta}</p>}
      {row.conflictWith && <p className="text-xs" style={{ color: BAD }}>{row.conflictQuestion} Waive the wrong one to continue; no draft can be made until you do.</p>}
      {row.quote && (
        <p className="text-xs leading-relaxed border-l-2 pl-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
          "{row.quote}"{src ? ` — ${src.label}` : ''}{row.anchors.length > 1 ? ` (+${row.anchors.length - 1} more mention${row.anchors.length > 2 ? 's' : ''})` : ''}
        </p>
      )}
      {live && !locked && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Btn small primary onClick={() => onDraft(row)} tip={EF_TIPS.draftFollowup}>Draft follow-up</Btn>
          <Btn small onClick={() => setMode(mode === 'close' ? null : 'close')} tip={EF_TIPS.resolvedElsewhere}>Resolved elsewhere</Btn>
          {row.claimType === 'conditional' && !row.conditionSatisfied && <Btn small onClick={() => setMode(mode === 'cond' ? null : 'cond')} tip={EF_TIPS.conditionMet}>Condition met</Btn>}
          {row.authority === 'unconfirmed' && <Btn small onClick={() => event('confirm_authority', '', 'human_note')} tip={EF_TIPS.confirmAuthority}>Confirm authority</Btn>}
          <Btn small onClick={() => setMode(mode === 'sub' ? null : 'sub')} tip={EF_TIPS.tookOver}>Someone else took over</Btn>
          {!row.taskId && <Btn small onClick={async () => { const r = await call(() => api.post(`${url}/task`, {}), 'Task made.'); if (r.ok) reload(); }} tip={EF_TIPS.makeTask}>Make a task</Btn>}
          <Btn small onClick={() => event('waive')} tip={EF_TIPS.waive}>Waive</Btn>
        </div>
      )}
      {(mode === 'close' || mode === 'cond') && (
        <div className="flex gap-2 pt-1 items-start">
          <Tooltip text={mode === 'close' ? EF_TIPS.closeNote : EF_TIPS.conditionNote}>
            <div className="flex-1"><VoiceInput value={text} onChange={setText} placeholder={mode === 'close' ? 'Note (optional): how it was settled' : 'How do you know the condition was met?'} /></div>
          </Tooltip>
          <Btn small primary disabled={mode === 'cond' && !text.trim()} onClick={() => event(mode === 'close' ? 'human_close' : 'condition_met', text)} tip={EF_TIPS.saveNote}>Save</Btn>
        </div>
      )}
      {mode === 'sub' && (
        <div className="space-y-2 pt-1">
          <Tooltip text={EF_TIPS.subParty}>
            <input className={`${FIELD} w-full text-xs`} style={FIELD_STYLE} aria-label="Who took it over" placeholder="Who took it over? (email address)" value={sub.party} onChange={(e) => setSub({ ...sub, party: e.target.value })} />
          </Tooltip>
          <Tooltip text={EF_TIPS.subSource}>
            <select className={`${FIELD} w-full text-xs`} style={FIELD_STYLE} aria-label="Which message says so" value={sub.sourceId} onChange={(e) => setSub({ ...sub, sourceId: e.target.value })}>
              <option value="">Which message says so?</option>
              {sources.filter((s) => s.channel !== 'note').map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Tooltip>
          <Tooltip text={EF_TIPS.subQuote}>
            <div><VoiceInput value={sub.quote} onChange={(v) => setSub({ ...sub, quote: v })} placeholder="Their words, copied exactly from that message" /></div>
          </Tooltip>
          <Btn small primary disabled={!sub.party || !sub.sourceId || !sub.quote} tip={EF_TIPS.subGo} onClick={async () => { const r = await call(() => api.post(`${url}/substitute`, { ...sub, sourceId: Number(sub.sourceId) }), 'Row suspended; new row opened.'); if (r.ok) { setMode(null); reload(); } }}>Suspend and open new row</Btn>
        </div>
      )}
    </div>
  );
}

// ---------- drafts ----------

function DraftCard({ draft, reload, locked }) {
  const call = useCall();
  const toast = useToastStore((s) => s.addToast);
  const c = draft.content;
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ subject: c.subject, to: (c.to || []).join(', '), cc: (c.cc || []).join(', ') });
  const [accepted, setAccepted] = useState({});
  const results = (draft.verdict && draft.verdict.results) || [];
  const open = results.filter((r) => r.verdict !== 'pass');
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const color = draft.verdict.verdict === 'pass' ? GOOD : draft.verdict.verdict === 'fail' ? BAD : WARN;

  const approve = async () => {
    const acceptedWarnings = open.filter((r) => r.verdict === 'needs_review' && accepted[`${r.index}:${r.code}`]).map((r) => ({ index: r.index, code: r.code }));
    const r = await call(() => api.post(`/api/email-follow-up/drafts/${draft.id}/approve`, { acceptedWarnings }), 'Approved.');
    if (r.ok) reload();
  };
  const copy = async () => {
    const r = await call(() => api.post(`/api/email-follow-up/drafts/${draft.id}/copy`, {}));
    if (!r.ok) { reload(); return; }
    const d = r.data;
    try {
      await navigator.clipboard.writeText(`To: ${(d.to || []).join(', ')}\n${(d.cc || []).length ? `Cc: ${d.cc.join(', ')}\n` : ''}Subject: ${d.subject}\n\n${d.body}`);
      toast('Copied. Paste it into your own mail program; nothing was sent.');
    } catch { toast('Copy was blocked by the browser.', 'error'); }
  };
  const save = async () => {
    const r = await call(() => api.patch(`/api/email-follow-up/drafts/${draft.id}`, { subject: f.subject, to: list(f.to), cc: list(f.cc) }), 'Saved as a new version. It needs approving again.');
    if (r.ok) { setEdit(false); reload(); }
  };

  return (
    <div className="rounded-xl border p-4 space-y-2" style={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{c.subject}</span>
        <Badge color={color}>{draft.verdict.verdict.replace('_', ' ')}</Badge>
        <Badge color={draft.status === 'approved' ? GOOD : undefined}>{draft.status}</Badge>
        <Badge>version {draft.version}</Badge>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>To: {(c.to || []).join(', ') || 'no recipient yet'}{(c.cc || []).length ? ` · Cc: ${c.cc.join(', ')}` : ''}</p>
      <pre className="text-xs whitespace-pre-wrap rounded-lg p-3" style={{ background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: 'inherit' }}>{c.body}</pre>
      {open.length > 0 && (
        <div className="space-y-1.5">
          {open.map((r) => (
            <label key={`${r.index}:${r.code}`} className="flex items-start gap-2 text-xs" style={{ color: r.verdict === 'fail' ? BAD : WARN }}>
              {r.verdict === 'needs_review' && r.code !== 'SUPERSEDED_VERSION' && draft.status === 'pending' && (
                <Tooltip text={EF_TIPS.warning}>
                  <input type="checkbox" className="mt-0.5" aria-label="I have read this warning" checked={!!accepted[`${r.index}:${r.code}`]} onChange={(e) => setAccepted({ ...accepted, [`${r.index}:${r.code}`]: e.target.checked })} />
                </Tooltip>
              )}
              <span>{r.verdict === 'fail' ? 'Blocked: ' : 'Check: '}{r.message}{r.question ? ` ${r.question}` : ''}</span>
            </label>
          ))}
        </div>
      )}
      {edit && (
        <div className="space-y-2">
          <Tooltip text={EF_TIPS.draftSubject}><div><VoiceInput value={f.subject} onChange={(v) => setF({ ...f, subject: v })} placeholder="Subject" /></div></Tooltip>
          <Tooltip text={EF_TIPS.draftTo}>
            <input className={`${FIELD} w-full text-xs`} style={FIELD_STYLE} aria-label="To" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} placeholder="To (comma separated)" />
          </Tooltip>
          <Tooltip text={EF_TIPS.draftCc}>
            <input className={`${FIELD} w-full text-xs`} style={FIELD_STYLE} aria-label="Cc" value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} placeholder="Cc (optional)" />
          </Tooltip>
          <Btn small primary onClick={save} tip={EF_TIPS.saveVersion}>Save as new version</Btn>
        </div>
      )}
      {!locked && <div className="flex flex-wrap gap-2">
        {draft.status === 'pending' && <Btn small primary disabled={draft.verdict.verdict === 'fail'} onClick={approve} tip={EF_TIPS.approve}>Approve</Btn>}
        {draft.status === 'approved' && <Btn small primary onClick={copy} tip={EF_TIPS.copy}>Copy to send myself</Btn>}
        {(draft.status === 'pending' || draft.status === 'approved') && <Btn small onClick={() => setEdit(!edit)} tip={EF_TIPS.editRecipients}>Edit recipients</Btn>}
        {draft.status !== 'declined' && <Btn small tip={EF_TIPS.decline} onClick={async () => { const r = await call(() => api.post(`/api/email-follow-up/drafts/${draft.id}/decline`, {}), 'Declined.'); if (r.ok) reload(); }}>Decline</Btn>}
      </div>}
    </div>
  );
}

// ---------- summary and ask ----------

const STATUS_COLOR = { agreed: GOOD, proposed: WARN, disputed: BAD, open: 'var(--color-muted)' };

/** [S3] markers in a sentence become small numbered chips; hovering one shows which email or attachment it is. */
function WithSources({ text, index }) {
  // **bold** labels, then [S3] markers inside each piece
  const pieces = String(text || '').split(/(\*\*[^*\n]+\*\*)/g);
  const chips = (str, k) => str.split(/(\[S\d+\])/g).map((p, i) => {
    const m = /^\[S(\d+)\]$/.exec(p);
    if (!m) return <React.Fragment key={`${k}-${i}`}>{p}</React.Fragment>;
    return <SourceChip key={`${k}-${i}`} n={Number(m[1])} index={index} />;
  });
  return (
    <>
      {pieces.map((p, k) => (/^\*\*[^*\n]+\*\*$/.test(p) ? <strong key={k}>{chips(p.slice(2, -2), k)}</strong> : <React.Fragment key={k}>{chips(p, k)}</React.Fragment>))}
    </>
  );
}

/** An answer written as short paragraphs and "- " lines: shown as paragraphs and a bulleted list, not one wall of text. */
function RichText({ text, index }) {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="space-y-2.5">
      {blocks.map((b, bi) => {
        const parts = [];
        let list = null;
        for (const line of b.split('\n')) {
          const m = /^\s*(?:[-*\u2022])\s+(.*)$/.exec(line);
          if (m) { if (!list) { list = []; parts.push({ list }); } list.push(m[1]); } else { list = null; if (line.trim()) parts.push({ line: line.trim() }); }
        }
        return (
          <div key={bi} className="space-y-1">
            {parts.map((p, pi) => (p.list
              ? <ul key={pi} className="list-disc pl-5 space-y-1">{p.list.map((li, k) => <li key={k} className="text-sm leading-relaxed"><WithSources text={li} index={index} /></li>)}</ul>
              : <p key={pi} className="text-sm leading-relaxed"><WithSources text={p.line} index={index} /></p>))}
          </div>
        );
      })}
    </div>
  );
}

function SourceChip({ n, index }) {
  const s = index.find((x) => x.n === n);
  const tip = s ? `${s.label}${s.date ? `, ${new Date(s.date).toLocaleDateString()}` : ''}${s.ocr ? ' (read by OCR: check the figures)' : ''}` : 'An email or attachment of this case.';
  return (
    <Tooltip text={tip}>
      <span className="inline-block text-xs font-medium px-1.5 mx-0.5 rounded align-baseline" style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}>{n}</span>
    </Tooltip>
  );
}

function Chips({ list, index }) {
  if (!list || !list.length) return <Badge color={WARN}>no source cited</Badge>;
  return <span className="whitespace-nowrap">{list.map((n) => <SourceChip key={n} n={n} index={index} />)}</span>;
}

function Quote({ quote, n, index }) {
  if (!quote) return null;
  return (
    <p className="text-xs leading-relaxed border-l-2 pl-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
      "{quote}" <SourceChip n={n} index={index} />
    </p>
  );
}

function SummaryView({ result, onCopy }) {
  const { summary: s, sources: index, cut, left } = result;
  return (
    <div className="space-y-4">
      {s.overview && <p className="text-sm leading-relaxed"><WithSources text={s.overview} index={index} /></p>}
      {s.terms.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Where each point stands</h3>
          {s.terms.map((t, i) => (
            <div key={i} className="rounded-xl border p-3 space-y-1.5" style={CARD}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{t.topic}</span>
                <Badge color={STATUS_COLOR[t.status]}>{t.status}</Badge>
                <Chips list={t.sources} index={index} />
              </div>
              <p className="text-sm leading-relaxed"><WithSources text={t.position} index={index} /></p>
              <Quote quote={t.quote} n={t.quoteSource} index={index} />
            </div>
          ))}
        </div>
      )}
      {s.inconsistencies.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold" style={{ color: BAD }}>Things that disagree</h3>
          {s.inconsistencies.map((t, i) => <p key={i} className="text-sm leading-relaxed"><WithSources text={t.note} index={index} /> <Chips list={t.sources} index={index} /></p>)}
        </div>
      )}
      {s.openPoints.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold">Still open</h3>
          <ul className="list-disc pl-5 space-y-1">{s.openPoints.map((t, i) => <li key={i} className="text-sm leading-relaxed"><WithSources text={t.point} index={index} /> <Chips list={t.sources} index={index} /></li>)}</ul>
        </div>
      )}
      {s.timeline.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold">Timeline</h3>
          <ul className="space-y-1">{s.timeline.map((t, i) => (
            <li key={i} className="text-sm leading-relaxed flex gap-3"><span className="text-xs w-20 shrink-0 pt-0.5" style={{ color: 'var(--color-muted)' }}>{t.date || 'date unclear'}</span><span><WithSources text={t.event} index={index} /> <Chips list={t.sources} index={index} /></span></li>
          ))}</ul>
        </div>
      )}
      <ReadNotes cut={cut} left={left} stats={s.stats} />
      <Btn small tip={EF_TIPS.copyAnswer} onClick={onCopy}>Copy this summary</Btn>
    </div>
  );
}

function ReadNotes({ cut, left, stats }) {
  const lines = [];
  if (cut && cut.length) lines.push(`${cut.length} long item${cut.length === 1 ? ' was' : 's were'} read only in part: ${cut.slice(0, 3).map((c) => c.label).join('; ')}.`);
  if (left && left.length) lines.push(`Not given to the AI: ${left.join('; ')}.`);
  if (stats && stats.truncated) lines.push("The AI's reply was cut off before it finished, so the end may be missing. Everything shown was complete. Ask a narrower question, or choose a more capable model in Settings, Email Follow-Up.");
  if (stats && stats.droppedQuotes) lines.push(`${stats.droppedQuotes} quote${stats.droppedQuotes === 1 ? '' : 's'} the AI offered could not be found word for word in the mail and ${stats.droppedQuotes === 1 ? 'was' : 'were'} left out.`);
  if (!lines.length) return null;
  return <div className="text-xs space-y-1" style={{ color: WARN }}>{lines.map((l) => <p key={l}>{l}</p>)}</div>;
}

function AskPanel({ caseId, usable, locked, state, setState }) {
  const call = useCall();
  const toast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState('');
  const [q, setQ] = useState('');
  const [showSources, setShowSources] = useState(false);
  const [quotesOpen, setQuotesOpen] = useState({}); // turn key -> true while its quotes are shown
  const [showAll, setShowAll] = useState(false);
  const SHOWN = 8; // the latest questions shown; the rest sit behind "Show earlier"
  const { summary, turns } = state;
  const sourceIndex = (summary && summary.sources) || (turns.length ? turns[turns.length - 1].sources : []) || [];

  // The whole screen shows a "still working" box with the seconds counting up while the AI reads (a long thread can take a minute or two).
  const withBox = (title, detail, label, fn) => runWithStepLog(useProcessingStore.getState(), title, detail, [label], fn);

  const summarise = async () => {
    setBusy('summary');
    const r = await withBox('Summarising your case…', `The AI is reading all ${usable} attached item${usable === 1 ? '' : 's'} together. This can take a minute or two for a long thread.`, 'Reading the mail and writing the summary',
      () => call(() => api.post(`/api/email-follow-up/${caseId}/summary`, {})));
    setBusy('');
    if (r.ok) setState((s) => ({ ...s, summary: r.data }));
  };
  const send = async () => {
    const question = q.trim();
    if (question.length < 3) return;
    setBusy('ask');
    // Only questions asked in this sitting count as the conversation so far; older saved ones are the record, not the context.
    const history = turns.filter((t) => t.live && t.answer && t.answer.answer).slice(-4).map((t) => ({ question: t.question, answer: t.answer.answer }));
    const r = await withBox('Reading your emails…', `The AI is reading all ${usable} attached item${usable === 1 ? '' : 's'} to answer your question, then checking what it quotes. This can take a minute or two.`, 'Reading the mail and writing the answer',
      () => call(() => api.post(`/api/email-follow-up/${caseId}/ask`, { question, history })));
    setBusy('');
    if (r.ok) {
      setQ('');
      if (!r.data.saved) toast('The answer could not be saved with the case. Copy it if you want to keep it.', 'error');
      setState((s) => ({ ...s, turns: [...s.turns, { key: r.data.saved ? `q${r.data.saved.id}` : `n${Date.now()}`, live: true, question, answer: r.data.answer, sources: r.data.sources, cut: r.data.cut, left: r.data.left, model: r.data.answer.model, createdAt: r.data.saved ? r.data.saved.createdAt : new Date().toISOString() }] }));
    }
  };
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { toast('Copy was blocked by the browser.', 'error'); }
  };
  const logText = () => {
    const nl = String.fromCharCode(10);
    const src = (t) => (t.sources || []).map((x) => `S${x.n} ${x.label}${x.date ? `, ${new Date(x.date).toLocaleDateString()}` : ''}`).join(nl);
    return turns.map((t) => [`Q (${new Date(t.createdAt).toLocaleString()}): ${t.question}`, '', t.answer.answer, '', 'Sources:', src(t)].join(nl)).join(`${nl}${nl}----------${nl}${nl}`);
  };
  const summaryText = () => {
    const s = summary.summary;
    const names = (list) => (list && list.length ? ` [${list.map((n) => `S${n}`).join(', ')}]` : '');
    return [s.overview, '', ...s.terms.map((t) => `${t.topic} (${t.status}): ${t.position}${names(t.sources)}`), '', ...(s.openPoints.length ? ['Still open:', ...s.openPoints.map((t) => `- ${t.point}${names(t.sources)}`)] : []),
      '', 'Sources:', ...summary.sources.map((x) => `S${x.n} ${x.label}${x.date ? `, ${new Date(x.date).toLocaleDateString()}` : ''}`)].join('\n');
  };

  return (
    <div className="space-y-5" data-guide="ask" data-tour="ef-ask">
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
        The AI reads the {usable} attached email{usable === 1 ? '' : 's'} and readable attachment{usable === 1 ? '' : 's'} together, then answers from them only. Every claim points at its source number; hover a number to see which email. It is not legal advice: check the original wording. Your questions and the answers are saved with this case, so you can come back to them; the summary is made fresh each time and is not saved.
      </p>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Btn primary disabled={busy === 'summary' || !usable} tip={EF_TIPS.summarise(usable)} onClick={summarise}>{busy === 'summary' ? 'Reading everything…' : summary ? 'Summarise again' : 'Summarise this case'}</Btn>
          {summary && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Made {new Date(summary.at).toLocaleString()} from {summary.count} item{summary.count === 1 ? '' : 's'}.</span>}
        </div>
        {summary && <SummaryView result={summary} onCopy={() => copy(summaryText())} />}
      </div>

      <div className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Ask a question</h3>
          {turns.length > 0 && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{turns.length} saved with this case</span>}
        </div>
        {turns.length > SHOWN && !showAll && <Btn small tip={EF_TIPS.showEarlier} onClick={() => setShowAll(true)}>Show {turns.length - SHOWN} earlier question{turns.length - SHOWN === 1 ? '' : 's'}</Btn>}
        {(showAll ? turns : turns.slice(-SHOWN)).map((t, i) => (
          <div key={t.key || i} className="space-y-2">
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{new Date(t.createdAt).toLocaleString()}{t.model ? ` · answered by ${t.model}` : ''} · {String(t.key || '').startsWith('q') ? <span style={{ color: GOOD }}>saved with this case ✓</span> : <span style={{ color: WARN }}>NOT saved: copy it if you want to keep it</span>}</p>
            <p className="text-sm font-medium rounded-xl px-3 py-2" style={{ background: 'var(--color-surface)' }}>{t.question}</p>
            <div className="rounded-xl border p-3 space-y-2" style={CARD}>
              <RichText text={t.answer.answer} index={t.sources} />
              {t.answer.found === false && <Badge color={WARN}>not found in these emails</Badge>}
              {t.answer.uncited && <p className="text-xs" style={{ color: WARN }}>{t.answer.unstructured && !t.answer.truncated ? 'The AI did not follow the checking format, so nothing in this answer was checked against the emails. ' : t.answer.unstructured ? 'The reply was cut off, so no quote in this answer was checked against the emails. ' : ''}This answer cites no email. Treat it with care and check it yourself.</p>}
              {t.answer.unsure && <div className="text-xs space-y-1" style={{ color: WARN }}><p className="font-medium">Unclear in the emails</p><RichText text={t.answer.unsure} index={t.sources} /></div>}
              {t.answer.citations.length > 0 && (
                <div className="space-y-1.5">
                  <Btn small tip={EF_TIPS.showQuotes} onClick={() => setQuotesOpen((q) => ({ ...q, [t.key || i]: !q[t.key || i] }))}>{quotesOpen[t.key || i] ? 'Hide the quotes' : `Show the quotes (${t.answer.citations.length})`}</Btn>
                  {quotesOpen[t.key || i] && t.answer.citations.map((c, k) => <Quote key={k} quote={c.quote} n={c.source} index={t.sources} />)}
                </div>
              )}
              <ReadNotes cut={t.cut} left={t.left} stats={{ droppedQuotes: t.answer.droppedQuotes, truncated: t.answer.truncated }} />
              <Btn small tip={EF_TIPS.copyAnswer} onClick={() => copy(t.answer.answer)}>Copy answer</Btn>
            </div>
          </div>
        ))}
        <Tooltip text={EF_TIPS.question}>
          <div><VoiceInput type="textarea" rows={2} value={q} onChange={setQ} append placeholder={usable ? 'For example: what did we agree about payment terms, and has the other side accepted the 12 month term?' : 'Attach a thread under Mail first.'} /></div>
        </Tooltip>
        <div className="flex flex-wrap gap-2">
          <Btn small primary disabled={busy === 'ask' || !usable || q.trim().length < 3} tip={EF_TIPS.askGo} onClick={send}>Ask</Btn>
          {turns.length > 0 && <Btn small tip={EF_TIPS.copyLog} onClick={() => copy(logText())}>Copy all questions and answers</Btn>}
          {sourceIndex.length > 0 && <Btn small tip={EF_TIPS.showSources} onClick={() => setShowSources(!showSources)}>{showSources ? 'Hide sources' : 'Show sources'}</Btn>}
        </div>
        {locked && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>This case is closed, but you can still read it and ask about it.</p>}
        {showSources && (
          <ul className="text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
            {sourceIndex.map((x) => <li key={x.n}><span className="font-medium" style={{ color: 'var(--color-primary)' }}>{x.n}</span> {x.label}{x.date ? `, ${new Date(x.date).toLocaleDateString()}` : ''}{x.ocr ? ' (read by OCR)' : ''}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- case ----------

export default function CaseView({ caseId, tab, onTab, onBack }) {
  const getIcon = useIcon();
  const call = useCall();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [suggest, setSuggest] = useState(null);
  const [suggestMore, setSuggestMore] = useState(false);
  const [aliases, setAliases] = useState('');
  const [lastRead, setLastRead] = useState(null);
  const [previews, setPreviews] = useState({}); // threadId -> 'loading' | messages[]
  const [lastAtt, setLastAtt] = useState(null);
  const navigate = useNavigate();
  const [editClient, setEditClient] = useState(false);
  const [clientList, setClientList] = useState([]);
  const [pickClient, setPickClient] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [delOpen, setDelOpen] = useState(false);
  const [delPreview, setDelPreview] = useState(null);
  const [delTitle, setDelTitle] = useState('');
  const [delAck, setDelAck] = useState(false);
  const [delForever, setDelForever] = useState(false);
  const [delNote, setDelNote] = useState('');
  const [removing, setRemoving] = useState(''); // threadId waiting for "Yes, remove"
  const [askState, setAskState] = useState({ summary: null, turns: [] }); // the summary and this sitting's answers, kept while you move between tabs; the questions are loaded from the saved log below
  // The saved questions come back whenever a case is opened, so the log is always there for later reference.
  useEffect(() => {
    let live = true;
    setAskState({ summary: null, turns: [] });
    api.get(`/api/email-follow-up/${caseId}/questions`).then((r) => r.json()).then((d) => {
      if (!live || !Array.isArray(d.questions)) return;
      setAskState((s) => ({ ...s, turns: d.questions.map((x) => ({ key: `q${x.id}`, live: false, question: x.question, answer: x.answer, sources: x.sources || [], cut: x.cut || [], left: x.left || [], model: x.model, createdAt: x.createdAt })) }));
    }).catch(() => { /* the log stays empty; asking still works */ });
    return () => { live = false; };
  }, [caseId]);

  const reload = useCallback(async () => {
    try {
      const r = await api.get(`/api/email-follow-up/${caseId}`);
      const d = await r.json();
      if (r.ok) { setData(d); setAliases((d.case.aliases || []).join(', ')); }
    } catch { /* leave the last view in place */ }
  }, [caseId]);
  useEffect(() => { reload(); }, [reload]);

  const startEditClient = async () => {
    setPickClient(data && data.case.clientId ? String(data.case.clientId) : '');
    setEditClient(true);
    try {
      const r = await api.get('/api/clients');
      const d = await r.json();
      const list = Array.isArray(d) ? d : (d.clients || []);
      setClientList(list.filter((x) => x && x.id && x.name).slice(0, 300));
    } catch { /* the list stays empty: the person can still choose "No CRM client" */ }
  };
  const saveClient = async () => {
    const r = await call(() => api.patch(`/api/email-follow-up/${caseId}`, { clientId: pickClient ? Number(pickClient) : null }), 'Saved.');
    if (r.ok) { setEditClient(false); reload(); }
  };

  const doClose = async () => {
    const r = await call(() => api.patch(`/api/email-follow-up/${caseId}`, { status: 'closed', closeReason }), 'Case closed.');
    if (r.ok) { setCloseOpen(false); setCloseReason(''); reload(); }
  };
  const doReopen = async () => {
    const r = await call(() => api.patch(`/api/email-follow-up/${caseId}`, { status: 'active' }), 'Case reopened.');
    if (r.ok) reload();
  };
  const openDelete = async () => {
    setDelTitle(''); setDelAck(false); setDelForever(false); setDelNote('');
    const r = await call(() => api.get(`/api/email-follow-up/${caseId}/delete-preview`));
    if (r.ok) { setDelPreview(r.data); setDelOpen(true); }
  };
  const doDelete = async () => {
    try {
      const res = await api.delete(`/api/email-follow-up/${caseId}`, { confirmTitle: delTitle, acknowledgeApprovals: delAck, forever: delForever });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (d.tooLarge) { setDelForever(true); setDelNote(d.error); return; }
        useToastStore.getState().addToast(d.error || 'Could not delete the case.', 'error');
        return;
      }
      if (d.binId) offerUndo({ message: 'Case deleted. A copy stays in Settings, Recycle bin for 30 days.', binIds: [d.binId], restoredMessage: 'Case restored.', after: () => {} });
      else useToastStore.getState().addToast('Case deleted for good.');
      onBack();
    } catch { useToastStore.getState().addToast('Could not reach the server.', 'error'); }
  };
  const threadAction = async (threadId, what, body) => {
    const r = await call(() => api.post(`/api/email-follow-up/${caseId}/threads/${threadId}/${what}`, body || {}));
    setRemoving('');
    if (r.ok) reload();
  };

  const togglePreview = async (threadId) => {
    if (previews[threadId]) { setPreviews((p) => { const n = { ...p }; delete n[threadId]; return n; }); return; }
    setPreviews((p) => ({ ...p, [threadId]: 'loading' }));
    const r = await call(() => api.get(`/api/email-follow-up/${caseId}/threads/${threadId}/preview`));
    setPreviews((p) => { const n = { ...p }; if (r.ok) n[threadId] = r.data.messages; else delete n[threadId]; return n; });
  };

  if (!data) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  const { case: c, rows, sources, drafts, sentSweep, coverage, draftCap } = data;
  const locked = c.status === 'closed' || c.status === 'abandoned';
  const unread = sources.filter((s) => !s.extractedAt && !s.setAsideAt && s.parseStatus === 'parsed').length;
  const messages = sources.filter((s) => s.kind !== 'document');
  const docsOf = (id) => sources.filter((s) => s.parentId === id);
  const attPending = messages.filter((s) => !s.attachmentsFetchedAt && !s.setAsideAt && Array.isArray(s.attachments) && s.attachments.length > 0);
  const threads = [];
  for (const m of messages) {
    const key = m.threadId || `m${m.id}`;
    let t = threads.find((x) => x.key === key);
    if (!t) { t = { key, threadId: m.threadId, subject: m.subject, msgs: [] }; threads.push(t); }
    t.msgs.push(m);
  }
  const openRows = rows.filter((r) => r.status === 'open').length;
  const attPendingCount = attPending.reduce((n, s) => n + s.attachments.length, 0);
  const pending = drafts.filter((d) => d.status === 'pending').length;
  const ordered = [...rows].sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1));
  const counts = { rows: rows.length, sources: messages.length, pending, cap: draftCap };

  const run = async (key, fn, okMsg) => {
    setBusy(key);
    const r = await call(fn, okMsg);
    setBusy('');
    return r;
  };
  const draftRow = async (row) => {
    const r = await run('draft', () => api.post(`/api/email-follow-up/${caseId}/rows/${row.id}/draft`, {}), 'Draft made.');
    if (r.ok) { onTab('drafts'); reload(); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <Btn small onClick={onBack} tip={EF_TIPS.back}>← Cases</Btn>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold">{c.title}</h2>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{c.obligation}</p>
        </div>
        <Badge>{c.profile === 'professional' ? 'strict' : 'relaxed'}</Badge>
        <Badge color={c.status === 'active' ? GOOD : undefined}>{c.status}</Badge>
      </div>

      {/* The other half of the link to the CRM: this case's client, a way back to the client's page, and a way to change it. */}
      <div className="flex flex-wrap items-center gap-2 text-xs" data-tour="ef-client" data-guide="client-link">
        <span style={{ color: 'var(--color-muted)' }}>{c.clientId ? `Client: ${c.clientName || 'in your CRM'}` : 'Not linked to a CRM client'}</span>
        {c.clientId && <Btn small tip={EF_TIPS.openClient} onClick={() => navigate(`/clients/${c.clientId}`)}>Open in CRM</Btn>}
        <Btn small tip={EF_TIPS.changeClient} onClick={startEditClient}>{c.clientId ? 'Change client' : 'Link to a client'}</Btn>
        {editClient && (
          <>
            <Tooltip text={EF_TIPS.clientPick}>
              <select className={`${FIELD} text-xs`} style={FIELD_STYLE} aria-label="CRM client" value={pickClient} onChange={(e) => setPickClient(e.target.value)}>
                <option value="">No CRM client</option>
                {clientList.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
              </select>
            </Tooltip>
            <Btn small primary tip={EF_TIPS.saveClient} onClick={saveClient}>Save</Btn>
          </>
        )}
      </div>

      {locked && (
        <div className="rounded-xl border p-3 text-sm flex flex-wrap items-center gap-3" style={{ borderColor: WARN, background: 'var(--color-bg)' }}>
          <span className="flex-1 min-w-0">This case is closed{c.closeReason ? ` (${c.closeReason})` : ''}. It is read-only until you reopen it.</span>
          <Btn small primary tip={EF_TIPS.reopenCase} onClick={doReopen}>Reopen</Btn>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs" data-guide="close-case">
        {!locked && !closeOpen && <Btn small tip={EF_TIPS.closeCase} onClick={() => setCloseOpen(true)}>Close case</Btn>}
        {closeOpen && (
          <>
            <span style={{ color: 'var(--color-muted)' }}>{openRows} row{openRows === 1 ? '' : 's'} still open and {pending} draft{pending === 1 ? '' : 's'} waiting stay as they are.</span>
            <Tooltip text={EF_TIPS.closeReason}><div className="min-w-[14rem]"><VoiceInput value={closeReason} onChange={setCloseReason} placeholder="Why? (optional)" /></div></Tooltip>
            <Btn small primary tip={EF_TIPS.confirmClose} onClick={doClose}>Close case</Btn>
            <Btn small tip={EF_TIPS.cancelClose} onClick={() => setCloseOpen(false)}>Cancel</Btn>
          </>
        )}
        {!delOpen && <Btn small tip={EF_TIPS.deleteCase} onClick={openDelete}>Delete this case…</Btn>}
      </div>

      {delOpen && delPreview && (
        <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: BAD, background: 'var(--color-surface)' }}>
          <h3 className="text-base font-semibold">Delete this case?</h3>
          <p className="text-sm leading-relaxed">
            This removes {delPreview.messages} message{delPreview.messages === 1 ? '' : 's'}, {delPreview.attachments} attachment{delPreview.attachments === 1 ? '' : 's'}, {delPreview.drafts} draft{delPreview.drafts === 1 ? '' : 's'}, {delPreview.approvals} approval record{delPreview.approvals === 1 ? '' : 's'}, {delPreview.sweeps} Sent check{delPreview.sweeps === 1 ? '' : 's'}, {delPreview.questions || 0} saved question{delPreview.questions === 1 ? '' : 's'} and the ledger of {delPreview.rows} row{delPreview.rows === 1 ? '' : 's'}.
            Your Gmail is not touched.{delPreview.tasks ? ` The ${delPreview.tasks} task${delPreview.tasks === 1 ? '' : 's'} made from this case stay in Tasks.` : ''} A copy waits 30 days in Settings, Recycle bin, unless you choose Delete forever below.
          </p>
          {delPreview.approvedEver > 0 && (
            <label className="flex items-start gap-2 text-sm" style={{ color: BAD }}>
              <Tooltip text={EF_TIPS.deleteAck}><input type="checkbox" className="mt-1" aria-label="I understand the approval record goes too" checked={delAck} onChange={(e) => setDelAck(e.target.checked)} /></Tooltip>
              <span>This case has {delPreview.approvedEver} approved draft{delPreview.approvedEver === 1 ? '' : 's'}. Deleting it deletes the record that {delPreview.approvedEver === 1 ? 'it was' : 'they were'} approved and copied; Vault keeps no other copy of that wording. I understand.</span>
            </label>
          )}
          <Tooltip text={EF_TIPS.deleteTitle}>
            <input className={`${FIELD} w-full text-sm`} style={FIELD_STYLE} aria-label="Type the case name to confirm" placeholder={`Type "${c.title}" to confirm`} value={delTitle} onChange={(e) => setDelTitle(e.target.value)} />
          </Tooltip>
          <label className="flex items-start gap-2 text-sm">
            <Tooltip text={EF_TIPS.deleteForever}><input type="checkbox" className="mt-1" aria-label="Delete forever now" checked={delForever} onChange={(e) => setDelForever(e.target.checked)} /></Tooltip>
            <span>Delete forever now: skip the recycle bin. This cannot be undone.{delNote ? ` ${delNote}` : ''}</span>
          </label>
          <div className="flex gap-2">
            <Btn small danger tip={EF_TIPS.deleteConfirm} disabled={delTitle.trim() !== String(c.title).trim() || (delPreview.approvedEver > 0 && !delAck)} onClick={doDelete}>{delForever ? 'Delete forever' : 'Delete case'}</Btn>
            <Btn small tip={EF_TIPS.deleteCancel} onClick={() => setDelOpen(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      <div className="rounded-2xl border p-4 space-y-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} data-tour="ef-people">
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip text={EF_TIPS.people}>
            <input className={`${FIELD} flex-1 min-w-[14rem] text-xs`} style={FIELD_STYLE} aria-label="People in this case" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Email addresses of the people in this case, comma separated" />
          </Tooltip>
          <Btn small tip={EF_TIPS.savePeople} onClick={async () => { const r = await call(() => api.patch(`/api/email-follow-up/${caseId}`, { aliases: aliases.split(',').map((x) => x.trim()).filter(Boolean) }), 'Saved.'); if (r.ok) reload(); }}>Save people</Btn>
        </div>
        <div className="flex flex-wrap gap-2" data-tour="ef-steps" data-guide="mail">
          <Btn small disabled={locked || busy === 'find'} tip={EF_TIPS.findMail} onClick={async () => { const r = await run('find', () => api.get(`/api/email-follow-up/${caseId}/suggestions`)); if (r.ok) { setSuggest(r.data.threads); setSuggestMore(!!r.data.more); onTab('mail'); } }}>1. Find mail</Btn>
          <Btn small disabled={locked || busy === 'att' || !attPendingCount} tip={EF_TIPS.getAttachments(attPendingCount)} onClick={async () => { const r = await run('att', () => api.post(`/api/email-follow-up/${caseId}/attachments`, {})); if (r.ok) { setLastAtt(r.data); reload(); } }}>{busy === 'att' ? 'Fetching…' : `2. Get ${attPendingCount || 'no'} attachment${attPendingCount === 1 ? '' : 's'}`}</Btn>
          <Btn small primary disabled={locked || busy === 'read' || !unread} tip={EF_TIPS.read(unread)} onClick={async () => { const r = await run('read', () => api.post(`/api/email-follow-up/${caseId}/extract`, {})); if (r.ok) { setLastRead(r.data); reload(); } }}>{busy === 'read' ? 'Reading…' : `3. Read ${unread || 'no'} new item${unread === 1 ? '' : 's'}`}</Btn>
          <Btn small disabled={locked || busy === 'sweep'} tip={EF_TIPS.checkSent} onClick={async () => { const r = await run('sweep', () => api.post(`/api/email-follow-up/${caseId}/sent-sweep`, {})); if (r.ok) { useToastStore.getState().addToast(r.data.completed ? 'Sent mail checked.' : `Looked at ${r.data.scanned} sent messages so far. Press Check Sent again to carry on.`); reload(); } }}>{busy === 'sweep' ? 'Checking…' : sentSweep && sentSweep.partial ? '4. Check Sent (continue)' : '4. Check Sent'}</Btn>
        </div>
        <p className="text-xs" style={{ color: sentSweep && sentSweep.completed ? GOOD : WARN }}>
          {sentSweep ? (sentSweep.completed ? `Sent checked ${new Date(sentSweep.at).toLocaleString()} (${sentSweep.found} new).` : sentSweep.partial ? `Sent check in progress: ${sentSweep.scanned} messages looked at so far. Press Check Sent again to carry on until it says it is finished.` : `Last Sent check failed: ${sentSweep.error || 'unknown'}. Draft follow-up will try again, and drafts nothing until it works.`) : 'Sent has not been checked yet. Draft follow-up checks it for you when you chase someone.'}
        </p>
        {lastAtt && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Attachments: {lastAtt.parsed} read{lastAtt.ocr ? ` (${lastAtt.ocr} of them scans read by OCR)` : ''}, {lastAtt.referenceOnly} kept without text (pictures, spreadsheets, unreadable scans), {lastAtt.failed} could not be read.
            {lastAtt.remainingMessages > 0 && ` ${lastAtt.remainingMessages} more message${lastAtt.remainingMessages === 1 ? '' : 's'} to go: press again (scans are read a few at a time).`}
          </p>
        )}
        {lastRead && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Read {lastRead.read}: {lastRead.added} new, {lastRead.evidence} restated, {lastRead.superseded} changed{lastRead.conflicts ? `, ${lastRead.conflicts} disagreeing` : ''}.
            {lastRead.dropped.length > 0 && ` ${lastRead.dropped.length} dropped (${[...new Set(lastRead.dropped.map((d) => d.reason))].slice(0, 3).join('; ')}).`}
            {lastRead.remaining > 0 && ` ${lastRead.remaining} more to read.`}
            {lastRead.stopped && ` Stopped early (${lastRead.stopped}). What was read is kept: press again to carry on.`}
          </p>
        )}
      </div>

      <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: 'var(--color-border)' }} data-tour="ef-tabs">
        {TABS.map(([id, tipKey, label]) => (
          <Tooltip key={id} text={EF_TIPS[tipKey]}>
            <button type="button" onClick={() => onTab(id)} className="px-3 py-2 text-sm font-medium whitespace-nowrap hover:opacity-70 transition-opacity" style={{ color: tab === id ? 'var(--color-primary)' : 'var(--color-muted)', borderBottom: tab === id ? '2px solid var(--color-primary)' : '2px solid transparent' }}>{label(counts)}</button>
          </Tooltip>
        ))}
      </div>

      {tab === 'ledger' && (
        <div className="space-y-3" data-guide="ledger" data-tour="ef-ledger">
          {!ordered.length && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Nothing recorded yet. Attach a thread under Mail, then press "Read new messages".</p>}
          {ordered.map((r) => <RowCard key={r.id} row={r} caseId={caseId} sources={sources} reload={reload} onDraft={draftRow} locked={locked} />)}
        </div>
      )}

      {tab === 'ask' && <AskPanel caseId={caseId} usable={sources.filter((s) => !s.setAsideAt && s.parseStatus === 'parsed' && s.channel !== 'note').length} locked={locked} state={askState} setState={setAskState} />}

      {tab === 'mail' && (
        <div className="space-y-4">
          {suggest && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Threads with these people</h3>
              {!suggest.length && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nothing new found. Check the addresses above.</p>}
              {suggestMore && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>There are older threads with these people. Attach what you need from the newest, then press Find mail again to reach further back.</p>}
              {suggest.map((t) => (
                <div key={t.threadId} className="rounded-xl border p-3 space-y-2" style={CARD}>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.subject}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>{t.from} · {t.messages} message{t.messages === 1 ? '' : 's'}{t.date ? ` · ${new Date(t.date).toLocaleDateString()}` : ''}</p>
                    </div>
                    <Btn small tip={previews[t.threadId] ? EF_TIPS.hidePreview : EF_TIPS.preview} onClick={() => togglePreview(t.threadId)}>{previews[t.threadId] ? 'Hide' : 'Preview'}</Btn>
                    <Btn small primary tip={EF_TIPS.attach} onClick={async () => { const r = await call(() => api.post(`/api/email-follow-up/${caseId}/threads`, { threadId: t.threadId }), 'Attached.'); if (r.ok) { setSuggest(suggest.filter((x) => x.threadId !== t.threadId)); reload(); } }}>Attach to case</Btn>
                  </div>
                  {t.snippet && !previews[t.threadId] && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.snippet}</p>}
                  {previews[t.threadId] === 'loading' && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
                  {Array.isArray(previews[t.threadId]) && (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {previews[t.threadId].map((m, i) => (
                        <div key={i} className="rounded-lg p-3 text-xs space-y-1" style={{ background: 'var(--color-surface)' }}>
                          <p className="font-medium">{m.sent ? 'You sent' : 'From'} {m.from}{m.date ? ` · ${new Date(m.date).toLocaleString()}` : ''}</p>
                          <p className="whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{m.body || '(no text)'}</p>
                          {m.attachments.length > 0 && <p style={{ color: WARN }}>Attachments (names only here; attach the thread, then press Get attachments to read them): {m.attachments.join(', ')}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Attached to this case</h3>
            {!messages.length && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No mail attached. Press "1. Find mail" above.</p>}
            {threads.map((t) => {
              const aside = t.msgs.every((m) => m.setAsideAt);
              return (
                <div key={t.key} className="rounded-xl border p-3 space-y-2" style={{ ...CARD, opacity: aside ? 0.65 : 1 }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold flex-1 min-w-0 truncate">{t.subject || '(no subject)'}</span>
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.msgs.length} message{t.msgs.length === 1 ? '' : 's'}{aside ? ' · set aside: kept, not read' : ''}</span>
                    {t.threadId && !locked && (aside
                      ? <Btn small tip={EF_TIPS.bringBack} onClick={() => threadAction(t.threadId, 'set-aside', { aside: false })}>Bring back</Btn>
                      : <Btn small tip={EF_TIPS.setAside} onClick={() => threadAction(t.threadId, 'set-aside', { aside: true })}>Set aside</Btn>)}
                    {t.threadId && !locked && removing !== t.threadId && <Btn small tip={EF_TIPS.removeThread} onClick={() => setRemoving(t.threadId)}>Remove</Btn>}
                    {removing === t.threadId && (
                      <>
                        <Btn small danger tip={EF_TIPS.confirmRemove} onClick={() => threadAction(t.threadId, 'detach')}>Yes, remove</Btn>
                        <Btn small tip={EF_TIPS.cancelRemove} onClick={() => setRemoving('')}>No</Btn>
                      </>
                    )}
                  </div>
                  {t.msgs.map((s) => (
                    <div key={s.id} className="text-xs space-y-1 pl-3 border-l-2" style={{ borderColor: 'var(--color-border)' }}>
                      <p className="font-medium">{s.label}</p>
                      <p style={{ color: 'var(--color-muted)' }}>{s.receivedAt ? new Date(s.receivedAt).toLocaleString() : 'no date'} · {s.extractedAt ? 'read' : aside ? 'not read' : 'not read yet'}{s.parseReason ? ` · ${s.parseReason}` : ''}</p>
                      {docsOf(s.id).map((d) => (
                        <p key={d.id} className="pl-3 border-l-2" style={{ borderColor: 'var(--color-border)', color: d.parseStatus === 'failed' ? BAD : d.parseStatus === 'parsed' ? GOOD : 'var(--color-muted)' }}>
                          {d.filename || 'file'} — {d.parseStatus === 'parsed' ? `read${/tesseract/.test(d.parser || '') ? ' by OCR (check the figures)' : ''}${d.extractedAt ? ' into the ledger' : ', not yet read into the ledger'}` : d.parseStatus === 'failed' ? `could not be read: ${d.parseReason}` : `not read: ${d.parseReason}`}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'drafts' && (
        <div className="space-y-3" data-guide="drafts" data-tour="ef-drafts">
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Drafts are text for you to paste into your own mail program. This tool never sends anything. Every sentence quotes a message; a sentence the guard cannot back is blocked or flagged.</p>
          {!drafts.length && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No drafts yet. Use "Draft follow-up" on a ledger row.</p>}
          {drafts.map((d) => <DraftCard key={d.id} draft={d} reload={reload} locked={locked} />)}
        </div>
      )}

      {tab === 'coverage' && (
        <div className="space-y-3 text-sm" data-guide="coverage">
          <p>{coverage.read.messages} message{coverage.read.messages === 1 ? '' : 's'}{coverage.read.attachments ? ` and ${coverage.read.attachments} attachment${coverage.read.attachments === 1 ? '' : 's'}` : ''} read{coverage.read.from ? ` (${coverage.read.from.slice(0, 10)} to ${coverage.read.to.slice(0, 10)})` : ''}.</p>
          <div><h3 className="font-semibold text-sm">This tool could not see</h3><ul className="list-disc pl-5 text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>{coverage.notVisible.map((n) => <li key={n}>{n}</li>)}</ul></div>
          <div><h3 className="font-semibold text-sm">You need to check yourself</h3><ul className="list-disc pl-5 text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>{coverage.verify.map((n) => <li key={n}>{n}</li>)}</ul></div>
          <Btn small tip={EF_TIPS.copyCoverage} onClick={async () => { try { await navigator.clipboard.writeText(coverage.text); useToastStore.getState().addToast('Copied.'); } catch { /* blocked */ } }}>{getIcon('copy', { size: 12 })} Copy this</Btn>
        </div>
      )}
    </div>
  );
}
