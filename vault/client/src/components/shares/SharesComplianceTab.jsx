import React, { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { mdComponents } from '../../utils/mdComponents';
import { offerUndo } from '../../utils/binUndo';
import ConfirmModal from '../ConfirmModal';

// Shares → Compliance (admin only). A monthly-or-forced, in-app note from a fixed ATO allow-list. The server
// does the fetching, defanging and model call; this tab only shows saved reports, exports them and deletes
// them to the shared recycle bin. Server: routes/sharesCompliance.js, services/sharesCompliance/. Docs:
// docs/shares-compliance.md.

const WARN = '#f59e0b';
const BAD = '#ef4444';
const OK = '#16a34a';

const STATUS = {
  running: { label: 'Running', color: '#2563eb' },
  done: { label: 'Ready', color: OK },
  partial: { label: 'Partial — verify manually', color: WARN },
  unavailable: { label: 'Source unavailable — verify manually', color: WARN },
  failed: { label: 'Failed', color: BAD },
};

const fmtWhen = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso).slice(0, 16);
  }
};

function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.failed;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap" style={{ color: s.color, borderColor: s.color }}>
      {s.label}
    </span>
  );
}

export default function SharesComplianceTab() {
  const addToast = useToastStore((s) => s.addToast);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/shares/compliance/reports');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load reports');
      const list = Array.isArray(data) ? data : [];
      setReports(list);
      setSelected((id) => (id ? (list.find((r) => r.id === id) || null) : null));
    } catch (err) {
      addToast(err.message || 'Could not load reports', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  // A force returns 202 immediately; poll the saved row until it stops running.
  useEffect(() => {
    if (!reports.some((r) => r.status === 'running')) return undefined;
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [reports, load]);

  const force = async () => {
    if (running) return;
    setRunning(true);
    try {
      const res = await api.post('/api/shares/compliance/reports', {});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start the check');
      addToast('ATO check started. It usually takes under a minute.', 'success');
      setSelected(null);
      await load();
    } catch (err) {
      addToast(err.message || 'Could not start the check', 'error');
    } finally {
      setRunning(false);
    }
  };

  const copyMarkdown = async (report) => {
    try {
      const res = await api.get(`/api/shares/compliance/reports/${report.id}/markdown`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not copy the report');
      await navigator.clipboard.writeText(data.markdown || '');
      addToast('Report copied as Markdown', 'success');
    } catch (err) {
      addToast(err.message || 'Could not copy the report', 'error');
    }
  };

  const downloadPdf = async (report) => {
    try {
      const res = await api.get(`/api/shares/compliance/reports/${report.id}/pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not make the PDF');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'shares-compliance-advisory.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      addToast(err.message || 'Could not make the PDF', 'error');
    }
  };

  const remove = async () => {
    if (!confirmId || busy) return;
    setBusy(true);
    try {
      const res = await api.delete(`/api/shares/compliance/reports/${confirmId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not delete the report');
      setConfirmId(null);
      if (selected?.id === confirmId) setSelected(null);
      await load();
      offerUndo({
        message: 'Report deleted. Kept 30 days in the recycle bin.',
        binIds: data.binId,
        after: load,
      });
    } catch (err) {
      addToast(err.message || 'Could not delete the report', 'error');
    } finally {
      setBusy(false);
    }
  };

  const card = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
  const btnCls = 'text-xs px-2.5 py-1.5 rounded-md hover:opacity-70 transition-opacity disabled:opacity-40';

  if (loading) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading compliance reports…</p>;

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg border" style={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Compliance advisory</h2>
            <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--color-muted)' }}>
              A monthly check of a fixed ATO page list, with an AI-written note on changes that may matter for how you keep share records. It runs on the 2nd of each month; you can force one here. Past reports are kept until you delete them.
            </p>
            <p className="text-xs mt-1.5 max-w-2xl" style={{ color: 'var(--color-muted)' }}>
              General information only, not tax or legal advice. Check the linked ATO page and confirm with your accountant before changing anything. No URL from you or the page text is fetched.
            </p>
          </div>
          <button type="button" onClick={force} disabled={running} className={btnCls} style={{ background: 'var(--color-primary)', color: '#fff' }}>
            {running ? 'Starting…' : 'Check now'}
          </button>
        </div>
      </div>

      {reports.length === 0 && (
        <p className="text-sm p-4 rounded-lg border" style={{ ...card, color: 'var(--color-muted)' }}>
          No reports yet. Use Check now, or wait for the monthly run on the 2nd.
        </p>
      )}

      {reports.map((r) => (
        <div key={r.id} className="p-4 rounded-lg border" style={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{fmtWhen(r.createdAt)}</span>
              <StatusPill status={r.status} />
              <span className="text-xs capitalize" style={{ color: 'var(--color-muted)' }}>{r.trigger} check</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnCls} style={{ border: '1px solid var(--color-border)' }} onClick={() => setSelected(selected?.id === r.id ? null : r)}>
                {selected?.id === r.id ? 'Hide report' : 'View report'}
              </button>
              {r.status === 'done' && (
                <>
                  <button type="button" className={btnCls} style={{ border: '1px solid var(--color-border)' }} onClick={() => copyMarkdown(r)}>Copy Markdown</button>
                  <button type="button" className={btnCls} style={{ border: '1px solid var(--color-border)' }} onClick={() => downloadPdf(r)}>PDF</button>
                </>
              )}
              <button type="button" className={btnCls} style={{ border: '1px solid var(--color-border)', color: BAD }} onClick={() => setConfirmId(r.id)}>Delete</button>
            </div>
          </div>
          <p className="text-sm mt-2" style={{ color: 'var(--color-text)' }}>
            {r.status === 'running' ? 'Reading ATO pages and writing the note…' : (r.summary || 'No summary was available.')}
          </p>
          {r.error && r.status !== 'done' && (
            <p className="text-xs mt-1" style={{ color: WARN }}>{r.error}</p>
          )}
          {selected?.id === r.id && r.markdown && (
            <div className="mt-3 pt-3 border-t text-sm" style={{ borderColor: 'var(--color-border)' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{r.markdown}</ReactMarkdown>
            </div>
          )}
        </div>
      ))}

      {confirmId != null && (
        <ConfirmModal
          title="Delete this compliance report?"
          message="The report and its source snapshots are kept in the recycle bin for 30 days, so you can restore them."
          confirmLabel="Delete report"
          danger
          onCancel={() => setConfirmId(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}
