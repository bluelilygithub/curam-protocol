import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import ModelInsightPanel from './ModelInsightPanel';

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function CombinedProfilePanel({ onBack }) {
  const [status, setStatus] = useState(null);
  const [profile, setProfile] = useState(null);
  const [sourceAttempts, setSourceAttempts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/api/wellbeing/profile/status');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load profile status');
      setStatus(data);
    } catch (err) {
      setError(err.message || 'Could not load profile status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const generateProfile = async () => {
    if (!status?.available || generating) return;
    setGenerating(true);
    setError('');
    try {
      const res = await api.post('/api/wellbeing/profile', {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not generate combined profile');
      setProfile(data.profile);
      setSourceAttempts(data.sourceAttempts);
    } catch (err) {
      setError(err.message || 'Could not generate combined profile');
    } finally {
      setGenerating(false);
    }
  };

  const downloadProfilePdf = async () => {
    if (!profile || pdfLoading) return;
    setPdfLoading(true);
    setError('');
    try {
      const res = await api.post('/api/wellbeing/profile/pdf', { profile, sourceAttempts });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'PDF generation failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'combined-wellbeing-profile.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Could not download combined profile PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity mb-3"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
          >
            Back to wellbeing tools
          </button>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Combined Profile</h2>
          <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--color-muted)' }}>
            Collates the latest completed mood, IPIP-NEO-120, CERQ-style, and COPE-style results into one detailed proof-of-concept profile.
          </p>
        </div>
        <button
          type="button"
          onClick={generateProfile}
          disabled={!status?.available || generating}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ background: 'var(--color-primary)' }}
        >
          {generating ? 'Generating...' : 'Generate combined profile'}
        </button>
      </div>

      {error && <div className="rounded-xl px-3 py-2 text-sm" style={{ color: '#991b1b', background: '#fee2e2' }}>{error}</div>}

      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Completion requirements</h3>
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Checking completed tests...</p>
        ) : (
          <div className="space-y-2">
            {status?.tests?.map((test) => (
              <div key={test.key} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{test.label}</p>
                  {test.completedAt && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Latest: {formatDate(test.completedAt)}</p>}
                </div>
                <span className="text-xs font-semibold" style={{ color: test.completed ? '#16a34a' : '#ca8a04' }}>
                  {test.completed ? 'Complete' : 'Needed'}
                </span>
              </div>
            ))}
          </div>
        )}

        {!loading && !status?.available && (
          <p className="text-sm mt-3" style={{ color: 'var(--color-muted)' }}>
            The combined profile unlocks once all four tests have at least one completed result.
          </p>
        )}
      </section>

      {profile && (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={downloadProfilePdf}
              disabled={pdfLoading}
              className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 disabled:opacity-40"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
            >
              {pdfLoading ? 'Preparing PDF...' : 'Download PDF'}
            </button>
          </div>
          <ModelInsightPanel insight={profile} title="Detailed combined profile" />
          {sourceAttempts && (
            <p className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>
              Generated from the latest completed result for each source test.
            </p>
          )}
        </>
      )}
    </div>
  );
}
