// "Save" group of PDF Tools: review the signed PDFs Vault keeps, and file a PDF (often a signed result handed on with
// "Continue with…") as a new note, or on a CRM client.
// Uses the existing attachment routes as-is: POST /api/notes + /api/notes/:id/attachments, and POST /api/clients/:id/attachments.
// Imports from PdfPage are only used while rendering, so the circular import is safe (same as PdfExtraTools).
import { useState, useEffect } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import { offerUndo } from '../../utils/binUndo';
import { ToolHeader, PdfUpload, RunBtn, ErrMsg, PdfPagePreview, readFileAsDataUrl, dataUrlToUint8Array, getPdfPageCount } from '../PdfPage';

const lbl = 'block text-xs font-medium mb-1';
const inp = 'w-full text-sm px-3 py-2 rounded-lg border outline-none';
const inpStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const muted = { color: 'var(--color-muted)' };
const stem = (name) => String(name || 'document').replace(/\.pdf$/i, '');

function usePdf(onLoaded) {
  const [file, setFile] = useState(null);
  const onChange = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    const dataUrl = await readFileAsDataUrl(f);
    setFile({ name: f.name, dataUrl, size: f.size, pageCount: await getPdfPageCount(dataUrl) });
    onLoaded?.(f);
  };
  return [file, setFile, onChange];
}

// Upload the PDF as multipart `file` to an attachment route; returns the parsed JSON or throws in plain words.
async function attachPdf(url, file) {
  const form = new FormData();
  form.append('file', new Blob([dataUrlToUint8Array(file.dataUrl)], { type: 'application/pdf' }), file.name.toLowerCase().endsWith('.pdf') ? file.name : `${file.name}.pdf`);
  const res = await api.postForm(url, form);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The PDF could not be attached.');
  return data;
}

function Saved({ text, href }) {
  return (
    <p className="mt-3 text-sm" style={{ color: 'var(--color-text)' }}>
      {text} <a href={href} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--color-primary)' }}>Open</a>
    </p>
  );
}

