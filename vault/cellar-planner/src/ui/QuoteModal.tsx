import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { staffPrice, type CatalogueStore } from '../app/catalogue';
import { logQuote, type FetchFn } from '../app/leads';
import type { AppStore } from '../app/store';
import type { UiStore } from '../app/uiStore';
import { defaultReference, quoteBlockers, quoteFileName } from '../export/quote';
import { Icon } from './icons';
import { TextField } from './fields';

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * The customer quote: check the details, then download a PDF of the price breakdown. It refuses while the numbers behind it cannot be trusted (an
 * unconfirmed rack type, edited values, errors, no price) and lists exactly what to fix. When the design came from a website enquiry, making the
 * quote is also logged on that enquiry in the CRM.
 */
export function QuoteModal({ store, ui, catalogue, fetchFn, storage }: { store: AppStore; ui: UiStore; catalogue: CatalogueStore; fetchFn: FetchFn | undefined; storage: Pick<Storage, 'getItem'> }) {
  const open = useStore(ui, (s) => s.quoteOpen);
  const project = useStore(store, (s) => s.project);
  const cat = useStore(catalogue, (s) => s.catalogue);
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(today());
  const [customer, setCustomer] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const first = useRef<HTMLInputElement>(null);
  const before = useRef<Element | null>(null);

  const close = (): void => ui.getState().set({ quoteOpen: false });
  useEffect(() => {
    if (!open) return undefined;
    before.current = document.activeElement;
    const p = store.getState().project;
    const d = today();
    setDate(d); setReference(defaultReference(p, d)); setCustomer(p.lead?.name ?? p.drawing?.client ?? ''); setAddress(p.drawing?.address ?? ''); setNotes(''); setMsg('');
    window.setTimeout(() => first.current?.focus(), 0);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') ui.getState().set({ quoteOpen: false }); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (before.current instanceof HTMLElement) before.current.focus(); };
  }, [open, store, ui]);
  if (!open) return null;

  const blockers = quoteBlockers(project, cat);
  const price = staffPrice(project, cat);

  const download = async (): Promise<void> => {
    if (busy || blockers.length) return;
    setBusy(true); setMsg('');
    try {
      // the customer's details are kept with the design, so the drawing package and the next quote start filled in
      const keep = project.drawing ?? { company: '', client: '', address: '', projectNo: '', drawnBy: '', checkedBy: '' };
      if (keep.client !== customer || keep.address !== address) store.getState().edit((p) => ({ ...p, drawing: { ...keep, client: customer, address } }));
      // pdf-lib is loaded only now, so it stays out of the main bundle
      const { makeQuotePdf } = await import('../export/quotePdf');
      const r = await makeQuotePdf(store.getState().project, cat, { reference, date, customer, address, notes });
      if (!r.ok) { setMsg(r.blockers.join(' ')); setBusy(false); return; }
      const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = quoteFileName(project.name, reference);
      a.click(); URL.revokeObjectURL(url);
      let text = `Downloaded the quote (${r.pages} page${r.pages === 1 ? '' : 's'}, total ${r.doc.currency}${r.doc.total.toLocaleString('en-AU')}).`;
      if (project.lead) {
        const logged = await logQuote(fetchFn, storage, project.lead.id, { total: r.doc.total, text: price.status === 'OK' ? price.text : '', reference });
        text += logged.ok ? ` Logged on ${project.lead.name}'s enquiry in the CRM${logged.value.valueSet ? ' and set as the deal value' : ''}.` : ` It could not be logged on the enquiry (${logged.reason}); the PDF is fine.`;
      }
      setMsg(text);
    } catch {
      setMsg('Could not make the PDF. Try again, and tell the team if it keeps happening.');
    }
    setBusy(false);
  };

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Customer quote" data-testid="quote-modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal">
        <div className="modal-head"><h2>Customer quote</h2><button type="button" className="icon-btn" title="Close without making the PDF." onClick={close} data-testid="quote-close"><Icon name="close" /></button></div>
        <div className="modal-body">
          {blockers.length > 0 && (
            <div className="banner" role="alert" data-testid="quote-blockers">
              <p><b>A quote can't be made yet.</b> Fix {blockers.length === 1 ? 'this' : 'these'} first:</p>
              <ul>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          )}
          {price.status === 'OK' && <p className="note" data-testid="quote-total">Total: <b>{price.currency}{price.total.toLocaleString('en-AU')}</b> (from the Price panel). Your business details and terms come from Settings, Cellar Planner, Quote details.</p>}
          {project.lead && <p className="note" data-testid="quote-lead">From {project.lead.name}'s website enquiry: making the quote is logged on their deal in the CRM.</p>}
          <div className="grid">
            <TextField label="Customer" value={customer} onChange={setCustomer} inputRef={first} testid="quote-customer" hint="Who the quote is for, printed under Prepared for." />
            <TextField label="Address" value={address} onChange={setAddress} testid="quote-address" hint="The customer's or the site address, printed under their name." />
            <TextField label="Quote reference" value={reference} onChange={setReference} testid="quote-reference" hint="Printed on the quote and used for the file name. It starts as the date, plus the enquiry number when there is one." />
            <TextField label="Date" type="date" value={date} onChange={setDate} testid="quote-date" hint="The quote date. The valid-until date is worked out from it using the number of days set in Settings." />
            <TextField label="Notes (optional)" value={notes} onChange={setNotes} testid="quote-notes" hint="Anything specific to this customer, such as timing. Printed above your terms." />
          </div>
          {msg && <p className="note" role="status" data-testid="quote-msg">{msg}</p>}
        </div>
        <div className="modal-foot">
          <span className="grow" />
          <button type="button" className="btn" title="Close without making the PDF." onClick={close}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy || blockers.length > 0} title={blockers.length ? 'Not available yet: fix the items listed above.' : 'Make the quote PDF and download it.'} onClick={() => void download()} data-testid="quote-download">{busy ? 'Making the PDF…' : 'Download quote'}</button>
        </div>
      </div>
    </div>
  );
}
