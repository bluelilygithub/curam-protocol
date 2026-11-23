// "Save" group of PDF Tools: file a PDF (often a signed result handed on with "Continue with…") as a new note, or on a CRM client.
// Uses the existing attachment routes as-is: POST /api/notes + /api/notes/:id/attachments, and POST /api/clients/:id/attachments.
// Imports from PdfPage are only used while rendering, so the circular import is safe (same as PdfExtraTools).
import { useState, useEffect } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // note id

  const run = async () => {
    if (!file) return;
    setBusy(true); setError(''); setDone(null);
    let noteId = null;
    try {
      const res = await api.post('/api/notes', { title: title.trim() || stem(file.name), body: `PDF attached: ${file.name}\n` });
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
