import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
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
  ['mail', 'tabMail', (n) => `Mail (${n.sources})`],
  ['drafts', 'tabDrafts', (n) => `Drafts (${n.pending}/${n.cap} waiting)`],
  ['coverage', 'tabCoverage', () => 'What was covered'],
];

// Every button carries a hover tip (shared Tooltip, never a native title).
function Btn({ children, onClick, primary, disabled, tip, small, ...rest }) {
  return (
    <Tooltip text={tip}>
      <button
        type="button" onClick={onClick} disabled={disabled} {...rest}
        className={`rounded-lg ${small ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'} font-medium border hover:opacity-70 transition-opacity disabled:opacity-40`}
        style={primary ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' } : { borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
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

function RowCard({ row, caseId, sources, reload, onDraft }) {
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
      {live && (
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

function DraftCard({ draft, reload }) {
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
      <div className="flex flex-wrap gap-2">
        {draft.status === 'pending' && <Btn small primary disabled={draft.verdict.verdict === 'fail'} onClick={approve} tip={EF_TIPS.approve}>Approve</Btn>}
        {draft.status === 'approved' && <Btn small primary onClick={copy} tip={EF_TIPS.copy}>Copy to send myself</Btn>}
        {(draft.status === 'pending' || draft.status === 'approved') && <Btn small onClick={() => setEdit(!edit)} tip={EF_TIPS.editRecipients}>Edit recipients</Btn>}
        {draft.status !== 'declined' && <Btn small tip={EF_TIPS.decline} onClick={async () => { const r = await call(() => api.post(`/api/email-follow-up/drafts/${draft.id}/decline`, {}), 'Declined.'); if (r.ok) reload(); }}>Decline</Btn>}
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
  const [aliases, setAliases] = useState('');
  const [lastRead, setLastRead] = useState(null);
  const [previews, setPreviews] = useState({}); // threadId -> 'loading' | messages[]
  const [lastAtt, setLastAtt] = useState(null);
  const navigate = useNavigate();
  const [editClient, setEditClient] = useState(false);
  const [clientList, setClientList] = useState([]);
  const [pickClient, setPickClient] = useState('');

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

  const togglePreview = async (threadId) => {
    if (previews[threadId]) { setPreviews((p) => { const n = { ...p }; delete n[threadId]; return n; }); return; }
    setPreviews((p) => ({ ...p, [threadId]: 'loading' }));
    const r = await call(() => api.get(`/api/email-follow-up/${caseId}/threads/${threadId}/preview`));
    setPreviews((p) => { const n = { ...p }; if (r.ok) n[threadId] = r.data.messages; else delete n[threadId]; return n; });
  };

  if (!data) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  const { case: c, rows, sources, drafts, sentSweep, coverage, draftCap } = data;
  const unread = sources.filter((s) => !s.extractedAt && s.parseStatus === 'parsed').length;
  const messages = sources.filter((s) => s.kind !== 'document');
  const docsOf = (id) => sources.filter((s) => s.parentId === id);
  const attPending = messages.filter((s) => !s.attachmentsFetchedAt && Array.isArray(s.attachments) && s.attachments.length > 0);
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

      <div className="rounded-2xl border p-4 space-y-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} data-tour="ef-people">
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip text={EF_TIPS.people}>
            <input className={`${FIELD} flex-1 min-w-[14rem] text-xs`} style={FIELD_STYLE} aria-label="People in this case" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Email addresses of the people in this case, comma separated" />
          </Tooltip>
          <Btn small tip={EF_TIPS.savePeople} onClick={async () => { const r = await call(() => api.patch(`/api/email-follow-up/${caseId}`, { aliases: aliases.split(',').map((x) => x.trim()).filter(Boolean) }), 'Saved.'); if (r.ok) reload(); }}>Save people</Btn>
        </div>
        <div className="flex flex-wrap gap-2" data-tour="ef-steps" data-guide="mail">
          <Btn small disabled={busy === 'find'} tip={EF_TIPS.findMail} onClick={async () => { const r = await run('find', () => api.get(`/api/email-follow-up/${caseId}/suggestions`)); if (r.ok) { setSuggest(r.data.threads); onTab('mail'); } }}>1. Find mail</Btn>
          <Btn small disabled={busy === 'att' || !attPendingCount} tip={EF_TIPS.getAttachments(attPendingCount)} onClick={async () => { const r = await run('att', () => api.post(`/api/email-follow-up/${caseId}/attachments`, {})); if (r.ok) { setLastAtt(r.data); reload(); } }}>{busy === 'att' ? 'Fetching…' : `2. Get ${attPendingCount || 'no'} attachment${attPendingCount === 1 ? '' : 's'}`}</Btn>
          <Btn small primary disabled={busy === 'read' || !unread} tip={EF_TIPS.read(unread)} onClick={async () => { const r = await run('read', () => api.post(`/api/email-follow-up/${caseId}/extract`, {})); if (r.ok) { setLastRead(r.data); reload(); } }}>{busy === 'read' ? 'Reading…' : `3. Read ${unread || 'no'} new item${unread === 1 ? '' : 's'}`}</Btn>
          <Btn small disabled={busy === 'sweep'} tip={EF_TIPS.checkSent} onClick={async () => { const r = await run('sweep', () => api.post(`/api/email-follow-up/${caseId}/sent-sweep`, {}), 'Sent mail checked.'); if (r.ok) reload(); }}>{busy === 'sweep' ? 'Checking…' : '4. Check Sent'}</Btn>
        </div>
        <p className="text-xs" style={{ color: sentSweep && sentSweep.completed ? GOOD : WARN }}>
          {sentSweep ? (sentSweep.completed ? `Sent checked ${new Date(sentSweep.at).toLocaleString()} (${sentSweep.found} new).` : `Last Sent check failed: ${sentSweep.error || 'unknown'}. Draft follow-up will try again, and drafts nothing until it works.`) : 'Sent has not been checked yet. Draft follow-up checks it for you when you chase someone.'}
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
          {ordered.map((r) => <RowCard key={r.id} row={r} caseId={caseId} sources={sources} reload={reload} onDraft={draftRow} />)}
        </div>
      )}

      {tab === 'mail' && (
        <div className="space-y-4">
          {suggest && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Threads with these people</h3>
              {!suggest.length && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nothing new found. Check the addresses above.</p>}
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
            {messages.map((s) => (
              <div key={s.id} className="rounded-xl border p-3 text-xs space-y-1" style={CARD}>
                <p className="font-medium text-sm">{s.label}</p>
                <p style={{ color: 'var(--color-muted)' }}>{s.receivedAt ? new Date(s.receivedAt).toLocaleString() : 'no date'} · {s.extractedAt ? 'read' : 'not read yet'}{s.parseReason ? ` · ${s.parseReason}` : ''}</p>
                {docsOf(s.id).map((d) => (
                  <p key={d.id} className="pl-3 border-l-2" style={{ borderColor: 'var(--color-border)', color: d.parseStatus === 'failed' ? BAD : d.parseStatus === 'parsed' ? GOOD : 'var(--color-muted)' }}>
                    {d.filename || 'file'} — {d.parseStatus === 'parsed' ? `read${/tesseract/.test(d.parser || '') ? ' by OCR (check the figures)' : ''}${d.extractedAt ? ' into the ledger' : ', not yet read into the ledger'}` : d.parseStatus === 'failed' ? `could not be read: ${d.parseReason}` : `not read: ${d.parseReason}`}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'drafts' && (
        <div className="space-y-3" data-guide="drafts" data-tour="ef-drafts">
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Drafts are text for you to paste into your own mail program. This tool never sends anything. Every sentence quotes a message; a sentence the guard cannot back is blocked or flagged.</p>
          {!drafts.length && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No drafts yet. Use "Draft follow-up" on a ledger row.</p>}
          {drafts.map((d) => <DraftCard key={d.id} draft={d} reload={reload} />)}
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
