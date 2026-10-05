// Form controls for the Inspector and the wizard. Every text and number input has a mic button (spec 0.2). Edits commit when the field
// loses focus, on Enter, or when speech finishes, so typing "12" is one undo step, not two.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { VoiceInput } from '@planner-core/speech/VoiceInput';
import { parseSpokenNumber } from '@vault-client/utils/units/numbers.mjs';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function TextField({ label, value, onCommit, placeholder, hint }: { label: string; value: string; onCommit(v: string): void; placeholder?: string; hint?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const done = (v: string): void => { if (v.trim() !== value) onCommit(v.trim()); };
  return (
    <Field label={label} hint={hint}>
      <VoiceInput
        value={text} placeholder={placeholder} aria-label={label}
        onChange={(v) => { setText(v); }} onSpoken={done}
        onBlur={() => done(text)}
        onKeyDown={(e) => { if (e.key === 'Enter') { done(text); (e.target as HTMLInputElement).blur(); } }}
      />
    </Field>
  );
}

export interface NumFieldProps { label: string; value: number; onCommit(v: number): void; min?: number; max?: number; step?: number; unit?: string; hint?: string; decimals?: number }

export function NumField({ label, value, onCommit, min, max, step = 0.1, unit, hint, decimals = 2 }: NumFieldProps) {
  const fmt = (n: number): string => String(Number(n.toFixed(decimals)));
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (raw: string): void => {
    const n = Number(raw);
    if (!Number.isFinite(n) || raw.trim() === '') { setText(fmt(value)); return; }
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    setText(fmt(c));
    if (c !== value) onCommit(c);
  };
  return (
    <Field label={unit ? `${label} (${unit})` : label} hint={hint}>
      <VoiceInput
        kind="number" value={text} step={step} min={min} max={max} aria-label={label}
        parse={parseSpokenNumber}
        onChange={(v) => { setText(v); }} onSpoken={done}
        onBlur={() => done(text)}
        onKeyDown={(e) => { if (e.key === 'Enter') { done(text); (e.target as HTMLInputElement).blur(); } }}
      />
    </Field>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, hint }: { label: string; value: T; options: ReadonlyArray<readonly [T, string]>; onChange(v: T): void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <select className="vi-input" value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
  );
}

export function CheckField({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(v: boolean): void; hint?: string }) {
  const id = useId();
  return (
    <div className="check">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export const labelOf = (s: string): string => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const optionsOf = <T extends string>(list: readonly T[]): Array<readonly [T, string]> => list.map((v) => [v, labelOf(v)] as const);
