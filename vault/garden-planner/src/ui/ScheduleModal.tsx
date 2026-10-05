import { useEffect, useMemo } from 'react';
import { csvBlobParts, saveBlob } from '@planner-core/export/csv';
import { CLIMATE_LABEL, FROST_LABEL } from '../domain/climate';
import { buildPlantSchedule, DRAFT_NOTE, scheduleCsv, scheduleFileName, WEED_NOTE, type ScheduleRow } from '../schedule/plantSchedule';
import { useApp, useProject, useUi } from './AppContext';
import { Icon } from './icons';

const today = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const range = (r: [number, number]): string => (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`);

/** "Plant schedule": what is planted, one row per kind of plant, as a table here and as a CSV download for a nursery order or a spreadsheet. */
export function ScheduleModal() {
  const app = useApp();
  const open = useUi((s) => s.scheduleOpen);
  const project = useProject((s) => s.project);
  const schedule = useMemo(() => (open && project ? buildPlantSchedule(project) : null), [open, project]);
  const close = (): void => app.ui.getState().set({ scheduleOpen: false });
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !project || !schedule) return null;

  const download = (): void => saveBlob(new Blob(csvBlobParts(scheduleCsv(schedule)), { type: 'text/csv;charset=utf-8' }), scheduleFileName(project.name));
  const Row = ({ r }: { r: ScheduleRow }) => (
    <tr data-testid="schedule-row">
      <td>{r.ref}</td>
      <td><strong>{r.common}</strong><br /><em>{r.botanical}</em></td>
      <td className="num">{r.qty}</td>
      <td>{r.height[1] ? `${range(r.height)} m high, ${range(r.spread)} m wide` : ''}</td>
      <td className="num">{r.spacing ? `${r.spacing} m` : ''}</td>
      <td>{r.where}</td>
      <td>{[r.cautions, r.weed && !r.weed.startsWith('Not listed') ? r.weed : '', r.notes].filter(Boolean).join('. ')}</td>
    </tr>
  );

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Plant schedule" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal wide schedule">
        <div className="modal-head"><h2>Plant schedule</h2><button type="button" className="icon-btn" title="Close" onClick={close}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">
          <p className="summary">
            <span>{project.name}</span><span>{project.location.label}</span><span>{CLIMATE_LABEL[project.climateZone]}, frost: {FROST_LABEL[project.frost].toLowerCase()}</span><span>{today()}</span>
          </p>
          {schedule.rows.length === 0 ? (
            <p className="note" data-testid="schedule-empty">There are no plants in this garden yet. Add some from the library, then come back for the schedule.</p>
          ) : (
            <>
              <p className="note" data-testid="schedule-total"><strong>{schedule.total} plant{schedule.total === 1 ? '' : 's'}</strong> in {schedule.species} kind{schedule.species === 1 ? '' : 's'}.{schedule.missing > 0 ? ` ${schedule.missing} are no longer in the plant library.` : ''}</p>
              <div className="schedule-scroll">
                <table className="schedule-table">
                  <thead><tr><th>No.</th><th>Plant</th><th className="num">Qty</th><th>Mature size</th><th className="num">Spacing</th><th>Where</th><th>Cautions and notes</th></tr></thead>
                  <tbody>{schedule.rows.map((r) => <Row key={r.plantId} r={r} />)}</tbody>
                </table>
              </div>
              <p className="note warn" data-testid="schedule-draft">{DRAFT_NOTE} {WEED_NOTE}</p>
              <div className="row">
                <button type="button" className="btn primary" onClick={download} data-testid="schedule-download"><Icon name="download" size={15} /> Download CSV</button>
                <span className="note">Opens in Excel or Google Sheets, with sizes, needs, flowering, weed status and where each plant is.</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
