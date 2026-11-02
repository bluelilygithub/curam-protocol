import React, { useState, useEffect, useCallback } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';

const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const btnLine = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const btnPrimary = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
const field = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' };
const small = 'text-xs px-2 py-1 rounded border hover:opacity-70 transition-opacity duration-200 disabled:opacity-30';

/** Set lists for play mode: name a list, choose and order its songs, and play it from the first song. */
export default function SetLists({ songs, onPlay }) {
  const addToast = useToastStore(s => s.addToast);
  const [lists, setLists] = useState(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);     // { id, name, ids }
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    api.get('/api/guitar-play/setlists').then(r => r.json()).then(d => setLists(Array.isArray(d) ? d : [])).catch(() => setLists([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const usable = songs.filter(s => s.status === 'done');
  const titleOf = (id) => songs.find(s => s.id === id)?.title || 'Song';

  const create = async () => {
    if (!name.trim()) return;
    try {
      const res = await api.post('/api/guitar-play/setlists', { name: name.trim(), songIds: [] });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setName('');
      load();
      setEditing({ id: data.id, name: data.name, ids: [] });
    } catch (e) { addToast(e.message, 'error'); }
  };

  const save = async () => {
    try {
      const res = await api.put(`/api/guitar-play/setlists/${editing.id}`, { name: editing.name, songIds: editing.ids });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditing(null);
      load();
      addToast('Set list saved', 'success');
    } catch (e) { addToast(e.message, 'error'); }
  };

  const remove = async (id) => {
    try {
      const res = await api.delete(`/api/guitar-play/setlists/${id}`);
      if (!res.ok) throw new Error('Could not delete');
      setConfirmDelete(null);
      if (editing?.id === id) setEditing(null);
      load();
    } catch (e) { addToast(e.message, 'error'); }
  };

  const move = (i, d) => setEditing(ed => {
    const ids = ed.ids.slice(); const j = i + d;
    if (j < 0 || j >= ids.length) return ed;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return { ...ed, ids };
  });
  const toggle = (id) => setEditing(ed => ({ ...ed, ids: ed.ids.includes(id) ? ed.ids.filter(x => x !== id) : [...ed.ids, id] }));

  return (
    <div className="flex flex-col gap-3" data-tour="guitar-setlists">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Set lists</h2>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        Put songs in the order you will play them, then press Play to open them in play mode: a big chart you can move through with the keyboard or a foot pedal.
      </p>
      <div className="flex gap-2">
        <Tooltip text={GT.setName}>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }} maxLength={80}
            aria-label="Name for a new set list" placeholder="New set list, e.g. Friday gig"
            className="flex-1 text-sm px-3 py-2 rounded-lg border" style={field} />
        </Tooltip>
        <Tooltip text={GT.setCreate}>
          <button onClick={create} disabled={!name.trim()} className="px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-40 hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>Create</button>
        </Tooltip>
      </div>

      {lists && lists.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No set lists yet.</p>}
      {(lists || []).map(l => (
        <div key={l.id} className="rounded-xl border p-3 flex flex-col gap-2" style={card}>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{l.name}</p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {l.songs.length} {l.songs.length === 1 ? 'song' : 'songs'}{l.songs.length ? `: ${l.songs.map(s => s.title).join(', ')}` : ''}
              </p>
            </div>
            <Tooltip text={GT.setPlay}>
              <button onClick={() => onPlay(l.songs.map(s => s.songId))} disabled={!l.songs.length}
                className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>Play</button>
            </Tooltip>
            <Tooltip text={GT.setEdit}>
              <button onClick={() => setEditing({ id: l.id, name: l.name, ids: l.songs.map(s => s.songId) })} className={small} style={btnLine}>Edit</button>
            </Tooltip>
            {confirmDelete === l.id ? (
              <>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Delete?</span>
                <Tooltip text={GT.setDelete}>
                  <button onClick={() => remove(l.id)} className={small} style={{ borderColor: 'rgba(220,38,38,0.4)', color: '#dc2626' }}>Yes</button>
                </Tooltip>
                <Tooltip text={GT.setCancel}>
                  <button onClick={() => setConfirmDelete(null)} className={small} style={btnLine}>No</button>
                </Tooltip>
              </>
            ) : (
              <Tooltip text={GT.setDelete}>
                <button onClick={() => setConfirmDelete(l.id)} className={small} style={{ borderColor: 'rgba(220,38,38,0.3)', color: '#dc2626' }}>Delete</button>
              </Tooltip>
            )}
          </div>

          {editing?.id === l.id && (
            <div className="flex flex-col gap-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
              <Tooltip text={GT.setName}>
                <input value={editing.name} onChange={e => setEditing(ed => ({ ...ed, name: e.target.value }))} maxLength={80}
                  aria-label="Set list name" className="text-sm px-3 py-2 rounded-lg border" style={field} />
              </Tooltip>
              {editing.ids.length > 0 && (
                <ol className="flex flex-col gap-1">
                  {editing.ids.map((id, i) => (
                    <li key={id} className="flex items-center gap-2">
                      <span className="text-xs w-5 text-right" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
                      <span className="flex-1 text-sm truncate" style={{ color: 'var(--color-text)' }}>{titleOf(id)}</span>
                      <Tooltip text={GT.setUp}><button onClick={() => move(i, -1)} disabled={i === 0} className={small} style={btnLine} aria-label={`Move ${titleOf(id)} earlier`}>↑</button></Tooltip>
                      <Tooltip text={GT.setDown}><button onClick={() => move(i, 1)} disabled={i === editing.ids.length - 1} className={small} style={btnLine} aria-label={`Move ${titleOf(id)} later`}>↓</button></Tooltip>
                      <Tooltip text={GT.setSong}><button onClick={() => toggle(id)} className={small} style={btnLine} aria-label={`Remove ${titleOf(id)}`}>Remove</button></Tooltip>
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Add songs</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {usable.filter(s => !editing.ids.includes(s.id)).map(s => (
                  <Tooltip text={GT.setSong} key={s.id}>
                    <label className="flex items-center gap-1 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                      <input type="checkbox" checked={false} onChange={() => toggle(s.id)} />
                      {s.title}
                    </label>
                  </Tooltip>
                ))}
                {usable.length === 0 && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Add songs to the Library first.</span>}
              </div>
              <div className="flex gap-2">
                <Tooltip text={GT.setSave}><button onClick={save} className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>Save</button></Tooltip>
                <Tooltip text={GT.setCancel}><button onClick={() => setEditing(null)} className={small} style={btnLine}>Cancel</button></Tooltip>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
