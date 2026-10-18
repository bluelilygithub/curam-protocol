import { useEffect, useRef, useState } from 'react';
import { apiBase } from './config';

/** The states and territories of Australia, in the order people expect to find them. Vault accepts only these. */
export const AU_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'NSW', name: 'New South Wales' }, { code: 'VIC', name: 'Victoria' }, { code: 'QLD', name: 'Queensland' }, { code: 'WA', name: 'Western Australia' },
  { code: 'SA', name: 'South Australia' }, { code: 'TAS', name: 'Tasmania' }, { code: 'ACT', name: 'Australian Capital Territory' }, { code: 'NT', name: 'Northern Territory' },
];

export interface QuoteDesign { code: string; summary: string; bottles: number; priceText: string }
export interface QuoteFields { name: string; email: string; phone: string; state: string; message: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

/** What is wrong with the form, in plain words, or '' when it can be sent. Phone is optional but must look like a phone number when given. */
export function quoteProblem(f: QuoteFields): { field: keyof QuoteFields | ''; text: string } {
  if (!f.name.trim()) return { field: 'name', text: 'Please tell us your name.' };
  if (!EMAIL_RE.test(f.email.trim())) return { field: 'email', text: 'Please check your email address: it should look like name@example.com.' };
  if (f.phone.trim() && (f.phone.replace(/\D/g, '').length < 8 || !/^[0-9+()\-\s.]{6,24}$/.test(f.phone.trim()))) return { field: 'phone', text: 'Please check your phone number, or leave it blank.' };
  if (!AU_STATES.some((s) => s.code === f.state)) return { field: 'state', text: 'Please choose your state or territory.' };
  return { field: '', text: '' };
}

/** The body Vault's public enquiry route expects. */
export function enquiryBody(f: QuoteFields, d: QuoteDesign, honeypot = ''): Record<string, unknown> {
  return {
    name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), state: f.state, message: f.message.trim(),
    code: d.code, summary: d.summary.slice(0, 400), bottles: Number.isFinite(d.bottles) ? d.bottles : null, priceText: d.priceText.slice(0, 60), website: honeypot,
  };
}

type Phase = 'form' | 'sending' | 'sent' | 'failed';

/**
 * "Request a quote": the visitor's details are asked for right here instead of sending them to another page. Sent straight to the business's Vault
 * (which files it in the CRM and emails the owner). Nothing is sent until they press Send. If Vault cannot be reached the design stays on screen and
 * they are told to try again or call, never left guessing.
 */
