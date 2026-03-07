import { useState, useCallback, useRef, useEffect } from 'react';

const isSTTAvailable = typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

const isTTSAvailable = typeof window !== 'undefined' &&
  'speechSynthesis' in window;

export function useVoice() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (!isSTTAvailable) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (e) => {
      let interim = '';
      let final = '';
      for (const result of Array.from(e.results)) {
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      // Show live preview; only commit to transcript when browser confirms final
      setInterimText(interim || final);
      if (final) setTranscript(final);
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText('');
    };

    recognition.onerror = () => {
      setIsListening(false);
      setInterimText('');
    };

    recognitionRef.current = recognition;
    return () => recognition.abort();
  }, []);

  const startListening = useCallback(() => {
    if (!isSTTAvailable || !recognitionRef.current) return;
    setTranscript('');
    setInterimText('');
    setIsListening(true);
    recognitionRef.current.start();
  }, []);

  const stopListening = useCallback(() => {
    if (!isSTTAvailable || !recognitionRef.current) return;
    recognitionRef.current.stop();
    setIsListening(false);
    setInterimText('');
  }, []);

  const speak = useCallback((text) => {
    if (!isTTSAvailable) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (!isTTSAvailable) return;
    window.speechSynthesis.cancel();
  }, []);

  return {
    isSTTAvailable,
    isTTSAvailable,
    isListening,
    transcript,
    interimText,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
