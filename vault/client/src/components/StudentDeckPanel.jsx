import React, { useState, useCallback } from 'react';
import { useIcon } from '../providers/IconProvider';
import { deckPayloadToPlainText } from '../utils/studyDeckText';
import api from '../utils/apiClient';
import { downloadBlob } from '../utils/exportHelpers';
import useToastStore from '../store/toastStore';

function FlashcardFace({ label, text, small }) {
  return (
    <div className="flex flex-col h-full min-h-[120px] p-4">
      <span className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <p className={`text-sm leading-snug whitespace-pre-wrap flex-1 ${small ? 'line-clamp-6' : ''}`} style={{ color: 'var(--color-text)' }}>{text || '—'}</p>
    </div>
  );
}

function FlashcardTile({ card, index }) {
  const [flipped, setFlipped] = useState(false);
  const front = card.front ?? card.q ?? '';
  const back = card.back ?? card.a ?? '';
  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      className="rounded-xl border text-left w-full transition-opacity hover:opacity-90 shadow-sm overflow-hidden"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      <div className="text-[10px] font-medium px-3 py-1 border-b flex justify-between" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
        <span>Card {index + 1}</span>
        <span>{flipped ? 'Answer' : 'Question'} · tap to flip</span>
      </div>
      {!flipped ? (
        <FlashcardFace label="Question" text={front} small />
      ) : (
        <FlashcardFace label="Answer" text={back} small />
      )}
      {(card.level || card.tag) && (
        <div className="px-3 pb-2 text-[10px] flex gap-2" style={{ color: 'var(--color-muted)' }}>
          {card.level && <span>Level: {card.level}</span>}
          {card.tag && <span>Tag: {card.tag}</span>}
        </div>
      )}
    </button>
  );
}

function SlideTile({ slide, index }) {
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  return (
    <div
      className="rounded-xl border p-4 shadow-sm"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <div className="text-[10px] font-semibold uppercase mb-1" style={{ color: 'var(--color-muted)' }}>Slide {index + 1}</div>
      <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>{slide.title || 'Untitled'}</h3>
      <ul className="text-sm space-y-1 list-disc pl-4" style={{ color: 'var(--color-text)' }}>
        {bullets.map((b, j) => (
          <li key={j}>{b}</li>
        ))}
      </ul>
      {slide.speakerNote && (
        <p className="text-xs mt-3 pt-2 border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
          {slide.speakerNote}
        </p>
      )}
    </div>
  );
}

function QuizTile({ item, index }) {
  const choices = Array.isArray(item.choices) ? item.choices : [];
  return (
    <div
      className="rounded-xl border p-4 shadow-sm"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      <div className="text-[10px] font-semibold uppercase mb-2" style={{ color: 'var(--color-muted)' }}>Quiz {index + 1}</div>
      <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>{item.question || '—'}</p>
      <div className="space-y-2">
        {choices.map((ch) => (
          <div
            key={ch.id || ch.label}
            className="rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: ch.id === item.correctId ? 'var(--color-primary)' : 'var(--color-border)',
              background: ch.id === item.correctId ? 'var(--color-surface)' : 'transparent',
            }}
          >
            {ch.label || ch.id}
            {ch.id === item.correctId && <span className="text-xs ml-2" style={{ color: 'var(--color-primary)' }}>(correct)</span>}
          </div>
        ))}
      </div>
      {item.explain && (
        <p className="text-xs mt-3" style={{ color: 'var(--color-muted)' }}>{item.explain}</p>
      )}
    </div>
  );
}

export default function StudentDeckPanel({
  title,
  payload,
  sessionId,
  savedDeckId,
  onSaved,
  hideSave,
}) {
  const getIcon = useIcon();
  const [saving, setSaving] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  const p = payload && typeof payload === 'object' ? payload : {};
  const flashcards = Array.isArray(p.flashcards) ? p.flashcards : [];
  const slides = Array.isArray(p.slides) ? p.slides : [];
  const quiz = Array.isArray(p.quiz) ? p.quiz : [];
  const hasAny = flashcards.length || slides.length || quiz.length;

  const handleCopy = useCallback(async () => {
    const text = deckPayloadToPlainText(title, p);
    try {
      await navigator.clipboard.writeText(text);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      setCopyOk(false);
    }
  }, [title, p]);

  const handlePdf = useCallback(async () => {
    try {
      if (savedDeckId) {
        const res = await api.post(`/api/study-decks/${savedDeckId}/pdf`, {});
        const blob = await res.blob();
        downloadBlob(blob, `study-deck-${savedDeckId}.pdf`);
        return;
      }
      const res = await api.post('/api/export/study-deck/pdf', { title: title || 'Study deck', payload: p });
      const blob = await res.blob();
      downloadBlob(blob, 'study-deck.pdf');
    } catch (e) {
      console.error(e);
    }
  }, [savedDeckId, title, p]);

  const handleSave = useCallback(async () => {
    if (!hasAny || hideSave) return;
    setSaving(true);
    try {
      if (savedDeckId) {
        const res = await api.patch(`/api/study-decks/${savedDeckId}`, {
          title: title || 'Study deck',
          kind: p.kind || 'mixed',
          payload: p,
          sessionId: sessionId || undefined,
        });
        const data = await res.json();
        if (onSaved) onSaved(data);
        useToastStore.getState().addToast('Deck updated');
      } else {
        const res = await api.post('/api/study-decks', {
          title: title || 'Study deck',
          kind: p.kind || 'mixed',
          payload: p,
          sessionId: sessionId || undefined,
        });
        const data = await res.json();
        if (onSaved) onSaved(data);
        useToastStore.getState().addToast('Deck saved');
      }
    } catch (e) {
      console.error(e);
      useToastStore.getState().addToast('Could not save deck', 'error');
    } finally {
      setSaving(false);
    }
  }, [hasAny, hideSave, savedDeckId, title, p, sessionId, onSaved]);

  if (!hasAny) {
    return (
      <div className="rounded-xl border px-4 py-6 text-center text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
        When the assistant adds flashcards, slides, or quiz items, they appear here as cards. The assistant includes a vault-deck JSON block so the app can render them.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {!hideSave && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40 flex items-center gap-1"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' }}
          >
            {saving ? getIcon('loader', { size: 12 }) : getIcon('archive', { size: 12 })}
            {savedDeckId ? 'Update saved deck' : 'Save deck'}
          </button>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70 flex items-center gap-1"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          {getIcon('copy', { size: 12 })}
          {copyOk ? 'Copied' : 'Copy all'}
        </button>
        <button
          type="button"
          onClick={handlePdf}
          className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70 flex items-center gap-1"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          {getIcon('file-down', { size: 12 })}
          PDF
        </button>
      </div>

      {flashcards.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>Flashcards</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {flashcards.map((c, i) => (
              <FlashcardTile key={c.id || `fc-${i}`} card={c} index={i} />
            ))}
          </div>
        </section>
      )}

      {slides.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>Slides</h3>
          <div className="grid grid-cols-1 gap-3">
            {slides.map((s, i) => (
              <SlideTile key={s.id || `sl-${i}`} slide={s} index={i} />
            ))}
          </div>
        </section>
      )}

      {quiz.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>Quiz</h3>
          <div className="grid grid-cols-1 gap-3">
            {quiz.map((q, i) => (
              <QuizTile key={q.id || `qz-${i}`} item={q} index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
