// Voice input for the planner apps (spec 0.2: a mic button on every text or number input). Built on the shared recognizer
// (`speechRecognizer.ts`, the same code Vault's `useVoice` uses): en-AU, interim results, a clear listening state, and a graceful
// fallback when the browser has no speech recognition (the button is shown disabled and typing keeps working).
//
// Styling is the host app's: classes `vi-wrap`, `vi-input`, `vi-mic`, `vi-mic-on`, `vi-hint`.
import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { createRecognizer, isSpeechRecognitionAvailable, type Recognizer } from './speechRecognizer';

/** Only one field listens at a time: starting another stops the first. */
let active: { stop(): void } | null = null;

export interface MicButtonProps {
  onInterim?(text: string): void;
  onFinal(text: string): void;
  /** Spoken to the user when nothing usable was heard. */
  onError?(message: string): void;
  label?: string;
  lang?: string;
  className?: string;
}

export function MicButton({ onInterim, onFinal, onError, label = 'Speak instead of typing', lang = 'en-AU', className = '' }: MicButtonProps) {
  const supported = isSpeechRecognitionAvailable();
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognizer | null>(null);
  const handlers = useRef({ onInterim, onFinal, onError });
  handlers.current = { onInterim, onFinal, onError };

  const self = useRef<{ stop(): void }>({ stop: () => { rec.current?.stop(); } });
  useEffect(() => () => { rec.current?.abort(); if (active === self.current) active = null; }, []);

  const start = (): void => {
    if (!supported) return;
    if (listening) { rec.current?.stop(); return; }
    active?.stop();
    const r = createRecognizer({ lang, continuous: false }, {
      onStart: () => setListening(true),
      onInterim: (t) => handlers.current.onInterim?.(t),
      onEnd: (finalText) => {
        setListening(false);
        if (active === self.current) active = null;
        if (finalText.trim()) handlers.current.onFinal(finalText.trim());
        else handlers.current.onError?.('No speech detected. Try again, or type instead.');
      },
      onError: (_code, message, finalText) => {
        setListening(false);
        if (active === self.current) active = null;
        if (finalText.trim()) handlers.current.onFinal(finalText.trim());
        else if (message) handlers.current.onError?.(message);
      },
    });
    if (!r) return;
    rec.current = r;
    active = self.current;
    try { r.start(); } catch (e) { setListening(false); handlers.current.onError?.(e instanceof Error ? e.message : 'Could not start the microphone.'); }
  };

  const tip = !supported
    ? "Voice input isn't available in this browser. Type instead (Chrome, Edge or Safari support it)."
    : listening ? 'Listening. Tap to stop.' : label;
  return (
    <button
      type="button" data-mic className={`vi-mic${listening ? ' vi-mic-on' : ''} ${className}`} title={tip} aria-label={label}
      aria-pressed={listening} aria-disabled={!supported} disabled={!supported} onClick={start}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v4" />
      </svg>
    </button>
  );
}

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

export interface VoiceInputProps extends Native {
  value: string;
  onChange(value: string): void;
  kind?: 'text' | 'number' | 'textarea';
  /** For `number`: turn what was said ("two point five") into a number, or null if it was not one. */
  parse?(spoken: string): number | null;
  /** Called with the new value once speech has finished and been applied: lets a form commit straight away instead of waiting for blur. */
  onSpoken?(value: string): void;
  /** For `textarea` / long text: add what was said to the end instead of replacing the value. */
  append?: boolean;
  rows?: number;
}

export function VoiceInput({ value, onChange, onSpoken, kind = 'text', parse, append = false, rows = 3, className = '', ...rest }: VoiceInputProps) {
  const [interim, setInterim] = useState('');
  const [hint, setHint] = useState('');
  const hintTimer = useRef<number | undefined>(undefined);
  const say = (m: string): void => { setHint(m); window.clearTimeout(hintTimer.current); hintTimer.current = window.setTimeout(() => setHint(''), 3500); };
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  const finish = (spoken: string): void => {
    setInterim('');
    if (kind === 'number') {
      const n = parse ? parse(spoken) : Number(spoken);
      if (n === null || !Number.isFinite(n)) { say(`Heard "${spoken}", which is not a number. Try again.`); return; }
      onChange(String(n));
      return;
    }
    const clean = spoken.replace(/[.!?]+$/, '');
    onChange(append && value ? `${value.replace(/\s+$/, '')} ${clean}` : clean);
  };

  const shown = interim && kind !== 'number' ? (append && value ? `${value} ${interim}` : interim) : value;
  return (
    <div className={`vi-wrap ${kind === 'textarea' ? 'vi-wrap-area' : ''}`}>
      {kind === 'textarea'
        ? <textarea {...(rest as object)} className={`vi-input ${className}`} rows={rows} value={shown} onChange={(e) => onChange(e.target.value)} />
        : <input {...rest} type={kind === 'number' ? 'number' : 'text'} inputMode={kind === 'number' ? 'decimal' : undefined} className={`vi-input ${className}`} value={shown} onChange={(e) => onChange(e.target.value)} />}
      <MicButton
        label={kind === 'number' ? 'Say a number' : 'Speak instead of typing'}
        onInterim={kind === 'number' ? undefined : setInterim}
        onFinal={finish}
        onError={(m) => { setInterim(''); say(m); }}
      />
      {hint && <p className="vi-hint" role="status">{hint}</p>}
    </div>
  );
}
