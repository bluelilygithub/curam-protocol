import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MicButton } from '@planner-core/speech/VoiceInput';

/**
 * The microphone for a text field, the same one every other Vault planner uses (planner-core speech: en-AU, words appear as they are heard,
 * one field listens at a time, a disabled button with an explanation when the browser has no speech recognition). It sits inside a
 * `.vwrap` next to the input.
 *
 * `onText` gets the words as they are being heard (so the field can show them live); `onDone` gets the final words. `onDone` may return a
 * sentence to show under the field instead (for example "Heard 'blue', which is not a number").
 */
export function Mic({ onText, onDone, label = 'Speak instead of typing', area = false }: { onText?(text: string): void; onDone(text: string): string | void; label?: string; area?: boolean }) {
  const [hint, setHint] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const say = (m: string): void => { setHint(m); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setHint(''), 4000); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <>
      <MicButton
        label={label} className={area ? 'vi-mic-area' : ''}
        onInterim={onText}
        onFinal={(t) => { const problem = onDone(t); if (typeof problem === 'string' && problem) say(problem); }}
        onError={(m) => say(m)}
      />
      {hint && <span className="vi-hint" role="status">{hint}</span>}
    </>
  );
}

/**
 * A labelled field whose label is tied to the input by id. The microphone sits beside the input, OUTSIDE the label, so it never becomes part
 * of the field's name for a screen reader (a button inside a <label> is read as part of it).
 */
export function Field({ label, className = '', children }: { label: ReactNode; className?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return <div className={`lbl ${className}`}><label htmlFor={id}>{label}</label>{children(id)}</div>;
}
