import React, { useState } from 'react';

// Muted, desaturated palette — distinct per emotion but native to the app's warm-neutral tone.
// Same values used in server/routes/mood.js EMOTION_COLOURS and MoodDot.jsx.
const PLUTCHIK_WHEEL = [
  {
    id: 'joy', label: 'Joy', color: '#C9A84C', angle: 0,
    secondary: [
      { id: 'serenity', label: 'Serenity', tertiary: [{ id: 'optimism', label: 'Optimism' }] },
      { id: 'ecstasy',  label: 'Ecstasy',  tertiary: [{ id: 'love',     label: 'Love'     }] },
    ],
  },
  {
    id: 'trust', label: 'Trust', color: '#6B9E70', angle: 45,
    secondary: [
      { id: 'acceptance', label: 'Acceptance', tertiary: [{ id: 'love',       label: 'Love'       }] },
      { id: 'admiration', label: 'Admiration', tertiary: [{ id: 'submission', label: 'Submission' }] },
    ],
  },
  {
    id: 'fear', label: 'Fear', color: '#507A60', angle: 90,
    secondary: [
      { id: 'apprehension', label: 'Apprehension', tertiary: [{ id: 'awe',        label: 'Awe'        }] },
      { id: 'terror',       label: 'Terror',       tertiary: [{ id: 'submission', label: 'Submission' }] },
    ],
  },
  {
    id: 'surprise', label: 'Surprise', color: '#6B97B5', angle: 135,
    secondary: [
      { id: 'distraction', label: 'Distraction', tertiary: [{ id: 'awe',         label: 'Awe'         }] },
      { id: 'amazement',   label: 'Amazement',   tertiary: [{ id: 'disapproval', label: 'Disapproval' }] },
    ],
  },
  {
    id: 'sadness', label: 'Sadness', color: '#5B6FAD', angle: 180,
    secondary: [
      { id: 'pensiveness', label: 'Pensiveness', tertiary: [{ id: 'remorse',  label: 'Remorse'  }] },
      { id: 'grief',       label: 'Grief',       tertiary: [{ id: 'contempt', label: 'Contempt' }] },
    ],
  },
  {
    id: 'disgust', label: 'Disgust', color: '#8A5C8A', angle: 225,
    secondary: [
      { id: 'boredom',  label: 'Boredom',  tertiary: [{ id: 'contempt', label: 'Contempt' }] },
      { id: 'loathing', label: 'Loathing', tertiary: [{ id: 'remorse',  label: 'Remorse'  }] },
    ],
  },
  {
    id: 'anger', label: 'Anger', color: '#A85C5C', angle: 270,
    secondary: [
      { id: 'annoyance', label: 'Annoyance', tertiary: [{ id: 'contempt',       label: 'Contempt'       }] },
      { id: 'rage',      label: 'Rage',      tertiary: [{ id: 'aggressiveness', label: 'Aggressiveness' }] },
    ],
  },
  {
    id: 'anticipation', label: 'Anticipation', color: '#C48B3C', angle: 315,
    secondary: [
      { id: 'interest',   label: 'Interest',   tertiary: [{ id: 'optimism',       label: 'Optimism'       }] },
      { id: 'vigilance',  label: 'Vigilance',  tertiary: [{ id: 'aggressiveness', label: 'Aggressiveness' }] },
    ],
  },
];

const CX = 200;
const CY = 200;
const R_OUTER = 160;
const R_INNER = 40;

const BODY_LOCATIONS = ['Chest', 'Throat', 'Stomach', 'Head', 'Shoulders', 'Whole body', 'Hands', 'Back'];

