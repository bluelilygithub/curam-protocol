import { useEffect, useState } from 'react';
import { plantById, plantLabel } from '../plants/plants';
import { creditsCsv, type PlantPhoto } from '../state/plantPhotos';
import { useApp, useProject, useUi } from './AppContext';
import { Icon } from './icons';

type Row = PlantPhoto & { plantId: string };

/** Photo credits for the plants in this garden: creator, licence and source for every photo that can appear, plus a CSV download. */
export function CreditsModal() {
  const app = useApp();
  const open = useUi((s) => s.creditsOpen);
  // a string, not an array: a selector that builds a new array every time would re-render forever
  const ids = useProject((s) => [...new Set(s.project?.plants.map((x) => x.plantId) ?? [])].sort().join(','));
  const plantIds = ids ? ids.split(',') : [];
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setRows(null);
    void app.plantPhotos.credits(ids ? ids.split(',') : []).then((r) => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [app, open, ids]);
  if (!open) return null;
  const close = (): void => app.ui.getState().set({ creditsOpen: false });
  const download = (): void => {
    const url = URL.createObjectURL(new Blob([creditsCsv(rows ?? [])], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'garden-planner-photo-credits.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Photo credits" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal wide help">
        <div className="modal-head"><h2>Photo credits</h2><button type="button" className="icon-btn" title="Close" onClick={close}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">
          <p className="note">Plant photos come from iNaturalist, Wikimedia Commons and the Atlas of Living Australia, and only under open licences that allow this use. Each photo stays with its creator; the links go to the licence and the original. Photos marked share-alike are shown as they are and are never edited.</p>
          {rows === null && <p className="note">Loading…</p>}
          {rows && rows.length === 0 && <p className="note">{plantIds.length === 0 ? 'Add plants to the garden to see the photos used for them.' : 'No photos have been found for the plants in this garden yet. Open a plant in the library to start the search.'}</p>}
          {rows && rows.length > 0 && (
            <>
              <button type="button" className="btn" onClick={download}><Icon name="download" size={15} /> Download credits (CSV)</button>
              <ul className="credits">
                {rows.map((r) => (
                  <li key={`${r.plantId}-${r.id}`}>
                    <strong>{plantById(r.plantId) ? plantLabel(plantById(r.plantId)!) : r.plantId}</strong>{' '}
                    Photo: {r.creator}, {r.licenceUrl ? <a href={r.licenceUrl} target="_blank" rel="noopener noreferrer">{r.licenceCode}</a> : r.licenceCode} via <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">{r.sourceLabel}</a>{r.displayOnly ? ' (share-alike, shown unedited)' : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
