import React from 'react';
import api from '../../utils/apiClient';
import EmotionWheel from './EmotionWheel';
import useToastStore from '../../store/toastStore';

export default function CheckinModal({ entityType, entityId, entityTitle, onClose, onSave }) {
  const addToast = useToastStore(s => s.addToast);

  const header = entityType === 'general'
    ? 'How are you feeling right now?'
    : `How are you feeling about: ${entityTitle || entityType}?`;

  const handleSelect = async (result) => {
    try {
      await api.post('/api/mood/checkin', {
        entityType,
        entityId: entityId || null,
        coreEmotion: result.coreEmotion,
        secondaryEmotion: result.secondaryEmotion || null,
        tertiaryEmotion: result.tertiaryEmotion || null,
        intensity: result.intensity,
        bodyLocations: result.bodyLocations,
        note: result.note,
      });
      addToast('Feeling logged', 'success');
      onSave();
    } catch {
      addToast('Failed to save feeling', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl border shadow-2xl flex flex-col max-h-[90vh]"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        {/* Header */}
        <div
          className="px-5 py-4 border-b flex items-center justify-between flex-shrink-0"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            {header}
          </h3>
          <button
            onClick={onClose}
            className="hover:opacity-60 p-1"
            style={{ color: 'var(--color-muted)' }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          <EmotionWheel mode="interactive" onSelect={handleSelect} onCancel={onClose} />
        </div>
      </div>
    </div>
  );
}