// ═══ Save to Notes ════════════════════════════════════════════════════════════
export function SaveToNoteTool({ getIcon, onHelp }) {
  const [title, setTitle] = useState('');
  const [file, setFile, onChange] = usePdf((f) => { setTitle(stem(f.name)); setDone(null); setError(''); });
  const [projects, setProjects] = useState(null); // null = loading
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // note id

  useEffect(() => {
    api.get('/api/projects').then(r => (r.ok ? r.json() : [])).then(d => setProjects(Array.isArray(d) ? d : [])).catch(() => setProjects([]));
  }, []);

  const run = async () => {
    if (!file) return;
    setBusy(true); setError(''); setDone(null);
    let noteId = null;
    try {
      const res = await api.post('/api/notes', { title: title.trim() || stem(file.name), body: `PDF attached: ${file.name}\n`, project_id: projectId ? Number(projectId) : null });
      const note = await res.json().catch(() => ({}));
      if (!res.ok || !note.id) throw new Error(note.error || 'The note could not be saved. Try again.');
      noteId = note.id;
      await attachPdf(`/api/notes/${noteId}/attachments`, file);
      setDone(noteId);
    } catch (err) {
      // The note is kept even if the attachment failed, so say so and still link to it.
      setError(noteId ? `The note was saved, but the PDF could not be attached: ${err.message}` : err.message);
      if (noteId) setDone(noteId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <ToolHeader id="savetonote" label="Save to Notes" onHelp={onHelp} getIcon={getIcon} />
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <Tooltip text="Upload the PDF to keep, or send a result here with Continue with… in the result window.">
            <div><PdfUpload onChange={onChange} files={file ? [file] : []} onRemove={() => { setFile(null); setDone(null); }} /></div>
          </Tooltip>
          <div className="mt-3">
            <label className={lbl} style={muted} htmlFor="pdf-note-title">Note title</label>
            <input id="pdf-note-title" type="text" className={inp} style={inpStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="Title for the new note" maxLength={200} />
          </div>
          <div className="mt-3">
            <label className={lbl} style={muted} htmlFor="pdf-note-project">Project</label>
            <select id="pdf-note-project" className={inp} style={inpStyle} value={projectId} onChange={e => setProjectId(e.target.value)} disabled={!projects}>
              <option value="">{projects === null ? 'Loading projects…' : 'No project'}</option>
              {(projects || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <ErrMsg msg={error} />
          <RunBtn onClick={run} busy={busy} disabled={!file} label="Save as a new note" getIcon={getIcon} />
          {done && !error && <Saved text="Saved to Notes ✓" href={`/notes?note=${done}`} />}
          {done && error && <Saved text="The note without the PDF:" href={`/notes?note=${done}`} />}
        </div>
        <div><PdfPagePreview dataUrl={file?.dataUrl} /></div>
      </div>
    </section>
  );
}

// ═══ Signed PDFs ══════════════════════════════════════════════════════════════
// The copies Fill & Sign keeps (GET /api/pdf/signatures). Opening one shows it in the result window, where the preview's
// Signing record box checks it and "Continue with…" can send it on (for example to Save to Notes).
export function SignedPdfsTool({ getIcon, onHelp, setResultModal }) {
  const [rows, setRows] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(null); // signingId being fetched
  const [confirming, setConfirming] = useState(null); // signingId showing "Delete? Yes / No"

  const load = () => api.get('/api/pdf/signatures')
    .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Could not load your signed PDFs.'); setRows(d.signatures || []); })
    .catch(err => { setError(err.message); setRows(rows => rows || []); });
  useEffect(() => { load(); }, []);

  // Goes to the shared 30-day recycle bin, with Undo (Vault's delete rule, docs/recycle-bin.md).
  const remove = async (row) => {
    setConfirming(null); setError('');
    try {
      const res = await api.delete(`/api/pdf/signatures/${row.signingId}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not delete that signed PDF.');
      setRows(rs => rs.filter(r => r.signingId !== row.signingId));
      offerUndo({ message: `Moved "${row.fileName || 'Signed PDF'}" to the recycle bin (${d.retentionDays} days).`, binIds: d.binId, after: load });
    } catch (err) {
      setError(err.message);
    }
  };

  const open = async (row) => {
    setOpening(row.signingId); setError('');
    try {
      const res = await api.get(`/api/attachments/${row.attachmentId}/download`);
      if (!res.ok) throw new Error('That signed PDF could not be opened.');
      const dataUrl = await readFileAsDataUrl(await res.blob());
      setResultModal({ dataUrl: dataUrl.replace(/^data:[^;]*;/, 'data:application/pdf;'), filename: `${stem(row.fileName)}-signed.pdf`, meta: `Signed ${new Date(row.signedAt).toLocaleString()}` });
    } catch (err) {
      setError(err.message);
    } finally {
      setOpening(null);
    }
  };

  return (
    <section>
      <ToolHeader id="signedpdfs" label="Signed PDFs" onHelp={onHelp} getIcon={getIcon} />
      <ErrMsg msg={error} />
      {rows === null && <p className="text-sm" style={muted}>Loading…</p>}
      {rows?.length === 0 && !error && <p className="text-sm" style={muted}>Nothing signed yet. PDFs you sign in Fill & Sign appear here.</p>}
      {rows?.length > 0 && (
        <ul className="divide-y rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
          {rows.map(r => (
            <li key={r.signingId} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm" style={{ borderColor: 'var(--color-border)' }}>
              <div className="min-w-0">
                <p className="truncate" style={{ color: 'var(--color-text)' }}>{r.fileName || 'Untitled PDF'}</p>
                <p className="text-xs" style={muted}>{new Date(r.signedAt).toLocaleString()} · {r.signerEmail}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {confirming === r.signingId ? (
                  <>
                    <span className="text-xs" style={{ color: 'var(--color-text)' }}>Delete?</span>
                    <button type="button" onClick={() => remove(r)} className="px-2 py-1 rounded text-xs font-medium" style={{ background: '#ef4444', color: '#fff' }}>Yes</button>
                    <button type="button" onClick={() => setConfirming(null)} className="px-2 py-1 rounded text-xs border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>No</button>
                  </>
                ) : (
                  <>
                    {r.attachmentId ? (
                      <button type="button" onClick={() => open(r)} disabled={!!opening}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-80 transition-opacity disabled:opacity-40"
                        style={{ background: 'var(--color-primary)', color: '#fff' }}>
                        {opening === r.signingId ? 'Opening…' : 'Open'}
                      </button>
                    ) : (
                      <span className="text-xs" style={muted}>No copy kept</span>
                    )}
                    <Tooltip text="Move to the recycle bin. You can undo, or restore it from Settings → Recycle bin for 30 days.">
                      <button type="button" onClick={() => setConfirming(r.signingId)} aria-label={`Delete ${r.fileName || 'signed PDF'}`}
                        className="p-1.5 rounded hover:opacity-60 transition-opacity" style={muted}>
                        {getIcon('trash', { size: 14 })}
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ═══ Save to Client (CRM) ═════════════════════════════════════════════════════
export function SaveToClientTool({ getIcon, onHelp }) {
  const [file, setFile, onChange] = usePdf(() => { setDone(null); setError(''); });
  const [clients, setClients] = useState(null); // null = loading
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // client id

  useEffect(() => {
    api.get('/api/clients').then(r => (r.ok ? r.json() : [])).then(d => setClients(Array.isArray(d) ? d : [])).catch(() => setClients([]));
  }, []);

  const run = async () => {
    if (!file || !clientId) return;
    setBusy(true); setError(''); setDone(null);
    try {
      await attachPdf(`/api/clients/${clientId}/attachments`, file);
      setDone(clientId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const doneName = done && clients?.find(c => String(c.id) === String(done))?.name;
  return (
    <section>
      <ToolHeader id="savetoclient" label="Save to Client" onHelp={onHelp} getIcon={getIcon} />
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <Tooltip text="Upload the PDF to file, or send a result here with Continue with… in the result window.">
            <div><PdfUpload onChange={onChange} files={file ? [file] : []} onRemove={() => { setFile(null); setDone(null); }} /></div>
          </Tooltip>
          <div className="mt-3">
            <label className={lbl} style={muted} htmlFor="pdf-client">Client</label>
            <select id="pdf-client" className={inp} style={inpStyle} value={clientId} onChange={e => { setClientId(e.target.value); setDone(null); }} disabled={!clients}>
              <option value="">{clients === null ? 'Loading clients…' : clients.length ? 'Choose a client' : 'No clients in the CRM yet'}</option>
              {(clients || []).map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>)}
            </select>
          </div>
          <ErrMsg msg={error} />
          <RunBtn onClick={run} busy={busy} disabled={!file || !clientId} label="Add to client" getIcon={getIcon} />
          {done && <Saved text={`Added to ${doneName || 'the client'}'s files ✓`} href={`/clients/${done}`} />}
        </div>
        <div><PdfPagePreview dataUrl={file?.dataUrl} /></div>
      </div>
    </section>
  );
}
