import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useVoice } from '../../hooks/useVoice';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../Tooltip';

/**
 * Microphone input for any field. One shared `useVoice()` (Vault's existing speech module) sits in a
 * provider so a page with dozens of fields still has a single recogniser; only one field listens at a time.
 *
 *   <VoiceInputProvider lang="en-AU">…</VoiceInputProvider>
 *   <VoiceInput value onChange placeholder parse />        — text/number/textarea with a mic built in
 *   <MicButton onFinal={(text) => …} onInterim={…} />      — the bare button, for custom controls
 *
 * Unsupported browsers: the button is shown disabled with an explanation; typing always keeps working.
 */
const MicContext = createContext(null);

export function VoiceInputProvider({ children, lang = 'en-AU' }) {
  // Two recognisers, one per style of field. "short" ends by itself when you pause (right for a name or a number);
  // "long" keeps listening until you press the mic again (right for dictating a sentence or a paragraph, like the chat boxes).
  const shortVoice = useVoice({ lang, continuous: false });
  const longVoice = useVoice({ lang, continuous: true });
  const [mode, setMode] = useState('short');
  const voice = mode === 'long' ? longVoice : shortVoice;
  const stoppingRef = useRef(false); // true once the person has pressed stop (so a session that ends is not restarted)
  const activeRef = useRef(null); // { id, onInterim, onFinal, continuous, keepAlive }
  const [activeId, setActiveId] = useState(null);
  const [error, setError] = useState({ id: null, message: '' });
  const supported = shortVoice.isSTTAvailable || shortVoice.isLocalSTTAvailable;

  useEffect(() => {
    if (activeRef.current && voice.isListening && voice.interimText) activeRef.current.onInterim?.(voice.interimText);
  }, [voice.interimText, voice.isListening]);

  useEffect(() => {
    if (!voice.transcript || !activeRef.current) return;
    const a = activeRef.current;
    // Browsers end even a "continuous" session by themselves now and then (after a long pause, or about a minute in). For a long
    // field that is not what the person asked for, so keep going until they press stop; the words so far are already in the box.
    const carryOn = mode === 'long' && a.keepAlive && !stoppingRef.current;
    if (!carryOn) {
      activeRef.current = null;
      setActiveId(null);
    }
    setError({ id: null, message: '' });
    a.onFinal?.(voice.transcript);
    if (carryOn) {
      setTimeout(() => {
        if (activeRef.current === a && !stoppingRef.current) voice.startListening();
      }, 150);
    }
  }, [voice.transcript]);

  useEffect(() => {
    if (!voice.voiceError || !activeRef.current) return;
    setError({ id: activeRef.current.id, message: voice.voiceError });
  }, [voice.voiceError]);

  // Listening ended with nothing heard: clear the active state after a beat (the transcript arrives in the same tick otherwise).
  useEffect(() => {
    if (voice.isListening || voice.isTranscribing || !activeRef.current) return undefined;
    const t = setTimeout(() => {
      if (activeRef.current && !voice.isListening) {
        const id = activeRef.current.id;
        activeRef.current.onCancel?.();
        activeRef.current = null;
        setActiveId(null);
        setError((e) => (e.id === id && e.message ? e : { id, message: 'No speech detected. Try again, or type instead.' }));
      }
    }, 450);
    return () => clearTimeout(t);
  }, [voice.isListening, voice.isTranscribing]);

  const stop = useCallback(() => {
    stoppingRef.current = true;
    voice.stopListening();
  }, [voice]);

  const toggle = useCallback((id, handlers) => {
    if (!supported) return;
    if (activeRef.current && activeRef.current.id === id) { stop(); return; }
    if (activeRef.current) { stoppingRef.current = true; activeRef.current.onCancel?.(); voice.stopListening(); }
    const next = handlers.continuous ? longVoice : shortVoice;
    activeRef.current = { id, ...handlers };
    stoppingRef.current = false;
    setMode(handlers.continuous ? 'long' : 'short');
    setActiveId(id);
    setError({ id: null, message: '' });
    next.clearVoiceError?.();
    next.startListening();
  }, [stop, supported, voice, longVoice, shortVoice]);

  const value = useMemo(() => ({
    supported,
    activeId,
    transcribing: voice.isTranscribing,
    error,
    toggle,
    stop,
  }), [supported, activeId, voice.isTranscribing, error, toggle, stop]);

  return <MicContext.Provider value={value}>{children}</MicContext.Provider>;
}

export function useMic() {
  return useContext(MicContext);
}

