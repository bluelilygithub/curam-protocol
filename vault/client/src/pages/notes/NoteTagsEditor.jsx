import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import { addTag, removeTag, splitTags, suggestTags, MAX_TAG_LENGTH, MAX_TAGS_PER_NOTE } from './noteTags.mjs';

/**
 * The tags of the open note: chips you can remove, a box to add more (Enter or a comma adds; a pasted "a, b, c" adds three),
 * and the tags you already use offered as you type. `onChange(nextTags)` is called with the whole new list; the page saves it.
 */
export default function NoteTagsEditor({ tags, allTags, mobile, onChange }) {
  const getIcon = useIcon();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const current = Array.isArray(tags) ? tags : [];
  const full = current.length >= MAX_TAGS_PER_NOTE;

  function commit(raw) {
    const next = splitTags(raw).reduce((list, t) => addTag(list, t), current);
    if (next.length !== current.length) onChange(next);
  }

  const suggestions = focused || text ? suggestTags(allTags, current, text, mobile ? 6 : 8) : [];
  const chip = { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', minHeight: mobile ? 32 : 24 };

  return (
    <div className="space-y-1.5" role="group" aria-label="Tags">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex-shrink-0" style={{ color: 'var(--color-muted)' }} aria-hidden="true">{getIcon('tag', { size: 13 })}</span>
        {current.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full pl-2.5 pr-1 text-xs" style={chip}>
            {t}
            <button
              type="button" onClick={() => onChange(removeTag(current, t))}
              aria-label={`Remove tag ${t}`} title="Remove this tag from the note"
              className="flex items-center justify-center rounded-full hover:opacity-60 transition-opacity duration-200"
              style={{ color: 'var(--color-muted)', width: mobile ? 26 : 18, height: mobile ? 26 : 18 }}
            >{getIcon('x', { size: 11 })}</button>
          </span>
        ))}
        {!full && (
          <input
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              if (/[,;]/.test(v)) { commit(v); setText(''); } else setText(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(text); setText(''); }
              if (e.key === 'Escape') { setText(''); e.currentTarget.blur(); }
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); if (text.trim()) { commit(text); setText(''); } }}
            maxLength={MAX_TAG_LENGTH + 10}
            placeholder={current.length ? 'Add tag…' : 'Add tags, e.g. budget, ideas'}
            aria-label="Add a tag"
            className="bg-transparent outline-none flex-1 min-w-[110px] rounded px-1"
            style={{ color: 'var(--color-text)', fontSize: mobile ? 16 : 12, minHeight: mobile ? 36 : 24 }}
          />
        )}
        {full && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>20 tags is the most a note can have</span>}
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pl-5" aria-label="Your existing tags">
          {suggestions.map((s) => (
            <button
              key={s} type="button"
              onMouseDown={(e) => e.preventDefault()} // keep the box focused so the list does not vanish before the tap lands
              onClick={() => { commit(s); setText(''); }}
              className="rounded-full px-2.5 text-xs hover:opacity-70 transition-opacity duration-200"
              style={{ ...chip, color: 'var(--color-muted)', borderStyle: 'dashed' }}
            >+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
