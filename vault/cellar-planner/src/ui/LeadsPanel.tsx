import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { LeadsStore } from '../app/leads';
import type { UiStore } from '../app/uiStore';
import { Icon } from './icons';

const STATUS: Record<'new' | 'opened' | 'quoted', string> = { new: 'New', opened: 'Opened', quoted: 'Quoted' };
const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Website enquiries: people who sent the contact form with a design from the public planner. Opening one adds the visitor's design as a new design. */
export function LeadsPanel({ ui, leads, reload, onOpen }: { ui: UiStore; leads: LeadsStore; reload(): void; onOpen(id: number): void }) {
  const open = useStore(ui, (s) => s.leadsOpen);
  const { leads: list, status, reason } = useStore(leads, (s) => s);
  const first = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);
  const close = (): void => ui.getState().set({ leadsOpen: false });
  useEffect(() => {
    if (!open) return undefined;
    before.current = document.activeElement;
    reload();
    window.setTimeout(() => first.current?.focus(), 0);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') ui.getState().set({ leadsOpen: false }); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (before.current instanceof HTMLElement) before.current.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Website enquiries" data-testid="leads-modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal">
        <div className="modal-head"><h2>Website enquiries</h2><button type="button" className="icon-btn" title="Close." onClick={close} data-testid="leads-close"><Icon name="close" /></button></div>
        <div className="modal-body" tabIndex={0} role="region" aria-label="Enquiries">
          <p className="note">People who sent your website's contact form with a design from the public planner. Opening one adds their design as a new design, with your default rack type, ready to price and quote.</p>
          <div className="row">
            <button ref={first} type="button" className="btn" title="Check for new enquiries." onClick={reload} data-testid="leads-refresh">{status === 'loading' ? 'Checking…' : 'Refresh'}</button>
          </div>
          {status === 'unavailable' && <p className="note" role="status" data-testid="leads-unavailable">Enquiries could not be loaded: {reason}.</p>}
          <ul className="plist" data-testid="leads-list">
            {list.map((l) => (
              <li key={l.id} data-testid="lead-item">
                <button type="button" className="plist-main" title="Open this enquiry's design as a new design." onClick={() => { onOpen(l.id); close(); }} data-testid={`lead-open-${l.id}`}>
                  <strong>{l.name} <span className={`lead-status ${l.status}`} data-testid="lead-status">{STATUS[l.status]}</span></strong>
                  <span>{[l.bottles !== null ? `${l.bottles} bottles` : '', l.priceText ? `guide ${l.priceText}` : '', when(l.createdAt)].filter(Boolean).join(' · ')}</span>
                  {l.summary && <span className="lead-summary">{l.summary}</span>}
                </button>
              </li>
            ))}
            {status === 'ready' && list.length === 0 && <li className="empty">No enquiries yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
