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
  const voice = useVoice({ lang, continuous: false });
  const activeRef = useRef(null); // { id, onInterim, onFinal }
  const [activeId, setActiveId] = useState(null);
  const [error, setError] = useState({ id: null, message: '' });
  const supported = voice.isSTTAvailable || voice.isLocalSTTAvailable;

  useEffect(() => {
    if (activeRef.current && voice.isListening && voice.interimText) activeRef.current.onInterim?.(voice.interimText);
  }, [voice.interimText, voice.isListening]);

  useEffect(() => {
    if (!voice.transcript || !activeRef.current) return;
    const a = activeRef.current;
    activeRef.current = null;
    setActiveId(null);
    setError({ id: null, message: '' });
    a.onFinal?.(voice.transcript);
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
    voice.stopListening();
  }, [voice]);

  const toggle = useCallback((id, handlers) => {
    if (!supported) return;
    if (activeRef.current && activeRef.current.id === id) { stop(); return; }
    if (activeRef.current) { activeRef.current.onCancel?.(); voice.stopListening(); }
    activeRef.current = { id, ...handlers };
    setActiveId(id);
    setError({ id: null, message: '' });
    voice.clearVoiceError?.();
    voice.startListening();
  }, [stop, supported, voice]);

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
export function MicButton({ onStart, onInterim, onFinal, onCancel, label = 'Speak instead of typing', size = 15, className = '', style }) {
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
    ctx.toggle(id, { onInterim, onFinal, onCancel });
  };

  const tip = !supported
    ? "Voice input isn't available in this browser. Type instead (Chrome, Edge or Safari support it)."
    : listening ? 'Listening — click to stop' : label;

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
  value, onChange, placeholder = '', type = 'text', parse, onSpoken, append = false, rows = 3,
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
            onStart={(id) => { idRef.current = id; baseRef.current = value || ''; }}
            onInterim={(text) => { if (parse) { const p = parse(text); if (p !== null && p !== undefined) onChange(compose(text)); } else onChange(compose(text)); }}
            onFinal={(text) => {
              if (onSpoken && onSpoken(text) === true) { onChange(baseRef.current); return; }
              onChange(compose(text));
            }}
            onCancel={() => { onChange(baseRef.current); }}
          />
        </div>
      )}
      {showErr && <p className="text-[11px] mt-1" style={{ color: '#b45309' }} role="status">{ctx.error.message}</p>}
    </div>
  );
}
