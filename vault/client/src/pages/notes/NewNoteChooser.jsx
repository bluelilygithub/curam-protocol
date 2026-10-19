import React, { useEffect } from 'react';
import { useIcon } from '../../providers/IconProvider';

/**
 * What the + on the Notes list opens: a new note, written or spoken. "Write a note" opens the editor, where the title and the text are
 * entered; "Record a voice note" opens the recorder (the words, tidied up, become the note). On a phone it slides up from the bottom
 * like a sheet, on a bigger screen it is a centred card.
 */
export default function NewNoteChooser({ onWrite, onVoice, onClose, mobile }) {
  const getIcon = useIcon();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const option = (icon, title, text, onClick, primary) => (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-4 text-left rounded-2xl px-4 py-4 transition-opacity duration-200 hover:opacity-80"
      style={{
        minHeight: 76,
        background: primary ? 'var(--color-primary)' : 'var(--color-bg)',
        color: primary ? '#fff' : 'var(--color-text)',
        border: primary ? 'none' : '1px solid var(--color-border)',
      }}
    >
      <span className="flex-shrink-0">{getIcon(icon, { size: 24 })}</span>
      <span className="min-w-0">
        <span className="block text-base font-semibold">{title}</span>
        <span className="block text-xs mt-0.5" style={{ opacity: primary ? 0.9 : 1, color: primary ? '#fff' : 'var(--color-muted)' }}>{text}</span>
      </span>
    </button>
  );

  return (
    <div
      className={`fixed inset-0 flex ${mobile ? 'items-end' : 'items-center'} justify-center z-50`}
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md p-5 space-y-3 shadow-xl ${mobile ? 'rounded-t-2xl' : 'rounded-2xl m-4'}`}
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', paddingBottom: mobile ? 'max(20px, env(safe-area-inset-bottom))' : undefined }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="New note"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>New note</h3>
          <button
            type="button" aria-label="Close" onClick={onClose}
            className="hover:opacity-60 transition-opacity duration-200"
            style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {getIcon('x', { size: 18 })}
          </button>
        </div>
        {option('pen-line', 'Write a note', 'Type it, or speak it as you go. You add the title on the next screen.', onWrite, true)}
        {option('mic', 'Record a voice note', 'Talk it through. Your words are written up into a note for you.', onVoice, false)}
      </div>
    </div>
  );
}
