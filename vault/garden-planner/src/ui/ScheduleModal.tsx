import { useEffect, useMemo, useState } from 'react';
import { csvBlobParts, saveBlob } from '@planner-core/export/csv';
import { CLIMATE_LABEL, FROST_LABEL } from '../domain/climate';
import type { GrowthStage } from '../plants/growth';
import { buildPlantSchedule, DRAFT_NOTE, scheduleCsv, scheduleFileName, WEED_NOTE, type ScheduleRow } from '../schedule/plantSchedule';
import type { Paper } from '../schedule/planSheet';
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
  const [paper, setPaper] = useState<Paper>('a4');
  const [asShown, setAsShown] = useState(false);
  const [dims, setDims] = useState(true);
  const [withSchedule, setWithSchedule] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const stageNow = useUi((s) => s.stage);
  const close = (): void => app.ui.getState().set({ scheduleOpen: false });
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !project || !schedule) return null;

  const download = (): void => saveBlob(new Blob(csvBlobParts(scheduleCsv(schedule)), { type: 'text/csv;charset=utf-8' }), scheduleFileName(project.name));
  const downloadPlan = async (): Promise<void> => {
    setBusy(true); setProblem(null);
    try {
      const { makePlanPdf, planFileName } = await import('../schedule/planPdf');
      const stage: GrowthStage = asShown ? stageNow : 'mature';
      const bytes = await makePlanPdf(project, { paper, stage, dimensions: dims, includeSchedule: withSchedule, date: today() });
      saveBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), planFileName(project.name));
    } catch (e) {
      setProblem(e instanceof Error && e.message ? `The plan could not be made: ${e.message}` : 'The plan could not be made.');
    } finally { setBusy(false); }
  };
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
        <div className="modal-head"><h2>Plant schedule and plan</h2><button type="button" className="icon-btn" title="Close" onClick={close}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">
          <p className="summary">
            <span>{project.name}</span><span>{project.location.label}</span><span>{CLIMATE_LABEL[project.climateZone]}, frost: {FROST_LABEL[project.frost].toLowerCase()}</span><span>{today()}</span>
          </p>
          <section className="plan-print" aria-label="Printable planting plan" data-testid="plan-print">
            <h3>Printable planting plan</h3>
            <p className="note">A to-scale plan on paper, with every plant numbered to match the schedule, a key, a north arrow and a scale bar, then the schedule. For the nursery, the builder or the fridge.</p>
            <div className="plan-opts">
              <label>Paper
                <select value={paper} onChange={(e) => setPaper(e.target.value as Paper)} aria-label="Paper size" disabled={busy}>
                  <option value="a4">A4</option><option value="a3">A3</option>
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={!asShown} onChange={(e) => setAsShown(!e.target.checked)} disabled={busy} /> Draw plants at mature size</label>
              <label className="check"><input type="checkbox" checked={dims} onChange={(e) => setDims(e.target.checked)} disabled={busy} /> Length of each boundary edge</label>
              <label className="check"><input type="checkbox" checked={withSchedule} onChange={(e) => setWithSchedule(e.target.checked)} disabled={busy} /> Include the plant schedule</label>
            </div>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => void downloadPlan()} disabled={busy} data-testid="plan-download"><Icon name="download" size={15} /> {busy ? 'Making the PDF…' : 'Download plan (PDF)'}</button>
              <span className="note">Plants are drawn {asShown ? `at the growth stage now showing` : 'at mature size, so you leave them room'}. The plan always says the plant data is a draft.</span>
            </div>
            {problem && <p className="note warn" role="alert" data-testid="plan-problem">{problem}</p>}
          </section>
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
