import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { CatalogueStore } from '../app/catalogue';
import type { AppStore } from '../app/store';
import type { UiStore } from '../app/uiStore';
import { calcToText, explainCalculations } from '../help/calcExplain';
import { Icon } from './icons';

/**
 * "How the numbers are calculated": for technicians. Every step is worked through with the OPEN design's own numbers (formula, working, result), using
 * the planner's own maths, so what is shown is what the planner did. Copy as text puts it in a ticket or an email to the fabricator.
 */
export function CalcModal({ store, ui, catalogue }: { store: AppStore; ui: UiStore; catalogue: CatalogueStore }) {
  const open = useStore(ui, (s) => s.calcOpen);
  const project = useStore(store, (s) => s.project);
  const cat = useStore(catalogue, (s) => s.catalogue);
  const sections = useMemo(() => (open ? explainCalculations(project, cat) : []), [open, project, cat]);
  const [copied, setCopied] = useState('');
  const first = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const close = (): void => ui.getState().set({ calcOpen: false });
  useEffect(() => {
    if (!open) return undefined;
    before.current = document.activeElement;
    setCopied('');
    window.setTimeout(() => first.current?.focus(), 0);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') ui.getState().set({ calcOpen: false }); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (before.current instanceof HTMLElement) before.current.focus(); };
  }, [open, ui]);
  if (!open) return null;

  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(calcToText(sections, project.name)); setCopied('Copied. Paste it into your ticket or email.'); } catch { setCopied('Could not copy: select the text on screen instead.'); }
  };
  const jump = (id: string): void => { const el = body.current?.querySelector<HTMLElement>(`[data-calc="${id}"]`); if (el) { el.scrollIntoView({ block: 'start' }); el.focus({ preventScroll: true }); } };

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="How the numbers are calculated" data-testid="calc-modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal wide help">
        <div className="modal-head"><h2>How the numbers are calculated</h2><button type="button" className="icon-btn" title="Close" onClick={close} data-testid="calc-close"><Icon name="close" /></button></div>
        <div className="modal-body" ref={body} tabIndex={0} role="region" aria-label="Calculations">
          <p>Worked through with <b>{project.name}</b>, the design that is open now. Each step shows the formula, the working with this design's numbers, and the result. It is the planner's own maths, so it changes as you change the design.</p>
          <nav className="calc-nav" aria-label="Sections">
            {sections.map((s, i) => <button type="button" key={s.id} ref={i === 0 ? first : undefined} className="btn small" title={`Jump to: ${s.title}`} onClick={() => jump(s.id)} data-testid={`calc-jump-${s.id}`}>{s.title}</button>)}
            <button type="button" className="btn small" title="Copy the whole explanation as plain text, to paste into a ticket or an email to the fabricator." onClick={() => void copy()} data-testid="calc-copy">Copy as text</button>
          </nav>
          {copied && <p className="note" role="status" data-testid="calc-copied">{copied}</p>}
          {sections.map((s) => (
            <section key={s.id} data-calc={s.id} tabIndex={-1} className="calc-section" aria-labelledby={`calc-h-${s.id}`} data-testid={`calc-${s.id}`}>
              <h3 id={`calc-h-${s.id}`}>{s.title}</h3>
              <p>{s.summary}</p>
              <table className="calc-table">
                <thead><tr><th scope="col">Step</th><th scope="col">Formula</th><th scope="col">Working</th><th scope="col">Result</th></tr></thead>
                <tbody>
                  {s.lines.map((l) => <tr key={`${s.id}-${l.label}`}><th scope="row">{l.label}</th><td>{l.formula}</td><td className="calc-working">{l.working}</td><td className="calc-result">{l.result}</td></tr>)}
                </tbody>
              </table>
              {s.notes.length > 0 && <ul className="calc-notes">{s.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            </section>
          ))}
        </div>
        <div className="modal-foot"><span className="grow" /><button type="button" className="btn primary" title="Close this window." onClick={close} data-testid="calc-done">Done</button></div>
      </div>
    </div>
  );
}
