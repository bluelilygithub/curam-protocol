import { useCallback, useEffect, useRef, useState } from 'react';
import { splitForSpeech } from './talkUtils.mjs';

/**
 * Speaks text aloud with the browser's own voice (no server, no cost). Long text is spoken in pieces, because some engines stop in the middle
 * of a long passage. `speak(text, onEnd)` calls `onEnd` once everything has been said (not when it was cancelled); `cancel()` stops at once.
 * Docs: docs/talk.md. (Chat's read-aloud button in useVoice.js can use a cloned voice; this one is the simple always-available voice.)
 */
export default function useSpeaker() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [speaking, setSpeaking] = useState(false);
  const runRef = useRef(0); // bumped on every speak and cancel, so a stale "finished" callback is ignored
  const voiceRef = useRef(null);

  // The voice: the person's own language if the browser has one (en-AU on an Australian phone), else any English one, else the default.
  useEffect(() => {
    if (!supported) return undefined;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      const lang = (navigator.language || 'en-AU').toLowerCase();
      voiceRef.current = voices.find((v) => v.lang?.toLowerCase() === lang && v.localService)
        || voices.find((v) => v.lang?.toLowerCase() === lang)
        || voices.find((v) => v.lang?.toLowerCase().startsWith(lang.slice(0, 2)))
        || voices.find((v) => v.lang?.toLowerCase().startsWith('en'))
        || null;
    };
    pick();
    window.speechSynthesis.onvoiceschanged = pick;
    return () => { if (window.speechSynthesis.onvoiceschanged === pick) window.speechSynthesis.onvoiceschanged = null; };
  }, [supported]);

  const cancel = useCallback(() => {
    runRef.current += 1;
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback((text, onEnd) => {
    if (!supported) { onEnd?.(); return; }
    const pieces = splitForSpeech(text);
    if (!pieces.length) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    const mine = ++runRef.current;
    setSpeaking(true);
    pieces.forEach((piece, i) => {
      const u = new SpeechSynthesisUtterance(piece);
      if (voiceRef.current) { u.voice = voiceRef.current; u.lang = voiceRef.current.lang; }
      u.rate = 1;
      const last = i === pieces.length - 1;
      u.onend = () => { if (last && runRef.current === mine) { setSpeaking(false); onEnd?.(); } };
      u.onerror = (e) => { if (e.error !== 'canceled' && e.error !== 'interrupted' && runRef.current === mine) { setSpeaking(false); if (last) onEnd?.(); } };
      window.speechSynthesis.speak(u);
    });
  }, [supported]);

  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  return { supported, speaking, speak, cancel };
}
