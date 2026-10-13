import React, { createContext, useContext, useState } from 'react';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import Tooltip from '../../components/Tooltip';

/**
 * "Tell it what to do" box under a Video Tools title. Same pattern as Restyle, Graphics and the Slideshow/Join
 * planners: the mic puts what you say into an editable text box (live as you speak, added to what is already there),
 * nothing happens until you press Apply, and the settings it changed are listed so you can check them in the form.
 * The page supplies `run(toolId, text)` through context because it owns each tool's state.
 */
export const VideoVoiceContext = createContext(null);

export const VOICE_EXAMPLES = {
  generate: 'a slow drone shot over a beach at sunset, cinematic, 8 seconds, wide screen',
  clip: 'cut from 10 seconds to 25 seconds',
  'trim-audio': 'keep from 1:30 to 2:45 and fade out for 2 seconds',
  convert: 'make the file smaller and no wider than 1280',
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
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { kind: 'ok'|'none'|'error', applied?, message? }
  // Tools with nothing to set by voice (Extract audio, File info, Saved media) get no box.
  if (!ctx || !VOICE_EXAMPLES[toolId]) return null;
  const example = VOICE_EXAMPLES[toolId];

  const apply = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await ctx.run(toolId, text.trim());
      setStatus(r.applied.length ? { kind: 'ok', applied: r.applied } : { kind: 'none' });
    } catch (e) {
      setStatus({ kind: 'error', message: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Tell it what to do (optional)</p>
      <VoiceInput
        type="textarea"
        append
        rows={2}
        value={text}
        onChange={(v) => { setText(v.slice(0, 600)); setStatus(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); apply(); } }}
        placeholder={`e.g. ${example}. (Tap the mic to say it, then fix any words before applying.)`}
        label="Tell this tool what to do"
        className="!text-xs"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <Tooltip text="Fill in this tool's settings from your words. Nothing is exported until you press the tool's own button.">
          <button
            type="button"
            onClick={apply}
            disabled={!text.trim() || busy}
            className="px-4 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70 disabled:opacity-40"
            style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
          >
            {busy ? 'Working it out…' : 'Apply to settings'}
          </button>
        </Tooltip>
        {status?.kind === 'ok' && (
          <p className="text-xs" role="status" style={{ color: 'var(--color-text)' }}>
            <strong>Set:</strong> {status.applied.join(' · ')}
          </p>
        )}
        {status?.kind === 'none' && (
          <p className="text-xs" role="status" style={{ color: '#b45309' }}>No setting found in that. Edit the words and try again.</p>
        )}
        {status?.kind === 'error' && (
          <p className="text-xs" role="status" style={{ color: '#ef4444' }}>{status.message}</p>
        )}
      </div>
    </div>
  );
}
