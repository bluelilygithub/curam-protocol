import React, { useRef } from 'react';
import Tooltip from '../../components/Tooltip';
import {
  timeFromX, snapTime, clampVoiceStart, clampMusicStart, musicBarLayout, voiceBarLayout,
} from './timelineMath.mjs';
import { formatDuration, muted } from './musicShared';

/**
 * Where things sit along the video: the picture cuts (thin lines), the music (a bar with its fade-in and fade-out ramps and the
 * place it starts) and the voiceover (a bar you can drag). Dragging a bar snaps to a nearby cut when "Snap to cuts" is on.
 * Everything here is a guide drawn from the numbers the page already holds; it plays nothing itself.
 *
 *   durationS      length of the video (or of the music, for music without a video)
 *   cuts           picture cuts in seconds, or null while unknown / [] when there are none
 *   tune           { fadeInS, fadeOutS, startS } as currently set (applied or not)
 *   voice          { durationS } of the voiceover, or null
 *   voiceStart     seconds
 *   snap           snap dragged bars to cuts
 *   onVoiceStart / onMusicStart  (seconds) => void
 */

const BAR_FILL = 'color-mix(in srgb, var(--color-primary) 38%, transparent)';
const VOICE_FILL = 'color-mix(in srgb, var(--color-text) 30%, transparent)';

export default function MusicTimeline({ durationS, cuts, tune, voice, voiceStart, snap, onVoiceStart, onMusicStart }) {
  const trackRef = useRef(null);
  const dragRef = useRef(null); // { kind, grabOffsetS }

  const music = musicBarLayout(durationS, tune);
  const vbar = voice ? voiceBarLayout(durationS, voice.durationS, voiceStart) : null;

  const secondsAt = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect ? timeFromX(clientX - rect.left, rect.width, durationS) : 0;
  };

  const begin = (kind, startS) => (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { kind, grabOffsetS: secondsAt(e.clientX) - startS };
  };
  const move = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const t = snapTime(secondsAt(e.clientX) - d.grabOffsetS, cuts, { enabled: snap });
    if (d.kind === 'voice') onVoiceStart?.(clampVoiceStart(t, durationS));
    else onMusicStart?.(clampMusicStart(t, durationS));
  };
  const end = () => { dragRef.current = null; };

  const keys = (kind, current) => (e) => {
    const step = e.shiftKey ? 1 : 0.1;
    let next = null;
    if (e.key === 'ArrowLeft') next = current - step;
    else if (e.key === 'ArrowRight') next = current + step;
    if (next === null) return;
    e.preventDefault();
    if (kind === 'voice') onVoiceStart?.(clampVoiceStart(next, durationS));
    else onMusicStart?.(clampMusicStart(next, durationS));
  };

  const rampFill = (() => {
    const w = music.widthPct || 100;
    const inP = (music.fadeInPct / w) * 100;
    const outP = (music.fadeOutPct / w) * 100;
    return `linear-gradient(to right, transparent 0%, ${BAR_FILL} ${inP}%, ${BAR_FILL} ${100 - outP}%, transparent 100%)`;
  })();

  return (
    <div className="space-y-1" data-tour="music-timeline">
      <div className="flex justify-between text-[10px]" style={muted}>
        <span>0:00</span>
        <span>{formatDuration(durationS / 2)}</span>
        <span>{formatDuration(durationS)}</span>
      </div>
      <div
        ref={trackRef}
        className="relative rounded-xl border select-none"
        style={{ height: 84, borderColor: 'var(--color-border)', background: 'var(--color-bg)', touchAction: 'none' }}
      >
        {(cuts || []).map((c) => (
          <Tooltip key={c} text={`The picture cuts at ${formatDuration(c)}. Drag the voice or the start of the music near it and it snaps here.`}>
            <div
              className="absolute top-0 bottom-0"
              style={{ left: `${(c / durationS) * 100}%`, width: 1, background: 'var(--color-muted)', opacity: 0.6 }}
            />
          </Tooltip>
        ))}

        {/* music */}
        <div className="absolute" style={{ top: 8, height: 28, left: `${music.startPct}%`, width: `${music.widthPct}%` }}>
          <div className="w-full h-full rounded-md" style={{ background: rampFill, border: '1px solid var(--color-primary)' }} />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: 'var(--color-text)' }}>Music</span>
          {onMusicStart && (
            <Tooltip text="Drag to change where the music starts. It snaps to a picture cut when Snap to cuts is on. Arrow keys nudge it.">
              <div
                role="slider" tabIndex={0} aria-label="Where the music starts" aria-valuemin={0} aria-valuemax={durationS} aria-valuenow={tune.startS}
                onPointerDown={begin('music', tune.startS)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
                onKeyDown={keys('music', tune.startS)}
                className="absolute rounded-sm"
                style={{ left: -4, top: -3, bottom: -3, width: 8, background: 'var(--color-primary)', cursor: 'ew-resize' }}
              />
            </Tooltip>
          )}
        </div>

        {/* voiceover */}
        {vbar && vbar.widthPct > 0 && (
          <Tooltip text="Your voiceover. Drag it to change when it starts. It snaps to a picture cut when Snap to cuts is on. Arrow keys nudge it.">
            <div
              role="slider" tabIndex={0} aria-label="Where the voiceover starts" aria-valuemin={0} aria-valuemax={durationS} aria-valuenow={voiceStart}
              onPointerDown={begin('voice', voiceStart)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
              onKeyDown={keys('voice', voiceStart)}
              className="absolute rounded-md flex items-center"
              style={{
                top: 44, height: 28, left: `${vbar.startPct}%`, width: `${vbar.widthPct}%`,
                background: VOICE_FILL, border: `1px ${vbar.overrunS > 0 ? 'dashed' : 'solid'} var(--color-text)`, cursor: 'grab',
              }}
            >
              <span className="px-2 text-[10px] pointer-events-none" style={{ color: 'var(--color-text)' }}>Voice · {voiceStart.toFixed(1)}s</span>
            </div>
          </Tooltip>
        )}
      </div>
      {vbar?.overrunS > 0 && (
        <p className="text-[11px]" style={{ color: '#b45309' }}>The voice runs {vbar.overrunS.toFixed(1)}s past the end, so the end is cut off.</p>
      )}
    </div>
  );
}
