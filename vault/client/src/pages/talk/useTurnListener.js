import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Listens for ONE spoken turn: start it, the person talks, and when they pause the browser ends the session and `onUtterance(text)` is called with
 * what was said. (A different shape from Notes' Dictate, which keeps listening until told to stop and hands over everything at the end.)
 *   listen()   start listening        stop()   stop now and use what was heard so far        abort()   stop and throw away what was heard
 * `interim` is the words so far, shown while talking. On an iPhone the browser never marks a result final, so the last partial text is used.
 */
export default function useTurnListener({ onUtterance }) {
  const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const supported = !!SR;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const recRef = useRef(null);
  const discardRef = useRef(false);
  const onRef = useRef(onUtterance);
  useEffect(() => { onRef.current = onUtterance; }, [onUtterance]);

  const listen = useCallback(() => {
    if (!SR || recRef.current) return;
    setError('');
    setInterim('');
    discardRef.current = false;
    const rec = new SR();
    rec.lang = navigator.language || 'en-AU';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let final = '';
    let partial = '';
    rec.onresult = (event) => {
      final = '';
      partial = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
        else partial += event.results[i][0].transcript;
      }
      setInterim(final || partial);
    };
    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return; // silence: it simply ends below
      discardRef.current = true;
      setError(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'The microphone is blocked. Allow it for this site in your browser, then tap the button again.'
        : `The microphone stopped (${event.error}). Tap the button to try again.`);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim('');
      const text = (final || partial).trim();
      if (text && !discardRef.current) onRef.current?.(text);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setListening(false);
    }
  }, [SR]);

  const stop = useCallback(() => { try { recRef.current?.stop(); } catch { /* already stopped */ } }, []);
  const abort = useCallback(() => { discardRef.current = true; try { recRef.current?.abort(); } catch { /* already stopped */ } }, []);

  useEffect(() => () => { discardRef.current = true; try { recRef.current?.abort(); } catch { /* gone */ } }, []);

  return { supported, listening, interim, error, listen, stop, abort };
}
