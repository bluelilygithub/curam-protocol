// Browser speech-to-text, extracted from Vault's `useVoice` hook so Vault and the planner apps share ONE implementation of the
// Web Speech API handling (accumulate finals, show interim text, map errors to plain messages). Framework-free: React wrappers
// (Vault's `useVoice`, the planners' `VoiceInput`) sit on top of this.

interface SpeechAlternativeLike { transcript: string }
interface SpeechResultLike { isFinal: boolean; 0: SpeechAlternativeLike }
interface SpeechEventLike { resultIndex: number; results: ArrayLike<SpeechResultLike> }
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((e: SpeechEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** True when this browser can do speech recognition (Chrome, Edge, Safari). */
export function isSpeechRecognitionAvailable(): boolean {
  return ctor() !== null;
}

/** Plain-language message for a SpeechRecognition error code; '' for a deliberate abort. */
export function speechErrorMessage(error?: string): string {
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

export interface RecognizerOptions { lang?: string; continuous?: boolean }

export interface RecognizerHandlers {
  onStart?(): void;
  /** Text so far: everything final plus the current interim phrase, trimmed. */
  onInterim?(text: string): void;
  /** Recognition ended normally. `finalText` is what was heard ('' if nothing); it is cleared once delivered. */
  onEnd?(finalText: string): void;
  /** Recognition failed. `finalText` is whatever was heard before the failure. */
  onError?(code: string | undefined, message: string, finalText: string): void;
}

/** One recognition session at a time. `null` from `createRecognizer` means the browser has no speech recognition. */
export interface Recognizer {
  /** Throws if the browser refuses to start (already listening, permission prompt pending...). */
  start(): void;
  stop(): void;
  abort(): void;
  /** Take (and clear) the text heard so far. Used when stopping by hand so the words are not lost. */
  flush(): string;
}

export function createRecognizer(options: RecognizerOptions, handlers: RecognizerHandlers): Recognizer | null {
  const Ctor = ctor();
  if (!Ctor) return null;
  const { lang = 'en-US', continuous = true } = options;
  const recognition = new Ctor();
  recognition.continuous = continuous;
  recognition.interimResults = true;
  recognition.lang = lang;
  let accumulated = '';

  const flush = (): string => { const t = accumulated; accumulated = ''; return t; };

  recognition.onstart = () => handlers.onStart?.();
  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (result.isFinal) accumulated += result[0].transcript;
      else interim += result[0].transcript;
    }
    handlers.onInterim?.((accumulated + (interim ? ` ${interim}` : '')).trim());
  };
  recognition.onend = () => handlers.onEnd?.(flush());
  recognition.onerror = (e) => handlers.onError?.(e.error, speechErrorMessage(e.error), flush());

  return {
    start() { accumulated = ''; recognition.start(); },
    stop() { recognition.stop(); },
    abort() { recognition.abort(); },
    flush,
  };
}