/** The mic button. Red + pulsing while listening; click again to stop. */
export function MicButton({ onStart, onInterim, onFinal, onCancel, continuous = false, keepAlive = false, label = 'Speak instead of typing', size = 15, className = '', style }) {
  const getIcon = useIcon();
  const ctx = useMic();
  const id = useId();
  const supported = !!ctx?.supported;
  const listening = ctx?.activeId === id;
  const busy = listening && ctx?.transcribing;

  const onClick = (e) => {
    e.preventDefault();
    if (!supported) return;
    if (!listening) onStart?.(id);
    ctx.toggle(id, { onInterim, onFinal, onCancel, continuous, keepAlive });
  };

  const tip = !supported
    ? "Voice input isn't available in this browser. Type instead (Chrome, Edge or Safari support it)."
    : listening ? (continuous ? 'Listening — click to stop (it keeps listening while you pause)' : 'Listening — click to stop') : label;

  return (
    <Tooltip text={tip}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={listening}
        aria-disabled={!supported}
        data-mic
        className={`flex-shrink-0 inline-flex items-center justify-center rounded-lg transition-all duration-200 ${supported ? 'hover:opacity-60' : 'opacity-40 cursor-not-allowed'} ${listening ? 'animate-pulse' : ''} ${className}`}
        style={{
          width: 28, height: 28,
          color: listening ? '#fff' : 'var(--color-muted)',
          background: listening ? '#ef4444' : 'transparent',
          ...style,
        }}
      >
        {getIcon(supported ? 'mic' : 'mic-off', { size })}
        {busy && <span className="sr-only">Transcribing…</span>}
      </button>
    </Tooltip>
  );
}

const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

/**
 * Text / number / textarea with a built-in mic.
 *  - `parse(text)` optionally turns what was heard into the field's value (return null/undefined to keep the raw text);
 *    used for "twenty three point five" → "23.5" and spoken unit names.
 *  - `onSpoken(text)` receives the raw final transcript (for whole-command handling) and may return true to
 *    say it consumed it, in which case the field value is left alone.
 *  - `append` adds speech after the existing text (long fields) instead of replacing it.
 */
export function VoiceInput({
  value, onChange, placeholder = '', type = 'text', parse, onSpoken, append = false, continuous, rows = 3,
  className = '', style, inputRef, label, onKeyDown, onFocus, onBlur, disabled = false, id: idProp, mic = true, ...rest
}) {
  const ctx = useMic();
  const autoId = useId();
  const fieldId = idProp || autoId;
  const baseRef = useRef('');
  const idRef = useRef(null);
  const listening = !!ctx && ctx.activeId !== null && ctx.activeId === idRef.current;
  const textarea = type === 'textarea';
  const Tag = textarea ? 'textarea' : 'input';
  // Multi-line boxes are for dictating, so they keep listening until you press the mic again (set `continuous` to override).
  // Single-line fields (a name, a number) stop by themselves when you pause.
  const keepListening = continuous ?? (textarea && append);

  const compose = (text) => {
    const parsed = parse ? parse(text) : null;
    const spoken = parsed !== null && parsed !== undefined ? String(parsed) : text;
    return append && baseRef.current ? `${baseRef.current.replace(/\s+$/, '')} ${spoken}` : spoken;
  };

  const showErr = ctx?.error?.message && ctx.error.id === idRef.current;

  return (
    <div className="relative w-full">
      <Tag
        id={fieldId}
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        disabled={disabled}
        placeholder={listening ? 'Listening…' : placeholder}
        aria-label={label || placeholder}
        inputMode={type === 'number' ? 'decimal' : undefined}
        rows={textarea ? rows : undefined}
        autoComplete="off"
        className={`w-full ${mic ? 'pr-10' : ''} px-3 py-2.5 rounded-xl border text-sm outline-none transition-all duration-200 focus:border-[var(--color-primary)] ${className}`}
        style={{ ...FIELD_STYLE, ...style }}
        {...rest}
      />
      {mic && (
        <div className={`absolute right-1.5 ${textarea ? 'top-1.5' : 'top-1/2 -translate-y-1/2'}`}>
          <MicButton
            label={`Speak into ${label || placeholder || 'this field'}`}
            continuous={keepListening}
            keepAlive={keepListening && append}
            onStart={(id) => { idRef.current = id; baseRef.current = value || ''; }}
            onInterim={(text) => { if (parse) { const p = parse(text); if (p !== null && p !== undefined) onChange(compose(text)); } else onChange(compose(text)); }}
            onFinal={(text) => {
              if (onSpoken && onSpoken(text) === true) { onChange(baseRef.current); return; }
              const composed = compose(text);
              // If listening carries on after this piece, the next piece is added after it.
              if (append) baseRef.current = composed;
              onChange(composed);
            }}
            onCancel={() => { onChange(baseRef.current); }}
          />
        </div>
      )}
      {showErr && <p className="text-[11px] mt-1" style={{ color: '#b45309' }} role="status">{ctx.error.message}</p>}
    </div>
  );
}
