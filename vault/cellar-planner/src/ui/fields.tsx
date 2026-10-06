import { useEffect, useState, type ReactNode } from 'react';

// Small form controls. A number field keeps what is being typed until the person leaves it or presses Enter, then commits a whole number, or
// clears to blank (only where blank is allowed: a blank is "not set", never 0).

export function NumField({ label, value, onCommit, nullable = false, unit = 'mm', min = 0, hint, testid }: {
  label: string; value: number | null | undefined; onCommit(v: number | null): void; nullable?: boolean; unit?: string; min?: number; hint?: string; testid?: string;
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
    if (r !== value) onCommit(r);
    else setText(String(r));
  };
  const notSet = nullable && (value === null || value === undefined);
  return (
    <label className={`field${bad ? ' bad' : ''}`} title={hint}>
      <span className="field-label">{label}{notSet && <em className="notset"> not set</em>}</span>
      <span className="field-input">
        <input type="text" inputMode="numeric" value={text} placeholder={nullable ? 'not set' : ''} aria-label={label} data-testid={testid}
          onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        {unit && <span className="unit">{unit}</span>}
      </span>
      {bad && <span className="field-err">Enter a whole number of {min} or more{nullable ? ', or leave blank' : ''}.</span>}
    </label>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, blank, testid, hint }: {
  label: string; value: T | null; options: Array<[T, string]>; onChange(v: T | null): void; blank?: string; testid?: string; hint?: string;
}) {
  return (
    <label className="field" title={hint}>
      <span className="field-label">{label}{value === null && blank && <em className="notset"> not set</em>}</span>
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

export function Section({ title, children, note, testid, tour }: { title: string; children: ReactNode; note?: ReactNode; testid?: string; tour?: string }) {
  return (
    <section className="section" data-testid={testid} data-tour={tour}>
      <h2>{title}</h2>
      {note}
      <div className="grid">{children}</div>
    </section>
  );
}
