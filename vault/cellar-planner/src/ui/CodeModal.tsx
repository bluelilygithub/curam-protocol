import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { UiStore } from '../app/uiStore';
import type { AppProject } from '../app/model';
import { decodeDesign, liteToProject } from '../lite/settings';
import { Icon } from './icons';

/** Pull a design code out of whatever was pasted: the bare code, the "Design code: ..." line, or a whole enquiry email. */
export function findDesignCode(text: string): string | null {
  const m = /CL\d+\.[A-Za-z0-9_-]+/.exec(text);
  return m ? m[0] : null;
}

/** The project a design code stands for, or a plain-language reason it cannot be opened. */
export function projectFromCode(text: string): { project: AppProject } | { error: string } {
  const code = findDesignCode(text);
  if (!code) return { error: 'No design code found. A code looks like CL1.WzI3NTAs... and comes from the public planner.' };
  const settings = decodeDesign(code);
  if (!settings) return { error: 'That code could not be read. It may be incomplete, or from a newer version of the planner.' };
  return { project: liteToProject(settings) };
}

/** "Open from design code": paste a visitor's code from the public lite planner and it is ADDED as a new design (nothing is overwritten). */
export function CodeModal({ ui, onOpen }: { ui: UiStore; onOpen(p: AppProject): void }) {
  const open = useStore(ui, (s) => s.codeOpen);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const close = (): void => { setText(''); setError(''); ui.getState().set({ codeOpen: false }); };
  useEffect(() => {
    if (!open) return undefined;
    field.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  const submit = (): void => {
    const r = projectFromCode(text);
    if ('error' in r) { setError(r.error); return; }
    onOpen(r.project);
    close();
  };
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Open from design code" data-testid="code-modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal">
        <div className="modal-head"><h2>Open from design code</h2><button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={close} data-testid="code-close"><Icon name="close" /></button></div>
        <div className="modal-body">
          <p>Paste the design code from a visitor&apos;s enquiry. It opens as a new design with best-guess racks (every value marked estimated); your other designs are not changed.</p>
          <label className="field">
            <span className="field-label">Design code</span>
            <textarea ref={field} rows={4} value={text} onChange={(e) => { setText(e.target.value); setError(''); }} placeholder="CL1.WzI3NTAs..." data-testid="code-input" />
          </label>
          {error && <p className="field-err" role="alert" data-testid="code-error">{error}</p>}
        </div>
        <div className="modal-foot"><span className="grow" /><button type="button" className="btn" title="Close without opening anything." onClick={close}>Cancel</button><button type="button" className="btn primary" title="Add the design to Your designs and open it." onClick={submit} data-testid="code-open-go">Open</button></div>
      </div>
    </div>
  );
}