export function QuoteForm({ open, onClose, design, phone, note = '', onSent, fetchFn = fetch }: {
  open: boolean; onClose(): void; design: QuoteDesign; phone: string; /** The owner's own reassurance line (for example how quickly they reply). */ note?: string; onSent?(): void; fetchFn?: typeof fetch;
}) {
  const [f, setF] = useState<QuoteFields>({ name: '', email: '', phone: '', state: '', message: '' });
  const [phase, setPhase] = useState<Phase>('form');
  const [shown, setShown] = useState<{ field: keyof QuoteFields | ''; text: string } | null>(null);
  const [trap, setTrap] = useState('');
  const first = useRef<HTMLInputElement>(null);
  const before = useRef<Element | null>(null);
  const refs = { name: first, email: useRef<HTMLInputElement>(null), phone: useRef<HTMLInputElement>(null), state: useRef<HTMLSelectElement>(null), message: useRef<HTMLTextAreaElement>(null) };

  useEffect(() => {
    if (!open) return undefined;
    before.current = document.activeElement;
    setPhase((p) => (p === 'sent' ? p : 'form')); setShown(null);
    const t = window.setTimeout(() => first.current?.focus(), 30);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(t); document.removeEventListener('keydown', onKey); if (before.current instanceof HTMLElement) before.current.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;

  const set = (k: keyof QuoteFields) => (e: { target: { value: string } }): void => { setF((o) => ({ ...o, [k]: e.target.value })); if (shown?.field === k) setShown(null); };

  const send = async (e: { preventDefault(): void }): Promise<void> => {
    e.preventDefault();
    if (phase === 'sending') return;
    const p = quoteProblem(f);
    if (p.text) { setShown(p); if (p.field) refs[p.field].current?.focus(); return; }
    setPhase('sending'); setShown(null);
    try {
      // text/plain is a "simple" request, so the browser makes no preflight round trip to Vault
      const r = await fetchFn(`${apiBase()}/api/cellar-lite/enquiry`, { method: 'POST', body: JSON.stringify(enquiryBody(f, design, trap)), headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, credentials: 'omit' });
      if (r.ok) { setPhase('sent'); onSent?.(); return; }
      let said = '';
      try { const j = (await r.json()) as { error?: unknown }; if (typeof j.error === 'string') said = j.error; } catch { /* no body */ }
      // 400 is something to fix in the form; anything else is on our side
      if (r.status === 400 && said) { setShown({ field: '', text: said }); setPhase('form'); return; }
      setPhase('failed');
    } catch {
      setPhase('failed');
    }
  };

  const err = (k: keyof QuoteFields): string | undefined => (shown?.field === k ? 'quote-error' : undefined);
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Request a quote" data-testid="lite-quote-form" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal quote-form">
        <div className="modal-head"><h2>{phase === 'sent' ? 'Thank you' : 'Request a quote'}</h2><button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={onClose} data-testid="lite-quote-form-close">×</button></div>
        {phase === 'sent' ? (
          <div className="modal-body" data-testid="lite-quote-sent">
            <p role="status">Your enquiry has been sent. We have your design: about {design.bottles} bottles{design.priceText ? `, guide price ${design.priceText}` : ''}. We will be in touch to talk it through and arrange a time to measure.</p>
            <p><button type="button" className="btn primary" onClick={onClose} data-testid="lite-quote-sent-close">Back to my design</button></p>
          </div>
        ) : (
          <form className="modal-body" onSubmit={(e) => void send(e)} noValidate data-testid="lite-quote-fields">
            <p className="lite-note">We will get a quote to you for exactly this design: about {design.bottles} bottles{design.priceText ? `, guide price ${design.priceText}` : ''}. Nothing is sent until you press Send. {note}</p>
            <label className="qf-row">Your name
              <input ref={first} title="Your name, so we know who to ask for." type="text" autoComplete="name" value={f.name} onChange={set('name')} maxLength={100} aria-invalid={shown?.field === 'name'} aria-describedby={err('name')} data-testid="lite-quote-name" />
            </label>
            <label className="qf-row">Email
              <input ref={refs.email} title="Your email address. We will send your quote here." type="email" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} maxLength={254} aria-invalid={shown?.field === 'email'} aria-describedby={err('email')} data-testid="lite-quote-email" />
            </label>
            <label className="qf-row">Phone <small>(optional)</small>
              <input ref={refs.phone} title="Your phone number, if you would like a call. You can leave this blank." type="tel" autoComplete="tel" inputMode="tel" value={f.phone} onChange={set('phone')} maxLength={24} aria-invalid={shown?.field === 'phone'} aria-describedby={err('phone')} data-testid="lite-quote-phone" />
            </label>
            <label className="qf-row">State or territory
              <select ref={refs.state} title="Where the cellar will be, so the right person gets back to you." value={f.state} onChange={set('state')} autoComplete="address-level1" aria-invalid={shown?.field === 'state'} aria-describedby={err('state')} data-testid="lite-quote-state">
                <option value="">Choose…</option>
                {AU_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </label>
            <label className="qf-row">Anything we should know <small>(optional)</small>
              <textarea ref={refs.message} title="Anything that helps us, such as the best time to call. You can leave this blank." rows={3} value={f.message} onChange={set('message')} maxLength={2000} data-testid="lite-quote-message" />
            </label>
            {/* a trap for automatic form fillers: people never see or reach it */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
              <label>Website<input title="Leave this empty" type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} /></label>
            </div>
            {shown?.text && <p id="quote-error" className="lite-note qf-error" role="alert" data-testid="lite-quote-error">{shown.text}</p>}
            {phase === 'failed' && (
              <p className="lite-note qf-error" role="alert" data-testid="lite-quote-failed">
                We could not send that just now, and nothing has been lost: your design is still here. Please press Send again in a moment{phone ? `, or call us on ${phone}` : ''}.
              </p>
            )}
            <div className="lite-nav two">
              <button type="button" className="btn lite-backbtn" title="Close this form without sending anything." onClick={onClose} data-testid="lite-quote-cancel">Cancel</button>
              <button type="submit" className="btn primary lite-next" title="Send your details and this design to us." aria-busy={phase === 'sending'} disabled={phase === 'sending'} data-testid="lite-quote-send">{phase === 'sending' ? 'Sending…' : 'Send my enquiry'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
