import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { NOTE_TIPS } from './noteTips.mjs';
import { normalizeTag, MAX_TAG_LENGTH } from './noteTags.mjs';

/**
 * Tidy the tags across all notes: rename one (naming it after an existing tag merges the two) or remove one from every note.
 * Removing a tag never deletes a note. `tags` is [{ tag, count }]; `onChanged({ type, from, to })` tells the page to refresh.
 */
export default function TagManager({ tags, mobile, onChanged, onClose }) {
  const getIcon = useIcon();
  const [renaming, setRenaming] = useState(null); // the tag being renamed
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(null); // the tag asking "Remove? Yes / No"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function rename(from) {
    const to = normalizeTag(draft);
    if (!to) { setError('Type the new name.'); return; }
    if (to === from) { setRenaming(null); return; }
    setBusy(true); setError('');
    try {
      const res = await api.post('/api/notes/tags/rename', { from, to });
      if (!res.ok) throw new Error('rename failed');
      setRenaming(null);
      onChanged({ type: 'rename', from, to });
    } catch { setError('The tag could not be renamed. Try again.'); }
    setBusy(false);
  }

  async function remove(tag) {
    setBusy(true); setError('');
    try {
      const res = await api.delete(`/api/notes/tags/${encodeURIComponent(tag)}`);
      if (!res.ok) throw new Error('remove failed');
      setConfirming(null);
      onChanged({ type: 'delete', from: tag });
    } catch { setError('The tag could not be removed. Try again.'); }
    setBusy(false);
  }

  const btn = { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', minHeight: mobile ? 40 : 28 };

  return (
    <div className={`fixed inset-0 z-50 flex ${mobile ? 'items-end' : 'items-center'} justify-center`} style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        className={`w-full max-w-md flex flex-col shadow-xl ${mobile ? 'rounded-t-2xl' : 'rounded-2xl m-4'}`}
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: '85dvh', paddingBottom: mobile ? 'max(16px, env(safe-area-inset-bottom))' : undefined }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Manage tags"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Manage tags</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)', minWidth: 40, minHeight: 40 }}>{getIcon('x', { size: 18 })}</button>
        </div>
        <p className="px-4 pb-2 text-xs" style={{ color: 'var(--color-muted)' }}>Rename a tag everywhere, or take it off every note. Naming a tag after one you already have joins them. Your notes are never deleted.</p>
        {error && <p className="px-4 pb-2 text-xs" style={{ color: '#ef4444' }} role="alert">{error}</p>}

        <ul className="overflow-y-auto flex-1 min-h-0 px-2 pb-2">
          {tags.length === 0 && <li className="px-2 py-6 text-sm text-center" style={{ color: 'var(--color-muted)' }}>No tags yet. Add some from an open note.</li>}
          {tags.map(({ tag, count }) => (
            <li key={tag} className="px-2 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
              {renaming === tag ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus value={draft} maxLength={MAX_TAG_LENGTH + 10} aria-label={`New name for ${tag}`}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') rename(tag); if (e.key === 'Escape') setRenaming(null); }}
                    className="flex-1 min-w-0 rounded px-2 outline-none"
                    style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-primary)', fontSize: 16, minHeight: mobile ? 44 : 32 }}
                  />
                  <button type="button" disabled={busy} onClick={() => rename(tag)} className="text-xs font-medium px-3 rounded-lg hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff', minHeight: mobile ? 44 : 32 }}>Save</button>
                  <button type="button" onClick={() => setRenaming(null)} className="text-xs px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ ...btn, minHeight: mobile ? 44 : 32 }}>Cancel</button>
                </div>
              ) : confirming === tag ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>Take "{tag}" off {count} note{count === 1 ? '' : 's'}?</span>
                  <button type="button" disabled={busy} onClick={() => remove(tag)} className="text-xs font-medium px-3 rounded-lg hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={{ background: '#ef4444', color: '#fff', minHeight: mobile ? 40 : 28 }}>Yes</button>
                  <button type="button" onClick={() => setConfirming(null)} className="text-xs px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={btn}>No</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-sm" style={{ color: 'var(--color-text)' }}>{tag}</span>
                  <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{count} note{count === 1 ? '' : 's'}</span>
                  <Tooltip text={NOTE_TIPS.tagRename}>
                    <button type="button" onClick={() => { setRenaming(tag); setDraft(tag); setConfirming(null); setError(''); }} className="text-xs px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={btn} aria-label={`Rename tag ${tag}`}>Rename</button>
                  </Tooltip>
                  <Tooltip text={NOTE_TIPS.tagDelete}>
                    <button type="button" onClick={() => { setConfirming(tag); setRenaming(null); setError(''); }} className="flex items-center justify-center rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ ...btn, color: '#ef4444', minWidth: mobile ? 40 : 28 }} aria-label={`Remove tag ${tag} from all notes`}>{getIcon('trash', { size: 14 })}</button>
                  </Tooltip>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="px-4 pt-2 flex justify-end flex-shrink-0">
          <button type="button" onClick={onClose} className="text-sm font-medium px-4 rounded-lg hover:opacity-80 transition-opacity duration-200" style={{ background: 'var(--color-primary)', color: '#fff', minHeight: mobile ? 48 : 36 }}>Done</button>
        </div>
      </div>
    </div>
  );
}
