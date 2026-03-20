import { useState, useCallback, useRef, useEffect } from 'react';
import removeMd from 'remove-markdown';

function stripForSpeech(text) {
  if (!text) return '';
  // 1. Fenced code blocks — replace with a brief spoken marker
  let out = text.replace(/```[\s\S]*?```/g, ' code block. ');
  // 2. Inline code — strip backticks, keep the inner text
  out = out.replace(/`([^`]*)`/g, '$1');
  // 3. URLs (http/https/ftp, bare www., or markdown link hrefs) — remove entirely
  out = out.replace(/https?:\/\/\S+/gi, '');
  out = out.replace(/ftp:\/\/\S+/gi, '');
  out = out.replace(/www\.\S+/gi, '');
  // 4. HTML tags — strip completely
  out = out.replace(/<[^>]+>/g, '');
  // 5. remove-markdown handles headings, bold, italic, blockquotes, lists, etc.
  out = removeMd(out);
  // 6. Collapse excess whitespace left by removals
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

const isSTTAvailable = typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

const isTTSAvailable = typeof window !== 'undefined' &&
  'speechSynthesis' in window;

export function useVoice() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused,   setIsPaused]   = useState(false);
  const recognitionRef = useRef(null);
  const accumulatedRef = useRef(''); // finals gathered across continuous utterances

  useEffect(() => {
    if (!isSTTAvailable) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (e) => {
      let interim = '';
      // Only process new results from resultIndex onwards
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          accumulatedRef.current += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      // Show accumulated finals + current in-progress utterance
      setInterimText((accumulatedRef.current + (interim ? ' ' + interim : '')).trim());
    };

    recognition.onend = () => {
      // Commit whatever was accumulated when the session ends
      if (accumulatedRef.current) {
        setTranscript(accumulatedRef.current);
        accumulatedRef.current = '';
      }
      setIsListening(false);
      setInterimText('');
    };

    recognition.onerror = (e) => {
      // 'no-speech' is benign in continuous mode — ignore it
      if (e.error === 'no-speech') return;
      if (accumulatedRef.current) {
        setTranscript(accumulatedRef.current);
        accumulatedRef.current = '';
      }
      setIsListening(false);
      setInterimText('');
    };

    recognitionRef.current = recognition;
    return () => recognition.abort();
  }, []);

  const startListening = useCallback(() => {
    if (!isSTTAvailable || !recognitionRef.current) return;
    accumulatedRef.current = '';
    setTranscript('');
    setInterimText('');
    setIsListening(true);
    recognitionRef.current.start();
  }, []);

  const stopListening = useCallback(() => {
    if (!isSTTAvailable || !recognitionRef.current) return;
    // Commit accumulated text before stopping — onend will also fire but
    // accumulatedRef will be empty by then so it won't double-append
    if (accumulatedRef.current) {
      setTranscript(accumulatedRef.current);
      accumulatedRef.current = '';
    }
    recognitionRef.current.stop();
    setIsListening(false);
    setInterimText('');
  }, []);

  const speak = useCallback((text) => {
    if (!isTTSAvailable) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(stripForSpeech(text));
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onstart = () => { setIsSpeaking(true); setIsPaused(false); };
    utterance.onend   = () => { setIsSpeaking(false); setIsPaused(false); };
    utterance.onerror = () => { setIsSpeaking(false); setIsPaused(false); };
    window.speechSynthesis.speak(utterance);
  }, []);

  const pauseSpeaking = useCallback(() => {
    if (!isTTSAvailable) return;
    window.speechSynthesis.pause();
    setIsPaused(true);
  }, []);

  const resumeSpeaking = useCallback(() => {
    if (!isTTSAvailable) return;
    window.speechSynthesis.resume();
    setIsPaused(false);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (!isTTSAvailable) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  return {
    isSTTAvailable,
    isTTSAvailable,
    isListening,
    transcript,
    interimText,
    isSpeaking,
    isPaused,
    startListening,
    stopListening,
    speak,
    pauseSpeaking,
    resumeSpeaking,
    stopSpeaking,
  };
}
