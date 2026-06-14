import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import ModelInsightPanel from './ModelInsightPanel';

const PROFILE_VARIANTS = {
  summary: {
    label: 'Summary',
    title: 'Summary profile',
    description: 'A concise overview of the seven tests for quick orientation.',
    pdfName: 'combined-wellbeing-summary.pdf',
  },
  detailed: {
    label: 'Detailed profile',
    title: 'Detailed combined profile',
    description: 'The current client-readable formulation with enough detail for client and clinician discussion.',
    pdfName: 'combined-wellbeing-detailed-profile.pdf',
  },
  analytical: {
    label: 'Analytical profile',
    title: 'Analytical combined profile',
    description: 'A more clinician-oriented formulation with mechanisms, caveats, and clinical questions.',
    pdfName: 'combined-wellbeing-analytical-profile.pdf',
  },
  suggestions: {
    label: 'Suggestions',
    title: 'Personal development suggestions',
    description: 'Reflective suggestions for strengths, coping habits, communication, and small development experiments.',
    pdfName: 'combined-wellbeing-suggestions.pdf',
  },
};

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

export default function CombinedProfilePanel({ onBack, initialVariant = 'detailed', autoGenerate = false }) {
  const [status, setStatus] = useState(null);
  const [profile, setProfile] = useState(null);
  const [sourceAttempts, setSourceAttempts] = useState(null);
  const [profileVariant, setProfileVariant] = useState(PROFILE_VARIANTS[initialVariant] ? initialVariant : 'detailed');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(null);
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

  const generateProfile = async (variant = 'detailed') => {
    if (!status?.available || generating) return;
    setGenerating(variant);
    setError('');
    try {
      const res = await api.post('/api/wellbeing/profile', { variant });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not generate combined profile');
      setProfile(data.profile);
      setSourceAttempts(data.sourceAttempts);
      setProfileVariant(data.variant || variant);
    } catch (err) {
      setError(err.message || 'Could not generate combined profile');
    } finally {
      setGenerating(null);
    }
  };

  useEffect(() => {
    if (!autoGenerate || !status?.available || profile || generating) return;
    generateProfile(PROFILE_VARIANTS[initialVariant] ? initialVariant : 'detailed');
  }, [autoGenerate, status?.available, profile, generating, initialVariant]);

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
      a.download = PROFILE_VARIANTS[profileVariant]?.pdfName || 'combined-wellbeing-profile.pdf';
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

  const showSuggestionsWaitModal = autoGenerate
    && initialVariant === 'suggestions'
    && !profile
    && !error
    && (loading || generating === 'suggestions');

  return (
    <div className="space-y-6">
      {showSuggestionsWaitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div
            role="status"
            aria-live="polite"
            className="w-full max-w-md rounded-2xl border p-6 text-center shadow-xl"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <div className="mx-auto h-10 w-10 rounded-full border-4 border-t-transparent animate-spin mb-4" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Preparing suggestions report</h2>
            <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
              Checking the seven completed results and generating the personal development suggestions. This can take around 60 seconds, so please wait on this screen.
            </p>
            <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>
              The report will appear automatically when it is ready.
            </p>
          </div>
        </div>
      )}

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
            Collates the latest completed mood, PANAS-style, ASRS-5-style, IPIP-NEO-120, HEXACO-60-style, CERQ-style, and COPE-style results into one proof-of-concept report.
          </p>
        </div>
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
            The combined profile unlocks once all seven tests have at least one completed result.
          </p>
        )}
      </section>

      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Choose report style</h3>
        <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
          Generate the same seven-test synthesis at the level of detail you need.
        </p>
        <div className="grid md:grid-cols-4 gap-3">
          {Object.entries(PROFILE_VARIANTS).map(([key, config]) => (
            <button
              key={key}
              type="button"
              onClick={() => generateProfile(key)}
              disabled={!status?.available || !!generating}
              className="rounded-2xl border p-4 text-left hover:opacity-80 disabled:opacity-50 transition-opacity"
              style={{
                borderColor: profileVariant === key && profile ? 'var(--color-primary)' : 'var(--color-border)',
                background: profileVariant === key && profile ? 'var(--color-bg)' : 'var(--color-surface)',
              }}
            >
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {generating === key ? 'Generating...' : config.label}
              </p>
              <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{config.description}</p>
            </button>
          ))}
        </div>
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
          <ModelInsightPanel insight={profile} title={PROFILE_VARIANTS[profileVariant]?.title || 'Combined profile'} />
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
