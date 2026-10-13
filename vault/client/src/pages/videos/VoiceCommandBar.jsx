import React, { createContext, useContext, useState } from 'react';
import { MicButton } from '../../components/voiceInput/VoiceInput';

/**
 * Mic for a Video Tools header. The page supplies `run(toolId, text)` through context (it knows each tool's
 * state setters); this component only listens, shows what was heard and what was set, and reports problems.
 */
export const VideoVoiceContext = createContext(null);

export const VOICE_EXAMPLES = {
  generate: 'a slow drone shot over a beach at sunset, cinematic, 8 seconds, wide screen',
  clip: 'cut from 10 seconds to 25 seconds',
  convert: 'make the file smaller and no wider than 1280',
  'extract-audio': null,
  audio: 'mute the sound',
  normalize: 'make it louder',
  togif: 'from 5 to 12 seconds, 15 frames a second, 480 wide',
  'export-social': 'just reels and square, keep the top',
  reframe: 'vertical 9:16, crop, keep the centre',
  speed: 'twice as fast',
  annotate: 'say Summer Sale at the top centre, bold, fade in for 1 second',
  'end-card': 'headline Book today, button Get a quote, address curam-ai.com.au',
  overlay: 'bottom right, 15 percent, mostly solid',
  join: 'crossfade for half a second, width 1280',
  slideshow: 'three seconds a slide, square, fade between pictures',
  'caption-studio': 'bigger yellow text, bold, no background',
  thumbnail: 'grab the frame at 12 seconds',
};

export function VoiceCommandBar({ toolId }) {
  const ctx = useContext(VideoVoiceContext);
  const [state, setState] = useState(null); // { kind: 'busy'|'ok'|'none'|'error', heard, applied, message }
  // Tools with nothing to set by voice (Extract audio, File info, Saved media) get no mic.
  if (!ctx || !VOICE_EXAMPLES[toolId]) return null;
  const example = VOICE_EXAMPLES[toolId];

  const onFinal = async (text) => {
    setState({ kind: 'busy', heard: text });
    try {
      const r = await ctx.run(toolId, text);
      setState(r.applied.length
        ? { kind: 'ok', heard: r.heard, applied: r.applied }
        : { kind: 'none', heard: r.heard });
    } catch (e) {
      setState({ kind: 'error', heard: text, message: e.message });
    }
  };

  return (
    <>
      <MicButton
        label={`Tell this tool what to do, e.g. “${example}”`}
        onStart={() => setState(null)}
        onInterim={(text) => setState({ kind: 'busy', heard: text })}
        onFinal={onFinal}
        onCancel={() => setState(null)}
      />
      {state && (
        <p className="basis-full text-[11px] mt-1" role="status" style={{ color: state.kind === 'error' ? '#ef4444' : 'var(--color-muted)' }}>
          {state.heard && <>Heard “{state.heard}”. </>}
          {state.kind === 'busy' && 'Working it out…'}
          {state.kind === 'ok' && <strong style={{ color: 'var(--color-text)' }}>Set {state.applied.join(' · ')}</strong>}
          {state.kind === 'none' && `Couldn't find a setting in that. Try “${example}”.`}
          {state.kind === 'error' && state.message}
        </p>
      )}
    </>
  );
}
