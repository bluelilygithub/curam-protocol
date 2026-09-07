import React, { useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';

/** Download / email a saved run as a PDF report. Requires a saved runId. */
export default function ProductScoutReportActions({ runId }) {
  const addToast = useToastStore((s) => s.addToast);
  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [email, setEmail] = useState('');

  if (!runId) return null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await api.download(`/api/product-scout/runs/${runId}/pdf`, 'product-scout-report.pdf');
    } catch (err) {
      addToast(err.message || 'Failed to download report', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const handleEmail = async () => {
    const to = email.trim();
    if (!to) return;
    setEmailing(true);
    try {
      await api.post(`/api/product-scout/runs/${runId}/email`, { to });
      addToast(`Report emailed to ${to}`, 'success');
      setShowEmailInput(false);
      setEmail('');
    } catch (err) {
      addToast(err.message || 'Failed to email report', 'error');
    } finally {
      setEmailing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70 disabled:opacity-40"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
      >
        {downloading ? 'Preparing…' : 'Download PDF'}
      </button>
      {!showEmailInput ? (
        <button
          type="button"
          onClick={() => setShowEmailInput(true)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          Email PDF
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="px-2 py-1.5 rounded-lg text-xs border"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          />
          <button
            type="button"
            onClick={handleEmail}
            disabled={emailing || !email.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ background: 'var(--color-primary)' }}
          >
            {emailing ? 'Sending…' : 'Send'}
          </button>
          <button
            type="button"
            onClick={() => { setShowEmailInput(false); setEmail(''); }}
            className="text-xs transition-opacity hover:opacity-70"
            style={{ color: 'var(--color-muted)' }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
