import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import useAuthStore from '../../store/authStore';

// Accountant pack for the private share portfolio: one PDF, one Excel workbook and a zip with both plus
// the source documents (e.g. the CMC end-of-year statement). Built on the server (routes/sharesPack.js)
// from the same code as the CGT and Cash tabs. An accountant login sees this tab read-only.

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// last three financial years, newest finished year first
function fyOptions() {
  const now = new Date();
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return [start, start - 1, start - 2].map((y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`);
}
const defaultFy = () => fyOptions()[1];

const btn = 'px-3 py-1.5 rounded-lg text-sm border hover:opacity-70 transition-opacity disabled:opacity-50';
const btnStyle = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };

export default function SharesPackTab() {
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const isAccountant = useAuthStore((s) => s.user?.isAccountant);
  const [fy, setFy] = useState(defaultFy);
  const [preview, setPreview] = useState(null);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [withDocs, setWithDocs] = useState(true);
  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, d] = await Promise.all([
        api.get(`/api/shares/pack/preview?fy=${fy}`).then(async (r) => ({ ok: r.ok, body: await r.json() })),
        api.get(`/api/shares/documents?fy=${fy}`).then(async (r) => ({ ok: r.ok, body: await r.json() })),
      ]);
      if (!p.ok) throw new Error(p.body.error || 'Could not check the pack');
      setPreview(p.body);
      setDocs(Array.isArray(d.body) ? d.body : []);
    } catch (e) { addToast(e.message, 'error'); } finally { setLoading(false); }
  }, [fy, addToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (isAccountant) return;
    api.get('/api/settings').then((r) => r.json()).then((s) => { setNotes(s.shares_pack_notes || ''); setNotesSaved(s.shares_pack_notes || ''); }).catch(() => {});
  }, [isAccountant]);

  const saveNotes = async () => {
    try {
      const r = await api.post('/api/settings', { key: 'shares_pack_notes', value: notes });
      if (!r.ok) throw new Error('Could not save the notes');
      setNotesSaved(notes);
      addToast('Notes saved', 'success');
      load();
    } catch (e) { addToast(e.message, 'error'); }
  };

  const download = async (kind) => {
    setBusy(true);
    startProcessing(`Building your FY ${fy} ${kind === 'pdf' ? 'PDF' : kind === 'xlsx' ? 'Excel workbook' : 'zip'}…`, 'Please don\'t navigate away.');
    try {
      const q = `fy=${fy}${kind === 'zip' && withDocs ? '&documents=1' : ''}`;
      await api.download(`/api/shares/pack/${kind}?${q}`, `Shares-FY${fy}.${kind}`);
    } catch (e) { addToast(e.message, 'error'); } finally { stopProcessing(); setBusy(false); }
  };

  const upload = async (files) => {
    if (!files.length) return;
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    form.append('fy', fy);
    setBusy(true);
    try {
      const r = await api.postForm('/api/shares/documents', form);
      if (r.rejected?.length) addToast(`Not added: ${r.rejected.map((x) => `${x.file} (${x.error})`).join('; ')}`, 'error');
      addToast(`${r.documents?.length || 0} document(s) added`, 'success');
      await load();
    } catch (e) { addToast(e.message, 'error'); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const openDoc = async (d, dl) => {
    try { await api.download(`/api/shares/documents/${d.id}/file${dl ? '?download=1' : ''}`, d.originalName); } catch (e) { addToast(e.message, 'error'); }
  };

  const removeDoc = async (d) => {
    try {
      const r = await api.delete(`/api/shares/documents/${d.id}`);
      if (!r.ok) throw new Error('Could not delete');
      setConfirmDel(null);
      await load();
    } catch (e) { addToast(e.message, 'error'); }
  };

  const card = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Accountant pack</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Everything the accountant needs for the financial year in one go: a tax summary, sold parcels with the capital gains working, dividends with tax withheld, trades, holdings at 30 June and observations. The PDF is for reading; the Excel workbook has real numbers to copy from; the zip adds the broker statements.
        </p>
      </div>

      <div className="rounded-2xl border p-4 space-y-3" style={card}>
        <label className="text-sm flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          Financial year
          <select value={fy} onChange={(e) => setFy(e.target.value)} className="px-2 py-1 rounded-lg border text-sm"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
            {fyOptions().map((o) => <option key={o} value={o}>FY {o}</option>)}
          </select>
        </label>
        {loading && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Checking the figures…</p>}
        {preview && (
          <div className="text-sm space-y-1" style={{ color: 'var(--color-text)' }}>
            <div>{preview.reports.length} pages, {preview.period}.</div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {preview.summary.map((m) => (
                <span key={m.label}><span style={{ color: 'var(--color-muted)' }}>{m.label}: </span><strong>{AUD.format(Number(m.value) || 0)}</strong></span>
              ))}
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
          <input type="checkbox" checked={withDocs} onChange={(e) => setWithDocs(e.target.checked)} />
          Include the source documents in the zip
        </label>
        <div className="flex flex-wrap gap-2">
          <button className={btn} style={btnStyle} disabled={busy || loading} onClick={() => download('pdf')} title="One PDF with a cover, contents and every page.">Download PDF</button>
          <button className={btn} style={btnStyle} disabled={busy || loading} onClick={() => download('xlsx')} title="One Excel workbook, a sheet per page plus every trade on record.">Download Excel</button>
          <button className={btn} style={btnStyle} disabled={busy || loading} onClick={() => download('zip')} title="The PDF, the Excel workbook and, if ticked, the source documents with an index.">Download zip</button>
        </div>
      </div>

      <div className="rounded-2xl border p-4 space-y-3" style={card}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Source documents for FY {fy}</div>
            <div className="text-xs" style={{ color: 'var(--color-muted)' }}>For example the broker's end-of-year statement. Kept apart from the business documents in Finance.</div>
          </div>
          {!isAccountant && (
            <>
              <input ref={fileRef} type="file" multiple className="hidden" accept=".pdf,.jpg,.jpeg,.png,.csv,.xlsx,.xls,.txt"
                onChange={(e) => upload([...e.target.files])} />
              <button className={btn} style={btnStyle} disabled={busy} onClick={() => fileRef.current?.click()} title="Add a statement or other record to this year's pack.">Add documents</button>
            </>
          )}
        </div>
        {docs.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>None added for this year yet.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {docs.map((d) => (
              <div key={d.id} className="py-2 flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
                <div className="text-sm" style={{ color: 'var(--color-text)' }}>
                  {d.title}
                  <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>{d.originalName} · {fmtBytes(d.sizeBytes)}{d.docDate ? ` · ${fmtDate(d.docDate)}` : ''}</span>
                </div>
                <div className="flex gap-2">
                  <button className={btn} style={btnStyle} onClick={() => openDoc(d, true)}>Download</button>
                  {!isAccountant && (confirmDel === d.id ? (
                    <>
                      <button className={btn} style={{ ...btnStyle, color: '#ef4444' }} onClick={() => removeDoc(d)}>Delete for good</button>
                      <button className={btn} style={btnStyle} onClick={() => setConfirmDel(null)}>Keep</button>
                    </>
                  ) : (
                    <button className={btn} style={btnStyle} onClick={() => setConfirmDel(d.id)}>Delete</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isAccountant && (
        <div className="rounded-2xl border p-4 space-y-2" style={card}>
          <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Your notes for the accountant</div>
          <div className="text-xs" style={{ color: 'var(--color-muted)' }}>One line per point. They appear on the Observations page of every pack, after the points worked out from the data.</div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5}
            className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }} />
          <button className={btn} style={btnStyle} disabled={notes === notesSaved} onClick={saveNotes}>Save notes</button>
        </div>
      )}
    </div>
  );
}
