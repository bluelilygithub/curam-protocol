// Furniture schedule and plan PDF: what is in the room (or every room), grouped with quantities, sizes and costs, as a table, a CSV and a PDF.
import { useEffect, useMemo, useState } from 'react';
import { projectName } from '../engine/roomOps';
import { isoDate } from '../render3d/photo';
import { buildSchedule, csvBlobParts, money, roomsText, scheduleFileName, scopeRooms, sizeText, type ScheduleRow, type ScheduleScope } from '../schedule/schedule';
import { useApp, useProject, useUi } from './AppContext';

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Rows({ rows, scope }: { rows: ScheduleRow[]; scope: ScheduleScope }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={`${r.category}-${r.no}-${r.name}-${r.width}-${r.height}`}>
          <td className="num">{r.no || '–'}</td>
          <td>{r.name}{scope === 'all' && <small>{roomsText(r)}</small>}{r.notes && <small>{r.notes}</small>}</td>
          <td className="num">{r.qty}</td>
          <td>{sizeText(r)}</td>
          <td><small className="plain">{[r.vendor, r.sku, r.finishCode].filter(Boolean).join(' · ') || '–'}</small></td>
          <td className="num">{r.unitCost === undefined ? '–' : money(r.unitCost)}</td>
          <td className="num">{r.total === undefined ? '–' : money(r.total)}</td>
        </tr>
      ))}
    </>
  );
}

export function SchedulePanel() {
  const app = useApp();
  const open = useUi((s) => s.scheduleOpen);
  const doc = useProject((s) => s.document);
  const activeId = useProject((s) => s.activeRoomId);
  const [scope, setScope] = useState<ScheduleScope>('room');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const close = (): void => { app.ui.getState().setScheduleOpen(false); setProblem(null); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); app.ui.getState().setScheduleOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, app]);

  const rooms = useMemo(() => (doc ? scopeRooms(doc, scope, activeId) : []), [doc, scope, activeId]);
  const schedule = useMemo(() => (doc ? buildSchedule(doc, rooms, scope) : null), [doc, rooms, scope]);
  if (!open || !doc || !schedule) return null;
  const pname = projectName(doc);
  const roomLabel = scope === 'all' ? null : rooms[0]?.name ?? null;
  const t = schedule.totals;

  const csv = (): void => {
    save(new Blob(csvBlobParts(schedule), { type: 'text/csv;charset=utf-8' }), scheduleFileName(pname, roomLabel, 'schedule', 'csv'));
  };
  const pdf = async (): Promise<void> => {
    setBusy(true); setProblem(null);
    try {
      const { makePdf } = await import('../schedule/pdf'); // pdf-lib loads only now
      const bytes = await makePdf({ project: doc, rooms, schedule, projectName: pname, date: isoDate(new Date()) });
      save(new Blob([bytes as BlobPart], { type: 'application/pdf' }), scheduleFileName(pname, roomLabel, 'plan', 'pdf'));
    } catch (e) {
      setProblem(e instanceof Error ? `The PDF could not be made: ${e.message}` : 'The PDF could not be made.');
    } finally { setBusy(false); }
  };

  const empty = schedule.furniture.length === 0 && schedule.openings.length === 0;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal schedule-panel" role="dialog" aria-modal="true" aria-label="Furniture schedule">
        <div className="modal-head">
          <h2>Furniture schedule</h2>
          <button className="btn icon" onClick={close} aria-label="Close schedule" title="Close (Esc)">×</button>
        </div>
        <div className="schedule-bar">
          <div className="seg-choice" role="group" aria-label="What to list">
            <button className={`btn ${scope === 'room' ? 'active' : ''}`} aria-pressed={scope === 'room'} onClick={() => setScope('room')} title="Only the room you are in">This room</button>
            <button className={`btn ${scope === 'all' ? 'active' : ''}`} aria-pressed={scope === 'all'} disabled={doc.rooms.length < 2} onClick={() => setScope('all')} title={doc.rooms.length < 2 ? 'Add another room to list every room together' : 'Every room in this project, with the rooms each piece is in'}>All rooms</button>
          </div>
          <p className="storage-note" role="status">
            {t.pieces} piece{t.pieces === 1 ? '' : 's'} · {t.kinds} kind{t.kinds === 1 ? '' : 's'} · {t.openings} door/window{t.openings === 1 ? '' : 's'}
            {t.priced > 0 ? ` · total ${money(t.cost)}` : ''}{t.priced > 0 && t.unpriced > 0 ? ` (${t.unpriced} without a cost)` : ''}
          </p>
        </div>
        <div className="schedule-body">
          {empty ? <p className="empty-line">Nothing has been placed in {scope === 'all' ? 'this project' : 'this room'} yet. Add pieces from the Library.</p> : (
            <table className="schedule-table">
              <thead>
                <tr><th className="num">No.</th><th>Item</th><th className="num">Qty</th><th>Size</th><th>Vendor / SKU / Finish</th><th className="num">Unit cost</th><th className="num">Total</th></tr>
              </thead>
              <tbody>
                {schedule.furniture.length > 0 && <tr className="group-row"><td colSpan={7}>Furniture and decor</td></tr>}
                <Rows rows={schedule.furniture} scope={scope} />
                {schedule.openings.length > 0 && <tr className="group-row"><td colSpan={7}>Doors and windows</td></tr>}
                <Rows rows={schedule.openings} scope={scope} />
              </tbody>
              <tfoot>
                <tr><td colSpan={5}>Total</td><td /><td className="num">{money(t.cost) || '0.00'}</td></tr>
              </tfoot>
            </table>
          )}
          <p className="hint">Set a piece's vendor, SKU, finish code, unit cost and notes in the Inspector (Metadata). Pieces of the same kind with the same size and details are counted together. The numbers match the numbers on the PDF plan.</p>
          {problem && <p className="storage-note" role="alert">{problem}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={csv} disabled={empty} title="A spreadsheet file (opens in Excel, Numbers or Google Sheets)">Download CSV</button>
          <button className="btn primary" onClick={() => void pdf()} disabled={busy || rooms.length === 0} title="A PDF: a to-scale plan of each room with dimensions and numbered pieces, then this schedule">{busy ? 'Making the PDF…' : 'Download PDF'}</button>
          <span className="spacer" />
          <button className="btn" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}
