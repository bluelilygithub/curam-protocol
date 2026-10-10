import type { ReactNode } from 'react';

// Small building blocks for the planner's panel. Plain buttons, real radio-group semantics, a tooltip (title) on everything.

export interface SegOption<T extends string> { value: T; label: ReactNode; title: string; testid?: string }

/** A row of choices where exactly one is on (a radio group drawn as joined buttons). */
export function Segmented<T extends string>({ label, value, options, onChange, testid, className = '' }: { label: string; value: T; options: SegOption<T>[]; onChange(v: T): void; testid?: string; className?: string }) {
  return (
    <div className={`seg ${className}`} role="radiogroup" aria-label={label} data-testid={testid}>
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className={`seg-btn${value === o.value ? ' on' : ''}`} onClick={() => onChange(o.value)} title={o.title} data-testid={o.testid}>{o.label}</button>
      ))}
    </div>
  );
}

/** A size box with minus and plus buttons either side, the unit after it, and the allowed range if the typed value is outside it. */
export function LengthField({ label, hint, value, suffix, placeholder, error, onType, onBlur, onStep, testid }: {
  label: string; hint: string; value: string; suffix: string; placeholder: string; error: string; onType(text: string): void; onBlur(): void; onStep(dir: -1 | 1): void; testid: string;
}) {
  const id = `${testid}-box`;
  return (
    <div className="lenfield">
      <label htmlFor={id} className="lenfield-label">{label}</label>
      <span className="lenfield-box">
        <button type="button" className="lenfield-step" onClick={() => onStep(-1)} aria-label={`Smaller ${label.toLowerCase()}`} title={`Make the ${label.toLowerCase()} a little smaller.`} data-testid={`${testid}-minus`}>−</button>
        <input id={id} type="text" inputMode="decimal" value={value} onChange={(ev) => onType(ev.target.value)} onBlur={onBlur} title={hint} placeholder={placeholder} aria-describedby={error ? `${id}-err` : undefined} data-testid={testid} />
        <button type="button" className="lenfield-step" onClick={() => onStep(1)} aria-label={`Bigger ${label.toLowerCase()}`} title={`Make the ${label.toLowerCase()} a little bigger.`} data-testid={`${testid}-plus`}>+</button>
      </span>
      <span className="lenfield-unit">{suffix}</span>
      {error && <span className="field-err lenfield-err" id={`${id}-err`} role="alert">{error}</span>}
    </div>
  );
}

/** The three-step strip: tap a step to go to it. */
export function Stepper({ step, steps, onGo }: { step: number; steps: string[]; onGo(n: number): void }) {
  return (
    <ol className="stepper" aria-label="Steps" data-testid="lite-stepper">
      {steps.map((name, i) => {
        const n = i + 1;
        return (
          <li key={name} className={`stepper-item${n === step ? ' on' : ''}${n < step ? ' done' : ''}`}>
            <button type="button" className="stepper-btn" aria-current={n === step ? 'step' : undefined} onClick={() => onGo(n)} title={`Go to step ${n}: ${name}.`} data-testid={`lite-step-${n}`}>
              <span className="stepper-num">{n}</span>
              <span className="stepper-name">{name}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
