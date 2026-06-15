import { useState, useCallback, useRef, useEffect } from 'react';
import removeMd from 'remove-markdown';
import api from '../utils/apiClient';

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

const isLocalSTTAvailable = typeof window !== 'undefined' &&
  'MediaRecorder' in window &&
  !!navigator.mediaDevices?.getUserMedia;

const VOICE_STORAGE_KEY = 'vault:chat:selected-voice-uri';
const VOICE_SETTING_KEY = 'audio_voice_uri';

function speechErrorMessage(error) {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission is blocked for this browser or site.';
    case 'audio-capture':
      return 'No microphone was found. Check the Mac input device and browser permission.';
    case 'network':
      return 'Speech recognition service is unavailable. Check the browser network/service access.';
    case 'no-speech':
      return 'No speech detected. Try again after confirming the mic is selected and not held by another app.';
    case 'aborted':
      return '';
    default:
      return error ? `Speech recognition stopped: ${error}` : '';
  }
}

export function useVoice() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused,   setIsPaused]   = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURIState] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(VOICE_STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  });
  const recognitionRef = useRef(null);
  const accumulatedRef = useRef(''); // finals gathered across continuous utterances
  const mediaRecorderRef = useRef(null);
  const mediaChunksRef = useRef([]);
  const mediaStreamRef = useRef(null);
  const voiceModeRef = useRef('browser');
  const utteranceRef = useRef(null);

  const setSelectedVoiceURI = useCallback((voiceURI) => {
    const next = voiceURI || '';
    setSelectedVoiceURIState(next);
    try {
      if (next) window.localStorage.setItem(VOICE_STORAGE_KEY, next);
      else window.localStorage.removeItem(VOICE_STORAGE_KEY);
    } catch (_) {
      /* browser storage may be unavailable */
    }
    api.post('/api/settings', { key: VOICE_SETTING_KEY, value: next }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/settings')
      .then((res) => res.ok ? res.json() : null)
      .then((settings) => {
        if (cancelled || !settings?.[VOICE_SETTING_KEY]) return;
        const next = settings[VOICE_SETTING_KEY];
        setSelectedVoiceURIState(next);
        try {
          window.localStorage.setItem(VOICE_STORAGE_KEY, next);
        } catch (_) {
          /* browser storage may be unavailable */
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const transcribeLocalAudio = useCallback(async (blob) => {
    const formData = new FormData();
    formData.append('audio', blob, 'voice-input.webm');
    const res = await api.postForm('/api/local-audio/transcribe', formData);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Local transcription failed');
    return data.transcript || '';
  }, []);

  const stopLocalStream = useCallback(() => {
    mediaStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const startLocalListening = useCallback(async (reason = '') => {
    if (!isLocalSTTAvailable) {
      setVoiceError(reason || 'Local microphone recording is not available in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      mediaChunksRef.current = [];
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recorder.ondataavailable = (event) => {
        if (event.data?.size) mediaChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setVoiceError('Local microphone recording failed.');
        setIsListening(false);
        setIsTranscribing(false);
        stopLocalStream();
      };
      recorder.onstop = async () => {
        const chunks = mediaChunksRef.current;
        mediaChunksRef.current = [];
        setIsListening(false);
        if (!chunks.length) {
          setInterimText('');
          setVoiceError('No audio was recorded.');
          stopLocalStream();
          return;
        }

        try {
          setIsTranscribing(true);
          setInterimText('Transcribing locally...');
          const audioBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const text = await transcribeLocalAudio(audioBlob);
          if (text) {
            setTranscript(text);
            setVoiceError('');
          } else {
            setVoiceError('No speech detected in the recording.');
          }
        } catch (err) {
          setVoiceError(err.message || 'Local transcription failed.');
        } finally {
          setIsTranscribing(false);
          setInterimText('');
          stopLocalStream();
        }
      };

      mediaRecorderRef.current = recorder;
      voiceModeRef.current = 'local';
      setVoiceError(reason || '');
      setInterimText('Recording locally...');
      setIsListening(true);
      recorder.start();
    } catch (err) {
      setIsListening(false);
      setInterimText('');
      stopLocalStream();
      setVoiceError(err.message || 'Could not access the microphone for local recording.');
    }
  }, [stopLocalStream, transcribeLocalAudio]);

  useEffect(() => {
    if (!isSTTAvailable) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setVoiceError('');
      setIsListening(true);
    };

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
      if (voiceModeRef.current === 'local') return;
      // Commit whatever was accumulated when the session ends
      if (accumulatedRef.current) {
        setTranscript(accumulatedRef.current);
        accumulatedRef.current = '';
      }
      setIsListening(false);
      setInterimText('');
    };

    recognition.onerror = (e) => {
      const message = speechErrorMessage(e.error);
      const shouldUseLocalFallback = ['network', 'service-not-allowed'].includes(e.error);
      setVoiceError(shouldUseLocalFallback ? 'Browser speech service unavailable. Using local transcription instead.' : message);
      if (accumulatedRef.current) {
        setTranscript(accumulatedRef.current);
        accumulatedRef.current = '';
      }
      setIsListening(false);
      setInterimText('');
      if (shouldUseLocalFallback) {
        startLocalListening('Browser speech service unavailable. Recording locally instead.');
      }
    };

    recognitionRef.current = recognition;
    return () => recognition.abort();
  }, [startLocalListening]);

  const startListening = useCallback(() => {
    if (!isSTTAvailable || !recognitionRef.current) {
      startLocalListening();
      return;
    }
    voiceModeRef.current = 'browser';
    accumulatedRef.current = '';
    setTranscript('');
    setInterimText('');
    setVoiceError('');
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (err) {
      setIsListening(false);
      setVoiceError(err?.message || 'Could not start microphone listening.');
    }
  }, [startLocalListening]);

  const stopListening = useCallback(() => {
    if (voiceModeRef.current === 'local') {
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === 'recording') {
        recorder.stop();
      }
      return;
    }
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
    setVoiceError('');
  }, []);

  useEffect(() => {
    if (!isTTSAvailable) return undefined;

    const loadVoices = () => {
      setVoices(window.speechSynthesis.getVoices());
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      if (window.speechSynthesis.onvoiceschanged === loadVoices) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const speak = useCallback((text, speechId = null) => {
    if (!isTTSAvailable) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(stripForSpeech(text));
    const selectedVoice = voices.find((voice) => voice.voiceURI === selectedVoiceURI);
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utteranceRef.current = utterance;
    utterance.onstart = () => {
      setSpeakingId(speechId);
      setIsSpeaking(true);
      setIsPaused(false);
    };
    utterance.onend = () => {
      if (utteranceRef.current === utterance) utteranceRef.current = null;
      setSpeakingId(null);
      setIsSpeaking(false);
      setIsPaused(false);
    };
    utterance.onerror = () => {
      if (utteranceRef.current === utterance) utteranceRef.current = null;
      setSpeakingId(null);
      setIsSpeaking(false);
      setIsPaused(false);
    };
    window.speechSynthesis.speak(utterance);
  }, [selectedVoiceURI, voices]);

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
    utteranceRef.current = null;
    setSpeakingId(null);
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  return {
    isSTTAvailable,
    isLocalSTTAvailable,
    isTTSAvailable,
    isListening,
    transcript,
    interimText,
    voiceError,
    isTranscribing,
    isSpeaking,
    isPaused,
    speakingId,
    voices,
    selectedVoiceURI,
    setSelectedVoiceURI,
    startListening,
    stopListening,
    speak,
    pauseSpeaking,
    resumeSpeaking,
    stopSpeaking,
  };
}
