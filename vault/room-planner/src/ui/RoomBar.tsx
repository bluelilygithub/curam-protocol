import { useState } from 'react';
import { useApp, useProject, useUi } from './AppContext';

/**
 * The rooms of the open project: tabs to switch, add (rectangle, drawn, or a copy of this one), rename (double-click) and delete.
 * Only one room is edited at a time; there are no shared walls between rooms. Hidden while walking or touring so nothing is
 * switched by accident.
 */
export function RoomBar() {
  const app = useApp();
  const rooms = useProject((s) => s.document?.rooms);
  const activeId = useProject((s) => s.activeRoomId);
  const walking = useUi((s) => s.walking);
  const touring = useUi((s) => s.tourPlaying);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  if (!rooms || walking || touring) return null;
  const finish = (id: string): void => { app.renameRoom(id, draft); setRenaming(null); };
  const drawing = rooms.length > 0 && activeId === null;

  return (
    <div className="roombar" role="toolbar" aria-label="Rooms" data-tour="rp-rooms">
      {rooms.map((r) => (
        <span key={r.id} className={`room-tab ${r.id === activeId ? 'active' : ''}`}>
          {renaming === r.id ? (
            <input
              aria-label="Room name" value={draft} maxLength={80} autoFocus onChange={(e) => setDraft(e.target.value)} onBlur={() => finish(r.id)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') finish(r.id); if (e.key === 'Escape') setRenaming(null); }}
            />
          ) : (
            <button
              className="btn room-name" aria-pressed={r.id === activeId} aria-label={`Room ${r.name}`}
              title={r.id === activeId ? 'Double-click to rename' : `Open ${r.name}`}
              onClick={() => { setAdding(false); app.switchRoom(r.id); }}
              onDoubleClick={() => { app.switchRoom(r.id); setDraft(r.name); setRenaming(r.id); }}
            >
              <span className="label">{r.name}</span>
            </button>
          )}
          {r.id === activeId && renaming !== r.id && (
            deleting === r.id ? (
              <span className="inline-confirm" role="group" aria-label={`Delete ${r.name}?`}>
                Delete?
                <button className="btn danger" onClick={() => { setDeleting(null); app.deleteRoom(r.id); }}>Yes</button>
                <button className="btn" onClick={() => setDeleting(null)}>No</button>
              </span>
            ) : (
              <button className="btn icon" onClick={() => setDeleting(r.id)} aria-label={`Delete room ${r.name}`} title="Delete this room (undoable)">×</button>
            )
          )}
        </span>
      ))}
      {drawing && <span className="room-tab active"><span className="label">New room…</span></span>}
      <span className="add-room">
        <button className="btn" onClick={() => setAdding(!adding)} aria-expanded={adding} aria-haspopup="menu" title="Add a room to this project">
          <span className="label">+ Add room</span>
        </button>
        {adding && (
          <div className="menu" role="menu">
            <button role="menuitem" className="btn" title="Add a ready-made 4 × 5 m room" onClick={() => { setAdding(false); app.startRectangle(); }}>Rectangle (4 × 5 m)</button>
            <button role="menuitem" className="btn" title="Click each corner to draw a room of any shape" onClick={() => { setAdding(false); app.startDrawing(); }}>Draw a room</button>
            <button role="menuitem" className="btn" title="Add a copy of the room you are in, with its furniture" disabled={!activeId} onClick={() => { setAdding(false); app.duplicateRoom(); }}>Copy of this room</button>
          </div>
        )}
      </span>
    </div>
  );
}
