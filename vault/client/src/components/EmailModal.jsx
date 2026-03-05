import React, { useState } from 'react';
import { useIcon } from '../providers/IconProvider';

function EmailModal({ sessionId, onClose }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('Chat Export');
  const [status, setStatus] = useState('idle'); // idle | sending | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const getIcon = useIcon();

  const handleSend = async () => {
    if (!to.trim()) return;
    setStatus('sending');
    try {
      const res = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, to, subject }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus('success');
        setTimeout(onClose, 1500);
      } else {
        setStatus('error');
        setErrorMsg(data.error || 'Send failed');
      }
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-xl border shadow-2xl p-6"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
            Email Thread
          </h2>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }}>
            {getIcon('x', { size: 16 })}
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
              To
            </label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
        </div>

        {status === 'error' && (
          <p className="mt-3 text-xs text-red-500">{errorMsg}</p>
        )}
        {status === 'success' && (
          <p className="mt-3 text-xs text-green-500">Email sent successfully!</p>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSend}
            disabled={status === 'sending' || !to.trim()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--color-primary)', opacity: status === 'sending' ? 0.7 : 1 }}
          >
            {getIcon('mail', { size: 14, color: 'white' })}
            {status === 'sending' ? 'Sending...' : 'Send'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default EmailModal;
