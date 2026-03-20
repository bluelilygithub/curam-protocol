import React, { useState } from 'react';
import api from '../../utils/apiClient';
import EmotionWheel from './EmotionWheel';
import useToastStore from '../../store/toastStore';

const BODY_LOCATIONS = ['Head', 'Chest', 'Throat', 'Stomach', 'Shoulders', 'Arms', 'Hands', 'Legs', 'Whole body'];
const BODY_QUALITIES  = ['Tight', 'Heavy', 'Light', 'Fluttery', 'Hot', 'Cold', 'Hollow', 'Numb', 'Racing', 'Aching', 'Expansive', 'Buzzing'];

const SURFACE_OPTIONS = [
  { label: 'Surface feeling',      value: 'surface'    },
  { label: 'Something underneath', value: 'underneath' },
  { label: 'Not sure',             value: 'not_sure'   },
];

function StepDots({ current, total }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="rounded-full transition-all duration-200"
          style={{
            width:      i + 1 === current ? 16 : 6,
            height:     6,
            background: i + 1 === current ? 'var(--color-primary)' : 'var(--color-border)',
          }}
        />
      ))}
    </div>
  );
}

function Chip({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs px-2.5 py-1 rounded-full border transition-colors"
      style={{
        background:   active ? 'var(--color-surface)' : 'transparent',
        borderColor:  active ? 'var(--color-primary)' : 'var(--color-border)',
        color:        active ? 'var(--color-text)'    : 'var(--color-muted)',
      }}
    >
      {label}
    </button>
  );
}

