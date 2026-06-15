import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import ModelInsightPanel from './ModelInsightPanel';
import SlideshowPreviewModal from './SlideshowPreviewModal';

const PROFILE_VARIANTS = {
  summary: {
    label: 'Summary',
    title: 'Summary profile',
    description: 'A concise overview of the eight tests for quick orientation.',
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

export default function CombinedProfilePanel({
  onBack,
  initialVariant = 'detailed',
  initialModuleKey = '',
  autoGenerate = false,
  onModuleCharts,
  onModuleMindMap,
}) {
  const reportRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [profile, setProfile] = useState(null);
  const [sourceAttempts, setSourceAttempts] = useState(null);
  const [profileVariant, setProfileVariant] = useState(PROFILE_VARIANTS[initialVariant] ? initialVariant : 'detailed');
  const [activeModuleKey, setActiveModuleKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [slideshowLoading, setSlideshowLoading] = useState(false);
  const [slideshowDownloading, setSlideshowDownloading] = useState(false);
  const [slideshowPreview, setSlideshowPreview] = useState(null);
  const [showSlideshowModal, setShowSlideshowModal] = useState(false);
  const [slideshowError, setSlideshowError] = useState('');
  const [slideshowModuleKey, setSlideshowModuleKey] = useState('');
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

  const generateProfile = async (variant = 'detailed', moduleKey = '') => {
    const moduleStatus = moduleKey ? status?.modules?.find((module) => module.key === moduleKey) : null;
    if (generating || (moduleKey ? !moduleStatus?.completed : !status?.available)) return;
    const generationKey = moduleKey ? `module:${moduleKey}:${variant}` : `final:${variant}`;
    setGenerating(generationKey);
    setError('');
    try {
      const res = await api.post('/api/wellbeing/profile', moduleKey ? { variant, moduleKey } : { variant });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not generate wellbeing report');
      setProfile(data.profile);
      setSourceAttempts(data.sourceAttempts);
      setProfileVariant(data.variant || variant);
      setActiveModuleKey(data.moduleKey || '');
      window.setTimeout(() => {
        reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    } catch (err) {
      setError(err.message || 'Could not generate wellbeing report');
    } finally {
      setGenerating(null);
    }
  };

  useEffect(() => {
    if (!autoGenerate || initialModuleKey || !status?.available || profile || generating) return;
    generateProfile(PROFILE_VARIANTS[initialVariant] ? initialVariant : 'detailed');
  }, [autoGenerate, initialModuleKey, status?.available, profile, generating, initialVariant]);

  useEffect(() => {
    if (!autoGenerate || !initialModuleKey || profile || generating) return;
    const moduleStatus = status?.modules?.find((module) => module.key === initialModuleKey);
    if (!moduleStatus?.completed) return;
    generateProfile(PROFILE_VARIANTS[initialVariant] ? initialVariant : 'detailed', initialModuleKey);
  }, [autoGenerate, initialModuleKey, status?.modules, profile, generating, initialVariant]);

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
      const activeModule = status?.modules?.find((module) => module.key === activeModuleKey);
      const moduleSlug = activeModule?.key || profile?.moduleKey;
      a.download = moduleSlug
        ? `wellbeing-module-${moduleSlug}.pdf`
        : PROFILE_VARIANTS[profileVariant]?.pdfName || 'combined-wellbeing-profile.pdf';
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

  const openTakeawaySlideshow = async (moduleKey = '') => {
    const safeModuleKey = typeof moduleKey === 'string' ? moduleKey : '';
    const moduleStatus = safeModuleKey ? status?.modules?.find((module) => module.key === safeModuleKey) : null;
    if ((safeModuleKey ? !moduleStatus?.completed : !status?.available) || slideshowLoading) return;
    setSlideshowModuleKey(safeModuleKey);
    setShowSlideshowModal(true);
    setSlideshowLoading(true);
    setSlideshowError('');
    setError('');
    try {
      const query = safeModuleKey ? `?moduleKey=${encodeURIComponent(safeModuleKey)}` : '';
      const res = await api.get(`/api/wellbeing/profile/slideshow/preview${query}`);
      if (!res.ok) {
        const data = await res.clone().json().catch(async () => {
          const text = await res.text().catch(() => '');
          return { error: text };
        });
        throw new Error(data.error || 'Slideshow preview failed');
      }
      const data = await res.json();
      setSlideshowPreview(data.slideshow);
    } catch (err) {
      setSlideshowError(err.message || 'Could not open takeaway slideshow');
      setError(err.message || 'Could not open takeaway slideshow');
    } finally {
      setSlideshowLoading(false);
    }
  };

  const downloadTakeawaySlideshow = async () => {
    if (slideshowDownloading) return;
    setSlideshowDownloading(true);
    setSlideshowError('');
    setError('');
    try {
      const safeModuleKey = slideshowModuleKey || '';
      const query = safeModuleKey ? `?moduleKey=${encodeURIComponent(safeModuleKey)}` : '';
      const res = await api.get(`/api/wellbeing/profile/slideshow${query}`);
      if (!res.ok) {
        const data = await res.clone().json().catch(async () => {
          const text = await res.text().catch(() => '');
          return { error: text };
        });
        throw new Error(data.error || 'Slideshow download failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeModuleKey ? `wellbeing-${safeModuleKey}-slideshow.pptx` : 'wellbeing-final-recap-slideshow.pptx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setSlideshowError(err.message || 'Could not download takeaway slideshow');
      setError(err.message || 'Could not download takeaway slideshow');
    } finally {
      setSlideshowDownloading(false);
    }
  };

  const showSuggestionsWaitModal = autoGenerate
    && initialVariant === 'suggestions'
    && !profile
    && !error
    && (loading || generating === 'final:suggestions');

  const reportTitle = activeModuleKey
    ? `${profile?.moduleLabel || status?.modules?.find((module) => module.key === activeModuleKey)?.label || 'Module'} ${profileVariant === 'suggestions' ? 'Suggestions' : 'Report'}`
    : PROFILE_VARIANTS[profileVariant]?.title || 'Combined profile';
  const testStatusByKey = Object.fromEntries((status?.tests || []).map((test) => [test.key, test]));

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
              Checking the eight completed results, preparing module outcomes if needed, and generating the personal development suggestions. This can take around 60 seconds, so please wait on this screen.
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
            Builds three module reports first, then uses those module outcomes to create the final overall profile.
          </p>
        </div>
      </div>

      {error && <div className="rounded-xl px-3 py-2 text-sm" style={{ color: '#991b1b', background: '#fee2e2' }}>{error}</div>}

      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Module reports</h3>
        <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
          Generate a focused report for each module. The final profile uses these three module outcomes as its starting point.
        </p>
        {loading && (
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>Checking which modules are ready...</p>
        )}
        <div className="grid md:grid-cols-3 gap-3">
          {(status?.modules || []).map((module) => {
            const generationKey = `module:${module.key}:detailed`;
            const suggestionsGenerationKey = `module:${module.key}:suggestions`;
            const isActive = activeModuleKey === module.key && profile;
            const moduleTests = (module.tests || []).map((testKey, index) => ({
              key: testKey,
              label: module.testLabels?.[index] || testStatusByKey[testKey]?.label || testKey,
              completed: !!testStatusByKey[testKey]?.completed,
            }));
            return (
              <div
                key={module.key}
                className="rounded-2xl border p-4 text-left transition-colors"
                style={{
                  borderColor: isActive ? 'var(--color-primary)' : module.completed ? 'var(--color-border)' : '#f59e0b',
                  background: isActive ? 'var(--color-bg)' : module.completed ? 'var(--color-surface)' : '#fffbeb',
                }}
              >
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {generating === generationKey ? 'Generating...' : module.label}
                </p>
                <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{module.description}</p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {moduleTests.map((test) => (
                    <span
                      key={test.key}
                      data-preserve-hover-color="true"
                      className="text-[11px] px-2 py-1 rounded-full border"
                      style={{
                        '--hover-preserve-color': test.completed ? '#15803d' : '#92400e',
                        borderColor: test.completed ? '#bbf7d0' : '#f59e0b',
                        color: test.completed ? '#15803d' : '#92400e',
                        background: test.completed ? '#f0fdf4' : '#fef3c7',
                      }}
                    >
                      {test.label}
                      {!test.completed ? ' needed' : ''}
                    </span>
                  ))}
                </div>
                <p className="text-xs mt-3 font-semibold" style={{ color: module.completed ? '#16a34a' : '#ca8a04' }}>
                  {module.completed ? 'Module ready' : `Needs ${module.missing?.length || 0} more`}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => generateProfile('detailed', module.key)}
                    disabled={!module.completed || !!generating}
                    className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 disabled:opacity-40"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
                  >
                    {generating === generationKey ? 'Generating...' : 'Report'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onModuleCharts?.(module.key)}
                    disabled={!module.completed}
                    className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 disabled:opacity-40"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
                  >
                    Charts
                  </button>
                  <button
                    type="button"
                    onClick={() => onModuleMindMap?.(module.key)}
                    disabled={!module.completed}
                    className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 disabled:opacity-40"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
                  >
                    Visual index
                  </button>
                  <button
                    type="button"
                    onClick={() => generateProfile('suggestions', module.key)}
                    disabled={!module.completed || !!generating}
                    className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 disabled:opacity-40"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
                  >
                    {generating === suggestionsGenerationKey ? 'Generating...' : 'Suggestions'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openTakeawaySlideshow(module.key)}
                    disabled={!module.completed || slideshowLoading}
                    className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 disabled:opacity-40"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
                  >
                    {slideshowLoading && slideshowModuleKey === module.key ? 'Preparing...' : 'Slideshow'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Final overall report</h3>
          <button
            type="button"
            onClick={openTakeawaySlideshow}
            disabled={!status?.available || slideshowLoading}
            className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
          >
            {slideshowLoading && !slideshowModuleKey ? 'Preparing preview...' : 'Preview takeaway slideshow'}
          </button>
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
          Generate the final synthesis at the level of detail you need. If module reports are not already saved, they are generated and cached first.
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
                borderColor: !activeModuleKey && profileVariant === key && profile ? 'var(--color-primary)' : 'var(--color-border)',
                background: !activeModuleKey && profileVariant === key && profile ? 'var(--color-bg)' : 'var(--color-surface)',
              }}
            >
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {generating === `final:${key}` ? 'Generating...' : config.label}
              </p>
              <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--color-muted)' }}>{config.description}</p>
            </button>
          ))}
        </div>
      </section>

      {profile && (
        <section ref={reportRef} className="scroll-mt-6 space-y-4">
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
          <ModelInsightPanel insight={profile} title={reportTitle} />
          {sourceAttempts && (
            <p className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>
              {activeModuleKey
                ? 'Generated from the latest completed results in this module.'
                : 'Generated from the latest completed module outcomes and source tests.'}
            </p>
          )}
        </section>
      )}

      <SlideshowPreviewModal
        open={showSlideshowModal}
        slideshow={slideshowPreview}
        loading={slideshowLoading}
        error={slideshowError}
        downloading={slideshowDownloading}
        onDownload={downloadTakeawaySlideshow}
        onClose={() => setShowSlideshowModal(false)}
      />
    </div>
  );
}
