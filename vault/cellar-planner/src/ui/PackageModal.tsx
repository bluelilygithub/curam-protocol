import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { AppProject } from '../app/model';
import type { AppStore } from '../app/store';
import type { UiStore } from '../app/uiStore';
import { Icon } from './icons';
import { TextField } from './fields';
import { insidePicture } from '../export/insidePicture';

type Details = NonNullable<AppProject['drawing']>;
const EMPTY: Details = { company: '', client: '', address: '', projectNo: '', drawnBy: '', checkedBy: '' };
const today = (): string => new Date().toISOString().slice(0, 10);

/** The drawing package: fill in the title block, then download the PDF (A3 sheets: specification, plan, elevation, and the racks on each wall). */
export function PackageModal({ store, ui }: { store: AppStore; ui: UiStore }) {
  const open = useStore(ui, (s) => s.packageOpen);
  const project = useStore(store, (s) => s.project);
  const [d, setD] = useState<Details>(project.drawing ?? EMPTY);
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const first = useRef<HTMLInputElement>(null);
  const before = useRef<Element | null>(null);

  const close = (): void => ui.getState().set({ packageOpen: false });
  useEffect(() => {
    if (!open) return undefined;
    before.current = document.activeElement;
    setD(store.getState().project.drawing ?? EMPTY);
    setDate(today());
    setMsg('');
    window.setTimeout(() => first.current?.focus(), 0);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') ui.getState().set({ packageOpen: false }); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (before.current instanceof HTMLElement) before.current.focus(); };
  }, [open, store, ui]);
  if (!open) return null;

  const set = (k: keyof Details) => (v: string): void => setD((x) => ({ ...x, [k]: v }));
  const download = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setMsg('');
    try {
      // the details are kept with the design (one undo step), so the next package starts filled in
      if (JSON.stringify(project.drawing ?? EMPTY) !== JSON.stringify(d)) store.getState().edit((p) => ({ ...p, drawing: d }));
      // pdf-lib is loaded only now, so it stays out of the main bundle
      const { makePackagePdf, packageFileName } = await import('../export/packagePdf');
      const current = store.getState().project;
      // the 3D picture of the inside goes in as its own sheet (skipped quietly if it cannot be drawn)
      let insideImage: string | undefined;
      // only when there are racks to show: a picture of an empty room adds nothing
      try { insideImage = current.runs.length ? await insidePicture(current) : undefined; } catch { insideImage = undefined; }
      const { bytes, sheets } = await makePackagePdf(current, { ...d, date }, insideImage ? { insideImage } : {});
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = packageFileName(project.name);
      a.click(); URL.revokeObjectURL(url);
      setMsg(`Downloaded ${sheets.length} sheets: ${sheets.map((s) => s.id).join(', ')}.`);
    } catch {
      setMsg('Could not make the PDF. Try again, and tell the team if it keeps happening.');
    }
    setBusy(false);
  };

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Drawing package" data-testid="package-modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal">
        <div className="modal-head"><h2>Drawing package</h2><button type="button" className="icon-btn" title="Close without making the PDF." onClick={close} data-testid="package-close"><Icon name="close" /></button></div>
        <div className="modal-body">
          <p className="note">A PDF of A3 sheets in the style of the Carter Noir drawings: a specification and schedule, the plan, the {project.enclosure.door.wall.toLowerCase()}-wall elevation, and the racks on each wall with every bottle drawn at its true size. Every sheet says <b>preliminary design only: final site measure required prior to fabrication</b>, and says whether the rack values are estimated, calculated or not set.</p>
          <div className="grid">
            <TextField label="Company (optional)" value={d.company} onChange={set('company')} inputRef={first} testid="pkg-company" hint="Printed at the left of the title block, in place of a logo." />
            <TextField label="Client" value={d.client} onChange={set('client')} testid="pkg-client" hint="The client's name, printed in the title block." />
            <TextField label="Address" value={d.address} onChange={set('address')} testid="pkg-address" hint="The site address, printed in the title block." />
            <TextField label="Project number" value={d.projectNo} onChange={set('projectNo')} testid="pkg-project-no" hint="Your project or job number, printed in the title block." />
            <TextField label="Drawn by" value={d.drawnBy} onChange={set('drawnBy')} testid="pkg-drawn" hint="The initials or name of whoever made the drawing." />
            <TextField label="Checked by" value={d.checkedBy} onChange={set('checkedBy')} testid="pkg-checked" hint="The initials or name of whoever checked it." />
            <TextField label="Date" type="date" value={date} onChange={setDate} testid="pkg-date" hint="The date printed on every sheet. It starts as today." />
          </div>
          {msg && <p className="note" role="status" data-testid="package-msg">{msg}</p>}
        </div>
        <div className="modal-foot">
          <span className="grow" />
          <button type="button" className="btn" title="Close without making the PDF." onClick={close}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy} title="Make the PDF and download it. The details above are kept with the design." onClick={() => void download()} data-testid="package-download">{busy ? 'Making the PDF…' : 'Download PDF'}</button>
        </div>
      </div>
    </div>
  );
}
