import React, { useState } from 'react';
import Dialog from '../../components/Dialog';
import { cleanTag } from './youtubeFormat.mjs';

// Shown right after a video is saved (and from "Category & tags" later): pick a category from the ones already used (or make a new one) and add tags.
// Rendered by the page, outside the watch window, so a click in here never reaches the watch window's click-to-close layer.

const NEW = '__new__';
const field = {
  width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)',
  background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.85rem', fontFamily: 'inherit',
};
const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: 999, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' };

export default function FavLabelsDialog({ fav, categories, tags: knownTags, justSaved, onSave, onClose }) {
  const existing = (categories || []).map((c) => c.name);
  const start = fav.category || '';
  const [choice, setChoice] = useState(!start ? '' : existing.some((n) => n.toLowerCase() === start.toLowerCase()) ? existing.find((n) => n.toLowerCase() === start.toLowerCase()) : NEW);
  const [newName, setNewName] = useState(choice === NEW ? start : '');
  const [tags, setTags] = useState(Array.isArray(fav.tags) ? fav.tags : []);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  function addTags(text) {
    const next = [...tags];
    for (const part of String(text).split(/[,;\n]/)) {
      const t = cleanTag(part);
      if (t && !next.includes(t) && next.length < 20) next.push(t);
    }
    setTags(next);
    setDraft('');
  }

  async function save() {
    setSaving(true);
    const category = choice === NEW ? newName.trim() : choice;
    const finalTags = draft.trim() ? [...tags, cleanTag(draft)].filter((t, i, a) => t && a.indexOf(t) === i) : tags;
    try { await onSave({ category, tags: finalTags }); onClose(); }
    finally { setSaving(false); }
  }

  const suggestions = (knownTags || []).filter((t) => !tags.includes(t.name)).slice(0, 12);

  return (
    <Dialog
      title={justSaved ? 'Saved. Add a category and tags?' : 'Category and tags'}
      onClose={onClose}
      zIndex="z-[1300]"
      footer={(
        <>
          <button type="button" onClick={onClose} style={{ ...field, width: 'auto', cursor: 'pointer', background: 'var(--color-bg)' }}>{justSaved ? 'Skip for now' : 'Cancel'}</button>
          <button type="button" onClick={save} disabled={saving} style={{ ...field, width: 'auto', cursor: 'pointer', fontWeight: 600, background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', border: 'none', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    >
      <p style={{ margin: '0 0 0.25rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)' }}>{fav.title}</p>
      <p style={{ margin: '0 0 0.9rem', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
        The category groups this video in your Favourites, and tags let you filter them. You can change both later with Category &amp; tags.
      </p>

      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }} htmlFor="fav-category">Category</label>
      <select id="fav-category" value={choice} onChange={(e) => setChoice(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
        <option value="">No category</option>
        {existing.map((n) => <option key={n} value={n}>{n}</option>)}
        <option value={NEW}>+ New category…</option>
      </select>
      {choice === NEW && (
        <input aria-label="New category name" autoFocus value={newName} onChange={(e) => setNewName(e.target.value.slice(0, 40))} placeholder="Name the new category, for example Recipes" style={{ ...field, marginTop: 6 }} />
      )}

      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, margin: '0.9rem 0 4px', color: 'var(--color-text)' }} htmlFor="fav-tag">Tags (press Enter or comma after each)</label>
      <input
        id="fav-tag"
        value={draft}
        onChange={(e) => { const v = e.target.value; if (/[,;]/.test(v)) addTags(v); else setDraft(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) addTags(draft); } else if (e.key === 'Backspace' && !draft && tags.length) setTags(tags.slice(0, -1)); }}
        onBlur={() => { if (draft.trim()) addTags(draft); }}
        placeholder="add a tag"
        style={field}
      />
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {tags.map((t) => (
            <span key={t} style={chip}>
              #{t}
              <button type="button" aria-label={`Remove tag ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-muted)', fontSize: '0.8rem', lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: '0 0 4px', fontSize: '0.7rem', color: 'var(--color-muted)' }}>Tags you already use</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map((t) => (
              <button type="button" key={t.name} onClick={() => addTags(t.name)} style={{ ...chip, cursor: 'pointer', color: 'var(--color-muted)' }}>+ {t.name}</button>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
