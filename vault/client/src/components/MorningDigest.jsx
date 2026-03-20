import React, { useState, useEffect } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import CheckinModal from './mood/CheckinModal';
import InquirySession from './mood/InquirySession';

const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };

const EMOTION_COLOURS = {
  joy: '#FFD700', trust: '#7CFC00', fear: '#228B22', surprise: '#87CEEB',
  sadness: '#4169E1', disgust: '#800080', anger: '#FF4500', anticipation: '#FF8C00',
};

const MOOD_PILLS = [
  { id: 'joy', label: 'Joy', color: '#FFD700' },
  { id: 'trust', label: 'Trust', color: '#7CFC00' },
  { id: 'fear', label: 'Fear', color: '#228B22' },
  { id: 'surprise', label: 'Surprise', color: '#87CEEB' },
  { id: 'sadness', label: 'Sadness', color: '#4169E1' },
  { id: 'disgust', label: 'Disgust', color: '#800080' },
  { id: 'anger', label: 'Anger', color: '#FF4500' },
  { id: 'anticipation', label: 'Anticipation', color: '#FF8C00' },
];

export default function MorningDigest() {
  const getIcon = useIcon();
  const todayKey = new Date().toISOString().slice(0, 10);
  const storageKey = `vault:digest:${todayKey}`;

  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [morningCheckedIn, setMorningCheckedIn] = useState(false);
  const [showMoodModal,   setShowMoodModal]   = useState(false);
  const [showInquiry,     setShowInquiry]     = useState(false);
  const [moodDismissed, setMoodDismissed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(storageKey)) return;
    setLoading(true);
    api.get('/api/tasks/morning-digest')
      .then(r => r.json())
      .then(d => {
        if (d.today?.length > 0 || d.overdue?.length > 0) {
          setData(d);
          setVisible(true);
        } else {
          localStorage.setItem(storageKey, '1');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = () => {
    localStorage.setItem(storageKey, '1');
    setVisible(false);
  };

  if (loading || !visible || !data) return null;

  const dayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-full max-w-xl rounded-2xl border shadow-2xl flex flex-col"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b flex items-start justify-between" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Good morning</h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>{dayLabel}</p>
          </div>
          <button onClick={dismiss} className="hover:opacity-60 p-1 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
            {getIcon('x', { size: 16 })}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Overdue */}
          {data.overdue.length > 0 && (
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full mb-3" style={{ background: '#ef444420', color: '#ef4444' }}>
                {getIcon('alert-circle', { size: 12 })} Overdue — {data.overdue.length}
              </span>
              <div className="space-y-1.5">
                {data.overdue.map(t => (
                  <div key={t.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', borderLeft: `3px solid ${PRIORITY_COLOR[t.priority]}` }}>
                    <span className="flex-1 text-sm" style={{ color: 'var(--color-text)' }}>{t.title}</span>
                    {t.dueDate && <span className="text-xs flex-shrink-0" style={{ color: '#ef4444' }}>{t.dueDate.slice(0, 10)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Due Today */}
          {data.today.length > 0 && (
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full mb-3" style={{ background: '#f59e0b20', color: '#f59e0b' }}>
                {getIcon('clock', { size: 12 })} Due today — {data.today.length}
              </span>
              <div className="space-y-1.5">
                {data.today.map(t => (
                  <div key={t.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', borderLeft: `3px solid ${PRIORITY_COLOR[t.priority]}` }}>
                    <span className="flex-1 text-sm" style={{ color: 'var(--color-text)' }}>{t.title}</span>
                    {t.dueDate?.includes('T') && <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{t.dueDate.slice(11, 16)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Claude suggestion */}
          {data.suggestion && (
            <div className="rounded-xl border px-4 py-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-primary)' + '44' }}>
              <div className="flex items-center gap-2 mb-2">
                {getIcon('sparkles', { size: 14, style: { color: 'var(--color-primary)' } })}
                <span className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>Claude suggests</span>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{data.suggestion}</p>
            </div>
          )}

          {/* Morning mood check-in */}
          {!moodDismissed && (
            <div className="border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
              {morningCheckedIn ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                    Morning feeling logged ✓
                  </span>
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>How are you feeling this morning?</p>
                    <button onClick={() => setMoodDismissed(true)} className="text-xs hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Skip</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {MOOD_PILLS.map(em => (
                      <button
                        key={em.id}
                        onClick={() => setShowMoodModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-opacity hover:opacity-80"
                        style={{ background: em.color + '33', color: 'var(--color-text)', border: `1.5px solid ${em.color}` }}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ background: em.color }} />
                        {em.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                    Or{' '}
                    <button
                      type="button"
                      onClick={() => setShowInquiry(true)}
                      className="underline hover:opacity-70 transition-opacity"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      take a few minutes for a guided inquiry →
                    </button>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={dismiss}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-primary)' }}
          >
            Got it — let's go
          </button>
        </div>
      </div>

      {showMoodModal && (
        <CheckinModal
          entityType="general"
          entityId={null}
          entityTitle="Morning check-in"
          onClose={() => setShowMoodModal(false)}
          onSave={() => {
            setMorningCheckedIn(true);
            setShowMoodModal(false);
          }}
        />
      )}

      {showInquiry && (
        <InquirySession
          onClose={() => setShowInquiry(false)}
          onComplete={() => {
            setMorningCheckedIn(true);
            setShowInquiry(false);
          }}
        />
      )}
    </div>
  );
}