function polarToXY(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function segmentPath(cx, cy, innerR, outerR, startDeg, endDeg) {
  const s1 = polarToXY(cx, cy, outerR, startDeg);
  const e1 = polarToXY(cx, cy, outerR, endDeg);
  const s2 = polarToXY(cx, cy, innerR, endDeg);
  const e2 = polarToXY(cx, cy, innerR, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s1.x} ${s1.y} A ${outerR} ${outerR} 0 ${large} 1 ${e1.x} ${e1.y} L ${s2.x} ${s2.y} A ${innerR} ${innerR} 0 ${large} 0 ${e2.x} ${e2.y} Z`;
}

// ── Interactive mode ──────────────────────────────────────────────────────────

function InteractiveWheel({ onSelect, onCancel, wheel = PLUTCHIK_WHEEL }) {
  const [step, setStep] = useState('core');
  const [selectedCore, setSelectedCore] = useState(null);
  const [selectedSecondary, setSelectedSecondary] = useState(null);
  const [selectedTertiary, setSelectedTertiary] = useState(null);
  const [intensity, setIntensity] = useState(5);
  const [bodyLocations, setBodyLocations] = useState([]);
  const [noteText, setNoteText] = useState('');
  const [hoveredId, setHoveredId] = useState(null);

  const segAngle = 360 / wheel.length;

  const handleCoreClick = (emotion) => {
    setSelectedCore(emotion);
    setSelectedSecondary(null);
    setSelectedTertiary(null);
    setStep(emotion.secondary?.length > 0 ? 'secondary' : 'confirm');
  };

  const handleSecondaryClick = (sec) => {
    setSelectedSecondary(sec);
    setSelectedTertiary(null);
    setStep(sec.tertiary?.length > 0 ? 'tertiary' : 'confirm');
  };

  const handleTertiaryClick = (ter) => {
    setSelectedTertiary(ter);
    setStep('confirm');
  };

  const toggleBodyLocation = (loc) => {
    setBodyLocations(prev => prev.includes(loc) ? prev.filter(l => l !== loc) : [...prev, loc]);
  };

  const handleSave = () => {
    onSelect({
      coreEmotion: selectedCore?.id,
      secondaryEmotion: selectedSecondary?.id || null,
      tertiaryEmotion: selectedTertiary?.id || null,
      intensity,
      bodyLocations,
      note: noteText,
    });
  };

  const resetToCore = () => {
    setStep('core');
    setSelectedCore(null);
    setSelectedSecondary(null);
    setSelectedTertiary(null);
  };

  // Accent colour tracks the selected emotion; falls back to primary
  const accentColor = selectedCore ? selectedCore.color : 'var(--color-primary)';

  const intensityLabel = intensity <= 3 ? 'Barely there' : intensity <= 7 ? 'Moderate' : 'Overwhelming';

  return (
    <div>
      {/* SVG Wheel */}
      <div className="flex justify-center">
        <svg viewBox="0 0 400 400" width="300" height="300" style={{ fontFamily: 'inherit' }}>
          {wheel.map((emotion, i) => {
            const startDeg = i * segAngle - segAngle / 2;
            const endDeg   = startDeg + segAngle;
            const midDeg   = i * segAngle;
            const isSelected = selectedCore?.id === emotion.id;
            const isHovered  = hoveredId === emotion.id;
            const isDimmed   = step !== 'core' && !isSelected;
            const lp = polarToXY(CX, CY, (R_OUTER + R_INNER) / 2, midDeg);
            const opacity = isDimmed ? 0.18 : isSelected ? 1 : isHovered ? 0.95 : 0.75;

            return (
              <g
                key={emotion.id}
                style={{ cursor: 'pointer' }}
                onClick={() => handleCoreClick(emotion)}
                onMouseEnter={() => setHoveredId(emotion.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <path
                  d={segmentPath(CX, CY, R_INNER, R_OUTER, startDeg, endDeg)}
                  fill={emotion.color}
                  opacity={opacity}
                  stroke="var(--color-bg)"
                  strokeWidth="2"
                  style={{ transition: 'opacity 0.2s' }}
                />
                <text
                  x={lp.x}
                  y={lp.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="11"
                  fontWeight="600"
                  fillOpacity={isDimmed ? 0.3 : 0.9}
                  style={{ fill: 'var(--color-text)', fontFamily: 'inherit', pointerEvents: 'none', userSelect: 'none' }}
                >
                  {emotion.label}
                </text>
              </g>
            );
          })}

          {/* Selected core — inner fill indicator */}
          {selectedCore && (
            <circle cx={CX} cy={CY} r={R_INNER - 5} fill={selectedCore.color} opacity={0.4} style={{ pointerEvents: 'none' }} />
          )}

          {/* Hover label in centre (core step only) */}
          {step === 'core' && hoveredId && (
            <text
              x={CX} y={CY}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="12"
              fontWeight="700"
              style={{ fill: 'var(--color-text)', fontFamily: 'inherit', pointerEvents: 'none' }}
            >
              {wheel.find(e => e.id === hoveredId)?.label}
            </text>
          )}
        </svg>
      </div>

      {/* Secondary choices */}
      {step === 'secondary' && selectedCore && (
        <div className="mt-3">
          <p className="text-xs text-center mb-2 font-medium" style={{ color: 'var(--color-muted)' }}>
            More like…
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {selectedCore.secondary.map(sec => (
              <button
                key={sec.id}
                onClick={() => handleSecondaryClick(sec)}
                className="px-3 py-1.5 rounded-full text-sm font-medium transition-opacity hover:opacity-80"
                style={{ background: accentColor + '28', color: 'var(--color-text)', border: `1.5px solid ${accentColor}` }}
              >
                {sec.label}
              </button>
            ))}
            <button
              onClick={() => setStep('confirm')}
              className="px-3 py-1.5 rounded-full text-sm border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              Just {selectedCore.label}
            </button>
          </div>
        </div>
      )}

      {/* Tertiary choices */}
      {step === 'tertiary' && selectedSecondary && (
        <div className="mt-3">
          <p className="text-xs text-center mb-2 font-medium" style={{ color: 'var(--color-muted)' }}>
            Even more specifically…
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {selectedSecondary.tertiary.map(ter => (
              <button
                key={ter.id}
                onClick={() => handleTertiaryClick(ter)}
                className="px-3 py-1.5 rounded-full text-sm font-medium transition-opacity hover:opacity-80"
                style={{ background: accentColor + '28', color: 'var(--color-text)', border: `1.5px solid ${accentColor}` }}
              >
                {ter.label}
              </button>
            ))}
            <button
              onClick={() => setStep('confirm')}
              className="px-3 py-1.5 rounded-full text-sm border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              Just {selectedSecondary.label}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation panel */}
      {step === 'confirm' && selectedCore && (
        <div className="mt-4 rounded-xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>

          {/* Emotion breadcrumb */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="text-sm font-medium px-2.5 py-1 rounded-full"
              style={{ background: accentColor + '22', color: 'var(--color-text)', border: `1px solid ${accentColor}66` }}
            >
              {selectedCore.label}
            </span>
            {selectedSecondary && (
              <>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>›</span>
                <span
                  className="text-sm px-2.5 py-1 rounded-full"
                  style={{ background: accentColor + '16', color: 'var(--color-text)', border: `1px solid ${accentColor}44` }}
                >
                  {selectedSecondary.label}
                </span>
              </>
            )}
            {selectedTertiary && (
              <>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>›</span>
                <span
                  className="text-sm px-2.5 py-1 rounded-full"
                  style={{ background: accentColor + '10', color: 'var(--color-text)', border: `1px solid ${accentColor}33` }}
                >
                  {selectedTertiary.label}
                </span>
              </>
            )}
          </div>

          {/* Intensity slider */}
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
                type="range"
                min="1"
                max="10"
                value={intensity}
                onChange={e => setIntensity(Number(e.target.value))}
                className="flex-1"
                style={{ accentColor: 'var(--color-primary)' }}
              />
              <span className="flex-shrink-0">Overwhelming</span>
            </div>
          </div>

          {/* Body locations */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>
              Where do you feel it? <span className="font-normal">(optional)</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {BODY_LOCATIONS.map(loc => {
                const active = bodyLocations.includes(loc);
                return (
                  <button
                    key={loc}
                    onClick={() => toggleBodyLocation(loc)}
                    className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                    style={{
                      background: active ? 'var(--color-surface)' : 'transparent',
                      borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                      color: active ? 'var(--color-text)' : 'var(--color-muted)',
                    }}
                  >
                    {loc}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Note */}
          <textarea
            rows={2}
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="What's happening right now? (optional)"
            className="w-full text-sm px-3 py-2 rounded-lg border outline-none resize-none"
            style={{
              background: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)',
              fontFamily: 'inherit',
            }}
          />

          {/* Action buttons — match ConfirmModal pattern */}
          <div className="flex gap-2 justify-end">
            <button
              onClick={resetToCore}
              className="px-4 py-2 rounded-lg text-sm border"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              Back
            </button>
            {onCancel && (
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-lg text-sm border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: 'var(--color-primary)' }}
            >
              Save feeling
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Density mode (read-only) ──────────────────────────────────────────────────

function DensityWheel({ emotions = [], wheel = PLUTCHIK_WHEEL }) {
  const [hoveredId, setHoveredId] = useState(null);

  const countMap = {};
  for (const e of emotions) countMap[e.emotion] = e.count;
  const total    = Object.values(countMap).reduce((s, n) => s + n, 0);
  const maxCount = Math.max(...Object.values(countMap), 1);

  const segAngle = 360 / wheel.length;
  const sorted   = [...emotions].sort((a, b) => b.count - a.count).slice(0, 3);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 400 400" width="260" height="260" style={{ fontFamily: 'inherit' }}>
        {wheel.map((emotion, i) => {
          const startDeg = i * segAngle - segAngle / 2;
          const endDeg   = startDeg + segAngle;
          const midDeg   = i * segAngle;
          const count    = countMap[emotion.id] || 0;
          const opacity  = count > 0 ? Math.max(0.18, count / maxCount) : 0.12;
          const isHovered = hoveredId === emotion.id;
          const lp = polarToXY(CX, CY, (R_OUTER + R_INNER) / 2, midDeg);

          return (
            <g
              key={emotion.id}
              onMouseEnter={() => setHoveredId(emotion.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <path
                d={segmentPath(CX, CY, R_INNER, R_OUTER, startDeg, endDeg)}
                fill={emotion.color}
                opacity={isHovered ? Math.min(1, opacity + 0.2) : opacity}
                stroke="var(--color-bg)"
                strokeWidth="2"
                style={{ transition: 'opacity 0.15s', cursor: count > 0 ? 'default' : 'default' }}
              />
              <text
                x={lp.x}
                y={lp.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="10"
                fontWeight="600"
                fillOpacity={0.75}
                style={{ fill: 'var(--color-text)', fontFamily: 'inherit', pointerEvents: 'none', userSelect: 'none' }}
              >
                {emotion.label}
              </text>
            </g>
          );
        })}

        {/* Hover tooltip in centre */}
        {hoveredId && (
          <>
            <text
              x={CX} y={CY - 8}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="14"
              fontWeight="700"
              style={{ fill: 'var(--color-text)', fontFamily: 'inherit', pointerEvents: 'none' }}
            >
              {countMap[hoveredId] ?? 0}
            </text>
            <text
              x={CX} y={CY + 9}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="9"
              style={{ fill: 'var(--color-muted)', fontFamily: 'inherit', pointerEvents: 'none' }}
            >
              {countMap[hoveredId] === 1 ? 'check-in' : 'check-ins'}
              {total > 0 && countMap[hoveredId] ? ` · ${Math.round((countMap[hoveredId] / total) * 100)}%` : ''}
            </text>
          </>
        )}
      </svg>

      {/* Top-3 legend */}
      {sorted.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-1 justify-center">
          {sorted.map(e => {
            const em = wheel.find(w => w.id === e.emotion);
            return (
              <div key={e.emotion} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: em?.color || 'var(--color-border)' }} />
                <span style={{ color: 'var(--color-text)' }}>{em?.label || e.emotion}</span>
                <span>×{e.count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function EmotionWheel({ mode = 'interactive', onSelect, onCancel, emotions = [] }) {
  if (mode === 'density') return <DensityWheel emotions={emotions} />;
  return <InteractiveWheel onSelect={onSelect} onCancel={onCancel} />;
}