function useToggleSet(initial = []) {
  const [set, setSet] = useState(initial);
  const toggle = (val) => setSet(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  return [set, toggle, setSet];
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CheckinModal({ entityType, entityId, entityTitle, onClose, onSave }) {
  const addToast = useToastStore(s => s.addToast);

  // Navigation
  const [step, setStep] = useState(1);

  // Step 1 — Body First
  const [bodyLocations, toggleLocation, setBodyLocations] = useToggleSet([]);
  const [bodyQualities, toggleQuality,  setBodyQualities]  = useToggleSet([]);
  const [bodyDescription, setBodyDescription] = useState('');

  // Step 2 — wheel selection (captured via onSelect)
  const [wheelResult, setWheelResult] = useState(null);

  // Step 3 — Context
  const [intensity,      setIntensity]      = useState(5);
  const [surfaceChoice,  setSurfaceChoice]  = useState('');   // '' | 'surface' | 'underneath' | 'not_sure'
  const [note,           setNote]           = useState('');
  const [saving,         setSaving]         = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleClose = () => {
    setStep(1);
    setBodyLocations([]);
    setBodyQualities([]);
    setBodyDescription('');
    setWheelResult(null);
    setIntensity(5);
    setSurfaceChoice('');
    setNote('');
    onClose();
  };

  const handleWheelSelect = (result) => {
    setWheelResult(result);
    setIntensity(result.intensity ?? 5);
    setStep(3);
  };

  const handleSave = async () => {
    if (!wheelResult?.coreEmotion) return;
    setSaving(true);
    const isSurface = surfaceChoice === 'surface' ? true
                    : surfaceChoice === 'underneath' ? false
                    : null;
    try {
      await api.post('/api/mood/checkin', {
        entityType,
        entityId:         entityId || null,
        coreEmotion:      wheelResult.coreEmotion,
        secondaryEmotion: wheelResult.secondaryEmotion || null,
        tertiaryEmotion:  wheelResult.tertiaryEmotion  || null,
        intensity,
        bodyLocations:    bodyLocations.length   > 0 ? bodyLocations   : null,
        bodyQualities:    bodyQualities.length   > 0 ? bodyQualities   : null,
        bodyDescription:  bodyDescription.trim() || null,
        isSurface,
        note:             note.trim() || null,
        checkInType:      'quick',
      });
      addToast('Feeling logged', 'success');
      onSave();
      onClose();
    } catch {
      addToast('Failed to save feeling', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const hasStep1Data   = bodyLocations.length > 0 || bodyQualities.length > 0 || bodyDescription.trim();
  const intensityLabel = intensity <= 3 ? 'Barely there' : intensity <= 7 ? 'Moderate' : 'Overwhelming';

  const stepTitle = step === 1 ? 'Where do you feel this?'
                  : step === 2 ? 'What word comes closest?'
                  : "What's happening right now?";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl border shadow-2xl flex flex-col max-h-[90vh]"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        {/* ── Header ── */}
        <div
          className="px-5 py-4 border-b flex items-start justify-between flex-shrink-0"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
              {stepTitle}
            </h3>
            {step === 1 && entityTitle && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                about: {entityTitle}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 ml-4 flex-shrink-0">
            <button
              onClick={handleClose}
              className="hover:opacity-60 p-1 leading-none"
              style={{ color: 'var(--color-muted)' }}
            >
              ✕
            </button>
            <StepDots current={step} total={3} />
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* Step 1 — Body First */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
                  Location <span className="font-normal">(optional)</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {BODY_LOCATIONS.map(loc => (
                    <Chip
                      key={loc}
                      label={loc}
                      active={bodyLocations.includes(loc)}
                      onClick={() => toggleLocation(loc)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
                  Quality <span className="font-normal">(optional)</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {BODY_QUALITIES.map(q => (
                    <Chip
                      key={q}
                      label={q}
                      active={bodyQualities.includes(q)}
                      onClick={() => toggleQuality(q)}
                    />
                  ))}
                </div>
              </div>

              <textarea
                rows={1}
                value={bodyDescription}
                onChange={e => setBodyDescription(e.target.value)}
                placeholder="Describe it in your own words (e.g. a dull weight, a tight knot...)"
                className="w-full text-sm px-3 py-2 rounded-lg border outline-none resize-none"
                style={{
                  background:   'var(--color-bg)',
                  borderColor:  'var(--color-border)',
                  color:        'var(--color-text)',
                  fontFamily:   'inherit',
                }}
              />
            </div>
          )}

          {/* Step 2 — Name It */}
          {step === 2 && (
            <div>
              <EmotionWheel
                mode="interactive"
                onSelect={handleWheelSelect}
                onCancel={handleClose}
                hideIntensity
                hideBodyLocations
              />

              {/* Step 1 summary card */}
              {hasStep1Data && (
                <div
                  className="mt-4 rounded-xl px-3 py-2.5 text-xs space-y-0.5"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
                >
                  <span style={{ color: 'var(--color-muted)' }}>You described: </span>
                  <span style={{ color: 'var(--color-text)' }}>
                    {[bodyLocations.join(', '), bodyQualities.join(', ')].filter(Boolean).join(' · ')}
                  </span>
                  {bodyDescription.trim() && (
                    <p className="mt-1 italic" style={{ color: 'var(--color-muted)' }}>
                      "{bodyDescription.trim()}"
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3 — Context */}
          {step === 3 && wheelResult && (
            <div className="space-y-5">

              {/* Emotion recap pill row */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {[wheelResult.coreEmotion, wheelResult.secondaryEmotion, wheelResult.tertiaryEmotion]
                  .filter(Boolean)
                  .map((em, i) => (
                    <React.Fragment key={em}>
                      {i > 0 && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>›</span>}
                      <span
                        className="text-xs px-2.5 py-1 rounded-full capitalize"
                        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                      >
                        {em}
                      </span>
                    </React.Fragment>
                  ))}
              </div>

              {/* Intensity */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Intensity</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                    {intensity}/10 — {intensityLabel}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                  <span className="flex-shrink-0">Barely there</span>
                  <input
                    type="range" min="1" max="10" value={intensity}
                    onChange={e => setIntensity(Number(e.target.value))}
                    className="flex-1"
                    style={{ accentColor: 'var(--color-primary)' }}
                  />
                  <span className="flex-shrink-0">Overwhelming</span>
                </div>
              </div>

              {/* Surface question */}
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
                  Is this the first feeling, or is something underneath it?
                </p>
                <div className="flex gap-2 flex-wrap">
                  {SURFACE_OPTIONS.map(opt => {
                    const active = surfaceChoice === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSurfaceChoice(prev => prev === opt.value ? '' : opt.value)}
                        className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                        style={{
                          background:  active ? 'var(--color-surface)' : 'transparent',
                          borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                          color:       active ? 'var(--color-text)'    : 'var(--color-muted)',
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Note */}
              <textarea
                rows={2}
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Anything else to note? (optional)"
                className="w-full text-sm px-3 py-2 rounded-lg border outline-none resize-none"
                style={{
                  background:  'var(--color-bg)',
                  borderColor: 'var(--color-border)',
                  color:       'var(--color-text)',
                  fontFamily:  'inherit',
                }}
              />
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          className="px-5 py-3 border-t flex items-center justify-between flex-shrink-0"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {step === 1 && (
            <>
              <div />
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: 'var(--color-primary)' }}
              >
                Next →
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 rounded-xl text-sm border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                ← Back
              </button>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Select an emotion above
              </p>
            </>
          )}

          {step === 3 && (
            <>
              <button
                type="button"
                onClick={() => { setWheelResult(null); setStep(2); }}
                className="px-4 py-2 rounded-xl text-sm border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
                style={{ background: 'var(--color-primary)' }}
              >
                {saving ? 'Saving…' : 'Save feeling'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
