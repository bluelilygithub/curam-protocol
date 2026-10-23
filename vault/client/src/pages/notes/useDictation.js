import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Browser speech recognition that keeps listening until stopped, then hands the whole transcript to `onText(text, startedWith)`.
 * `startedWith` is whatever `start(context)` was given (the note's id), so the words go to the note they were spoken into even if
 * another note has been opened since. Shared by the desktop toolbar mic and the phone Dictate button.
 */
export default function useDictation({ onText }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');

  const recognitionRef = useRef(null);
  const listeningRef = useRef(false); // ref so the recognition callbacks never read a stale value
  const transcriptRef = useRef('');
  const contextRef = useRef(null);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; }, [onText]);

  useEffect(() => { setSupported(!!(window.SpeechRecognition || window.webkitSpeechRecognition)); }, []);

  const stop = useCallback(() => {
    if (!listeningRef.current) return;
    listeningRef.current = false;
    recognitionRef.current?.abort();
  }, []);

  const start = useCallback((context) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || listeningRef.current) return;
    setError('');
    transcriptRef.current = '';
    contextRef.current = context;
    listeningRef.current = true;
    setListening(true);
    setInterim('');

    const session = () => {
      if (!listeningRef.current) return;
      const recognition = new SR();
      recognition.continuous = false;
      recognition.interimResults = true; // iOS Safari never marks a result final, so without this it returns nothing
      recognition.maxAlternatives = 1;
      recognition.lang = navigator.language || 'en';

      let final = '';
      let partial = '';
      recognition.onresult = (event) => {
        final = '';
        partial = '';
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) final += event.results[i][0].transcript;
          else partial += event.results[i][0].transcript;
        }
        setInterim(final || partial);
      };
      recognition.onend = () => {
        setInterim('');
        const text = (final || partial).trim(); // iOS often never sets isFinal: fall back to the partial text
        if (text) transcriptRef.current += `${text} `;
        if (listeningRef.current) { setTimeout(session, 80); return; }
        setListening(false);
        const transcript = transcriptRef.current.trim();
        transcriptRef.current = '';
        if (transcript) onTextRef.current?.(transcript, contextRef.current);
      };
      recognition.onerror = (event) => {
        setInterim('');
        if (event.error === 'no-speech' || event.error === 'aborted') {
          if (listeningRef.current) setTimeout(session, 80);
          return;
        }
        listeningRef.current = false;
        setListening(false);
        transcriptRef.current = '';
        setError(event.error === 'not-allowed' ? 'Microphone permission denied' : `Mic error: ${event.error}`);
      };
      recognitionRef.current = recognition;
      try { recognition.start(); } catch { /* already starting */ }
    };
    session();
  }, []);

  useEffect(() => () => { listeningRef.current = false; recognitionRef.current?.abort(); }, []);

  return { supported, listening, interim, error, start, stop };
}
