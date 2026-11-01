import React, { useState } from 'react';
import Tooltip from '../../components/Tooltip';

// The strip above a list that lets the person tick several items and delete them together. `sel` comes from useSelection(); `allIds` are the ids
// shown right now (Select all ticks those); `onDelete(ids)` does the deleting. `verb` is the button word ("Delete", "Remove"), `noun` the thing
// ("videos", "searches"), `tip` says what deleting means in this list.

const small = { fontFamily: 'inherit', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, padding: '0.25rem 0.65rem', borderRadius: 999, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-muted)' };

export default function SelectBar({ sel, allIds, verb = 'Delete', noun = 'videos', tip, onDelete }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const all = Array.isArray(allIds) ? allIds : [];

  async function run() {
    setBusy(true);
    try { await onDelete([...sel.ids]); sel.stop(); } finally { setBusy(false); setConfirm(false); }
  }

  if (!sel.mode) {
    return (
      <Tooltip text={`Tick several ${noun} to ${verb.toLowerCase()} them together.`}>
        <button type="button" onClick={sel.start} disabled={!all.length} style={{ ...small, opacity: all.length ? 1 : 0.5 }}>Select</button>
      </Tooltip>
    );
  }

  const allTicked = all.length > 0 && all.every((id) => sel.has(id));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      <button type="button" onClick={() => (allTicked ? sel.clear() : sel.setAll(all))} style={small}>{allTicked ? 'Clear' : `Select all (${all.length})`}</button>
      <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>{sel.count} selected</span>
      {!confirm ? (
        <Tooltip text={tip || `${verb} the ticked ${noun}.`}>
          <button type="button" disabled={!sel.count} onClick={() => setConfirm(true)} style={{ ...small, color: '#b91c1c', borderColor: '#fca5a5', opacity: sel.count ? 1 : 0.5 }}>{verb} selected</button>
        </Tooltip>
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--color-text)' }}>
          {verb} {sel.count} {sel.count === 1 ? noun.replace(/s$/, '') : noun}?
          <button type="button" disabled={busy} onClick={run} style={{ ...small, color: '#b91c1c', borderColor: '#fca5a5' }}>{busy ? '…' : 'Yes'}</button>
          <button type="button" disabled={busy} onClick={() => setConfirm(false)} style={small}>No</button>
        </span>
      )}
      <button type="button" onClick={() => { setConfirm(false); sel.stop(); }} style={small}>Done</button>
    </div>
  );
}
