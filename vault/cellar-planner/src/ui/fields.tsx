import { createContext, useContext, useEffect, useState, type ReactNode, type Ref } from 'react';

// Small form controls. A number field keeps what is being typed until the person leaves it or presses Enter, then commits a whole number, or
// clears to blank (only where blank is allowed: a blank is "not set", never 0).

export function NumField({ label, value, onCommit, nullable = false, unit = 'mm', min = 0, hint, testid, estimated = false, calculated = false, placeholder }: {
  label: string; value: number | null | undefined; onCommit(v: number | null): void; nullable?: boolean; unit?: string; min?: number; hint?: string; testid?: string; estimated?: boolean;
  /** Blank, but the app has worked a value out (shown in the placeholder): not "not set". */
  calculated?: boolean; placeholder?: string;
}) {
  const shown = value === null || value === undefined ? '' : String(value);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(shown); setBad(false); }, [shown]);
  const commit = (): void => {
    const t = text.trim();
    if (t === '') { if (nullable) { setBad(false); if (value !== null && value !== undefined) onCommit(null); } else { setText(shown); } return; }
    const n = Number(t);
    if (!Number.isFinite(n) || n < min) { setBad(true); return; }
    setBad(false);
    const r = Math.round(n);
    // typing the very same number as an estimated guess still counts: it confirms the guess as the person's own value
    if (r !== value || estimated) onCommit(r);
    else setText(String(r));
  };
  const notSet = nullable && (value === null || value === undefined) && !calculated;
  return (
    <label className={`field${bad ? ' bad' : ''}`} title={hint}>
      <span className="field-label">{label}{notSet && <em className="notset"> not set</em>}{calculated && (value === null || value === undefined) && <em className="calculated" data-testid={testid ? `${testid}-calculated` : undefined}> calculated</em>}{estimated && !notSet && <em className="estimated" data-testid={testid ? `${testid}-estimated` : undefined}> estimated</em>}</span>
      <span className="field-input">
        <input type="text" inputMode="numeric" value={text} placeholder={placeholder ?? (nullable ? 'not set' : '')} aria-label={label} data-testid={testid}
          onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        {unit && <span className="unit">{unit}</span>}
      </span>
      {bad && <span className="field-err">Enter a whole number of {min} or more{nullable ? ', or leave blank' : ''}.</span>}
    </label>
  );
}

export function TextField({ label, value, onChange, hint, testid, type = 'text', inputRef }: { label: string; value: string; onChange(v: string): void; hint: string; testid?: string; type?: 'text' | 'date'; inputRef?: Ref<HTMLInputElement> }) {
  return (
    <label className="field" title={hint}>
      <span className="field-label">{label}</span>
      <input ref={inputRef} type={type} value={value} aria-label={label} data-testid={testid} maxLength={200} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, blank, testid, hint, estimated = false }: {
  label: string; value: T | null; options: Array<[T, string]>; onChange(v: T | null): void; blank?: string; testid?: string; hint?: string; estimated?: boolean;
}) {
  return (
    <label className="field" title={hint}>
      <span className="field-label">{label}{value === null && blank && <em className="notset"> not set</em>}{estimated && value !== null && <em className="estimated" data-testid={testid ? `${testid}-estimated` : undefined}> estimated</em>}</span>
      <select value={value ?? ''} aria-label={label} data-testid={testid} onChange={(e) => onChange((e.target.value || null) as T | null)}>
        {blank !== undefined && <option value="">{blank}</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export function CheckField({ label, checked, onChange, testid, hint }: { label: string; checked: boolean; onChange(v: boolean): void; testid?: string; hint?: string }) {
  return (
    <label className="field check" title={hint}>
      <input type="checkbox" checked={checked} data-testid={testid} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Inside an Accordion only one Section is open at a time (keyed by title); outside one, each Section toggles on its own. */
const AccordionContext = createContext<{ openId: string | null; setOpenId(id: string | null): void } | null>(null);

export function Accordion({ children, initial = null }: { children: ReactNode; initial?: string | null }) {
  const [openId, setOpenId] = useState<string | null>(initial);
  return <AccordionContext.Provider value={{ openId, setOpenId }}>{children}</AccordionContext.Provider>;
}

export function Section({ title, children, note, testid, tour }: { title: string; children: ReactNode; note?: ReactNode; testid?: string; tour?: string }) {
  // Collapsible. Content stays mounted while closed so half-typed values survive.
  const acc = useContext(AccordionContext);
  const [ownOpen, setOwnOpen] = useState(true);
  const open = acc ? acc.openId === title : ownOpen;
  const setOpen = (fn: (o: boolean) => boolean): void => { if (acc) acc.setOpenId(fn(open) ? title : null); else setOwnOpen(fn); };
  return (
    <section className={`section${open ? '' : ' collapsed'}`} data-testid={testid} data-tour={tour}>
      <h2>
        <button type="button" className="section-toggle" aria-expanded={open} title={open ? `Hide ${title}` : `Show ${title}`} data-testid={testid ? `${testid}-toggle` : undefined} onClick={() => setOpen((o) => !o)}>
          <span className="chev" aria-hidden="true">▸</span>{title}
        </button>
      </h2>
      <div className="section-collapse" inert={!open} aria-hidden={!open}>
        <div className="section-inner">
          {note}
          <div className="grid">{children}</div>
        </div>
      </div>
    </section>
  );
}
