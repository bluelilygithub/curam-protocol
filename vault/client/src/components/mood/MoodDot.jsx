import React, { useState, useEffect } from 'react';
import api from '../../utils/apiClient';
import CheckinModal from './CheckinModal';

const EMOTION_COLOURS = {
  joy: '#C9A84C', trust: '#6B9E70', fear: '#507A60', surprise: '#6B97B5',
  sadness: '#5B6FAD', disgust: '#8A5C8A', anger: '#A85C5C', anticipation: '#C48B3C',
};

// dominantEmotion prop: when provided by a parent that batch-fetches, we skip the
// per-dot fetch entirely. undefined = standalone (fetch individually). null = batch
// returned no check-ins. object = batch returned data.
export default function MoodDot({ entityType, entityId, entityTitle, dominantEmotion }) {
  const propManaged = dominantEmotion !== undefined;
  const [dominant, setDominant] = useState(null);
  const [showModal, setShowModal] = useState(false);

  // Sync state whenever the batch-provided prop changes
  useEffect(() => {
    if (propManaged) setDominant(dominantEmotion || null);
  }, [dominantEmotion, propManaged]);

  // Solo fetch — only when parent does NOT provide the prop
  useEffect(() => {
    if (propManaged) return;
    if (!entityId && entityType !== 'general') return;
    const id = entityId || 'general';
    api.get(`/api/mood/dominant/${entityType}/${id}`)
      .then(r => r.json())
      .then(d => setDominant(d.coreEmotion ? d : null))
      .catch(() => {});
  }, [entityType, entityId, propManaged]);

  // After a save, refresh this dot individually regardless of who owns the data
  const refreshDominant = () => {
    if (!entityId && entityType !== 'general') return;
    const id = entityId || 'general';
    api.get(`/api/mood/dominant/${entityType}/${id}`)
      .then(r => r.json())
      .then(d => setDominant(d.coreEmotion ? d : null))
      .catch(() => {});
  };

  const bgColor = dominant
    ? (dominant.color || EMOTION_COLOURS[dominant.coreEmotion] || '#888')
    : 'transparent';

  const title = dominant
    ? `${dominant.coreEmotion} (${dominant.count} check-in${dominant.count !== 1 ? 's' : ''})`
    : 'Log how you\'re feeling';

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setShowModal(true); }}
        className="w-4 h-4 rounded-full flex-shrink-0 transition-transform hover:scale-125"
        style={{
          background: bgColor,
          border: dominant ? 'none' : '1.5px dashed var(--color-muted)',
        }}
        title={title}
      />
      {showModal && (
        <CheckinModal
          entityType={entityType}
          entityId={entityId}
          entityTitle={entityTitle}
          onClose={() => setShowModal(false)}
          onSave={() => { refreshDominant(); setShowModal(false); }}
        />
      )}
    </>
  );
}
