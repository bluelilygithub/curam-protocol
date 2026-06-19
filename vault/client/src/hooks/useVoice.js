import { useState, useCallback, useRef, useEffect } from 'react';
import removeMd from 'remove-markdown';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';

export const LOCAL_CLONE_VOICE_URI = 'vault:local-clone-voice';
export const LOCAL_CLONE_VOICE_LABEL = 'My voice (local clone)';

function stripForSpeech(text) {
  if (!text) return '';
  let out = text.replace(/```[\s\S]*?```/g, ' code block. ');
  out = out.replace(/`([^`]*)`/g, '$1');
  out = out.replace(/https?:\/\/\S+/gi, '');
  out = out.replace(/ftp:\/\/\S+/gi, '');
  out = out.replace(/www\.\S+/gi, '');
  out = out.replace(/<[^>]+>/g, '');
  out = removeMd(out);
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

const isSTTAvailable = typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

const isBrowserTTSAvailable = typeof window !== 'undefined' &&
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
  const [isPaused, setIsPaused] = useState(false);
  const [isGeneratingSpeech, setIsGeneratingSpeech] = useState(false);
  const [speechStatus, setSpeechStatus] = useState('');
  const [speakingId, setSpeakingId] = useState(null);
  const [voices, setVoices] = useState([]);
  const [localCloneConfigured, setLocalCloneConfigured] = useState(false);
  const [localVoiceAvailable, setLocalVoiceAvailable] = useState(false);
  const [selectedVoiceURI, setSelectedVoiceURIState] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(VOICE_STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  });
  const recognitionRef = useRef(null);
  const accumulatedRef = useRef('');
  const mediaRecorderRef = useRef(null);
  const mediaChunksRef = useRef([]);
  const mediaStreamRef = useRef(null);
  const voiceModeRef = useRef('browser');
  const utteranceRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef('');
  const speakAbortRef = useRef(null);
  const audioUnlockRef = useRef(null);

  const unlockAudioPlayback = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!audioUnlockRef.current) {
      const audio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
      audio.volume = 0.001;
      audioUnlockRef.current = audio;
    }
    audioUnlockRef.current.play().catch(() => {});
  }, []);

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

  const clearGeneratedAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = '';
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    speakAbortRef.current?.abort();
    speakAbortRef.current = null;
    if (isBrowserTTSAvailable) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    clearGeneratedAudio();
    setSpeakingId(null);
    setIsSpeaking(false);
    setIsPaused(false);
    setIsGeneratingSpeech(false);
    setSpeechStatus('');
  }, [clearGeneratedAudio]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      api.get('/api/settings').then((res) => (res.ok ? res.json() : null)).catch(() => null),
      api.get('/api/local-audio/tts/status').then((res) => (res.ok ? res.json() : null)).catch(() => null),
    ]).then(([settings, localVoice]) => {
      if (cancelled) return;

      const savedVoice = settings?.[VOICE_SETTING_KEY] || '';
      const configured = !!localVoice?.configured;
      const localAvailable = !!localVoice && !localVoice.error;
      setLocalCloneConfigured(configured);
      setLocalVoiceAvailable(localAvailable);

      if (savedVoice) {
        setSelectedVoiceURIState(savedVoice);
        try {
          window.localStorage.setItem(VOICE_STORAGE_KEY, savedVoice);
        } catch (_) {
          /* browser storage may be unavailable */
        }
        return;
      }

      if (configured) {
        setSelectedVoiceURIState(LOCAL_CLONE_VOICE_URI);
        try {
          window.localStorage.setItem(VOICE_STORAGE_KEY, LOCAL_CLONE_VOICE_URI);
        } catch (_) {
          /* browser storage may be unavailable */
        }
        api.post('/api/settings', { key: VOICE_SETTING_KEY, value: LOCAL_CLONE_VOICE_URI }).catch(() => {});
      }
    });

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
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          accumulatedRef.current += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setInterimText((accumulatedRef.current + (interim ? ` ${interim}` : '')).trim());
    };

    recognition.onend = () => {
      if (voiceModeRef.current === 'local') return;
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
      if (recorder?.state === 'recording') recorder.stop();
      return;
    }
    if (!isSTTAvailable || !recognitionRef.current) return;
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
    if (!isBrowserTTSAvailable) return undefined;

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

  const speakWithBrowser = useCallback((text, speechId = null) => {
    if (!isBrowserTTSAvailable) return;
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
      setIsGeneratingSpeech(false);
    };
    utterance.onend = () => {
      if (utteranceRef.current === utterance) utteranceRef.current = null;
      setSpeakingId(null);
      setIsSpeaking(false);
      setIsPaused(false);
    };
    utterance.onerror = (event) => {
      if (utteranceRef.current === utterance) utteranceRef.current = null;
      setSpeakingId(null);
      setIsSpeaking(false);
      setIsPaused(false);
      const reason = event?.error || 'speech-synthesis-failed';
      if (reason !== 'interrupted' && reason !== 'canceled') {
        setVoiceError('Read aloud failed in the browser voice. Try another voice in the speaker menu.');
      }
    };
    window.speechSynthesis.speak(utterance);
  }, [selectedVoiceURI, voices]);

  const speakWithLocalClone = useCallback(async (text, speechId = null) => {
    const spokenText = stripForSpeech(text);
    if (!spokenText) return;

    stopSpeaking();
    setIsGeneratingSpeech(true);
    setSpeakingId(speechId);
    setSpeechStatus('Preparing cloned voice (first run may download models, then ~30–90s per chunk on this Mac)…');

    const controller = new AbortController();
    speakAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 8 * 60 * 1000);

    try {
      const token = useAuthStore.getState().token;
      setSpeechStatus('Generating cloned voice on this Mac…');
      const res = await fetch('/api/local-audio/tts/speak', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: spokenText }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          throw new Error(data.error || 'Cloned voice is already generating. Wait for the spinner to finish.');
        }
        throw new Error(data.error || 'Local cloned voice failed.');
      }

      setSpeechStatus('Playing cloned voice…');

      const blob = await res.blob();
      if (!blob.size) {
        throw new Error('Cloned voice returned empty audio. Try again.');
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioUrlRef.current = url;
      audioRef.current = audio;

      audio.onplay = () => {
        setIsGeneratingSpeech(false);
        setIsSpeaking(true);
        setIsPaused(false);
        setSpeechStatus('');
      };
      audio.onpause = () => {
        if (audio.ended) return;
        setIsPaused(true);
      };
      audio.onended = () => {
        clearGeneratedAudio();
        setSpeakingId(null);
        setIsSpeaking(false);
        setIsPaused(false);
        setIsGeneratingSpeech(false);
        setSpeechStatus('');
      };
      audio.onerror = () => {
        clearGeneratedAudio();
        setSpeakingId(null);
        setIsSpeaking(false);
        setIsPaused(false);
        setIsGeneratingSpeech(false);
        setSpeechStatus('');
        setVoiceError('Could not play the cloned voice audio.');
      };

      try {
        await audio.play();
      } catch (playErr) {
        if (playErr?.name === 'NotAllowedError') {
          throw new Error('Browser blocked audio playback. Click the speaker button again after generation finishes.');
        }
        throw playErr;
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setVoiceError('Cloned voice generation timed out after 8 minutes. Try a shorter reply or use a Mac voice.');
      } else if (err.name !== 'AbortError') {
        const message = err.message || 'Local cloned voice failed.';
        setVoiceError(message.includes('cloned voice') ? message : `Local cloned voice failed: ${message}`);
      }
      setSpeakingId(null);
      setIsSpeaking(false);
      setIsPaused(false);
      setIsGeneratingSpeech(false);
      setSpeechStatus('');
      clearGeneratedAudio();
    } finally {
      window.clearTimeout(timeoutId);
      if (speakAbortRef.current === controller) speakAbortRef.current = null;
    }
  }, [clearGeneratedAudio, stopSpeaking]);

  const speak = useCallback((text, speechId = null) => {
    if (isGeneratingSpeech) {
      setVoiceError('Cloned voice is still generating. Wait for the spinner to finish or click stop.');
      return;
    }

    unlockAudioPlayback();
    const spokenText = stripForSpeech(text);
    if (!spokenText) {
      setVoiceError('Nothing to read aloud in this message.');
      return;
    }

    setVoiceError('');

    if (selectedVoiceURI === LOCAL_CLONE_VOICE_URI) {
      if (!localCloneConfigured) {
        setVoiceError('Set up your cloned voice in Settings → Profile first (My cloned voice section).');
        return;
      }
      speakWithLocalClone(text, speechId);
      return;
    }
    if (!isBrowserTTSAvailable) {
      setVoiceError('Read aloud is not available in this browser.');
      return;
    }
    speakWithBrowser(text, speechId);
  }, [isGeneratingSpeech, localCloneConfigured, selectedVoiceURI, speakWithBrowser, speakWithLocalClone, unlockAudioPlayback]);

  const pauseSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPaused(true);
      return;
    }
    if (!isBrowserTTSAvailable) return;
    window.speechSynthesis.pause();
    setIsPaused(true);
  }, []);

  const resumeSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play().catch(() => {});
      setIsPaused(false);
      return;
    }
    if (!isBrowserTTSAvailable) return;
    window.speechSynthesis.resume();
    setIsPaused(false);
  }, []);

  useEffect(() => () => {
    stopSpeaking();
  }, [stopSpeaking]);

  const clearVoiceError = useCallback(() => {
    setVoiceError('');
  }, []);

  const isTTSAvailable = isBrowserTTSAvailable || localCloneConfigured;

  return {
    isSTTAvailable,
    isLocalSTTAvailable,
    isTTSAvailable,
    isLocalCloneConfigured: localCloneConfigured,
    isLocalVoiceAvailable: localVoiceAvailable,
    isGeneratingSpeech,
    isListening,
    transcript,
    interimText,
    voiceError,
    speechStatus,
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
    clearVoiceError,
  };
}
