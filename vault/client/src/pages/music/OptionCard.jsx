import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import { setToolHandoff } from '../../utils/toolHandoff.mjs';
import { keepJobForReturn } from './jobMemory.mjs';
import { card, field, muted, DEFAULT_SETTINGS, DUCKING_OPTIONS, formatDuration, qs } from './musicShared';

// One music option: preview against the video, volume + ducking, export / save. Moved out of MusicPage.jsx unchanged.
// Video Tools tools a finished option can be sent to. `kind` = which file they take: the music alone (WAV) or the video with the music mixed in (MP4).
const FINISH_TOOLS = [
  { id: 'normalize', kind: 'video', label: 'Normalize audio', tip: 'Open Normalize audio in Video Tools with your video and this music mixed in, to even out the loudness.' },
  { id: 'trim-audio', kind: 'audio', label: 'Trim audio', tip: 'Open Trim audio in Video Tools with just this music, to keep one part or cut a part out.' },
  { id: 'mix-audio', kind: 'audio', label: 'Mix audio', tip: 'Open Mix audio in Video Tools with this music in the background slot, ready for a voice recording.' },
  { id: 'export-social', kind: 'video', label: 'Export for Social', tip: 'Open Export for Social in Video Tools with your video and this music mixed in, to make tall, square and widescreen versions.' },
];

export default function OptionCard({
  jobId, option, hasAudio, durationS, source, voice, voiceSettings, videosOk = false,
  hasVideo = true, canRemake = false, onRemake, onMedia, onPlayed,
}) {
  const navigate = useNavigate();
  const [handing, setHanding] = useState('');
  const addToast = useToastStore((s) => s.addToast);
  const [musicSettings, setSettings] = useState(DEFAULT_SETTINGS);
  const settings = { ...musicSettings, voiceVolume: voiceSettings.volume, voiceStart: voiceSettings.start };
  const [rendered, setRendered] = useState(null); // settings the current preview was rendered with
  const [previewUrl, setPreviewUrl] = useState(null);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const urlRef = useRef(null);

  const base = `/api/music/jobs/${jobId}/options/${option.n}`;

  const renderPreview = useCallback(async (s) => {
    setRendering(true);
    try {
      const res = await api.get(hasVideo ? `${base}/preview?${qs(s, voice)}` : `${base}/audio`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Could not render the preview');
      }
      const url = URL.createObjectURL(await res.blob());
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPreviewUrl(url);
      setRendered(s);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setRendering(false);
    }
  }, [base, addToast, voice, hasVideo]);

  // First render when the option is ready; again when a voiceover is added, replaced or removed.
  useEffect(() => {
    if (option.status === 'ready') renderPreview(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option.status, option.rev, jobId, voice?.rev]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const dirty = rendered && (rendered.volume !== settings.volume || rendered.ducking !== settings.ducking
    || (voice && (rendered.voiceVolume !== settings.voiceVolume || rendered.voiceStart !== settings.voiceStart)));

  const exportFile = async (url, name, label) => {
    try {
      await api.download(url, name);
      addToast(`${label} saved`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  // Send this option to a Video Tools tool: fetch the file (the music alone, or the video with the music mixed in, using the
  // settings above), leave it for that tool, and go there. The job is kept so the other options are still here on return.
  const finishIn = async (t) => {
    setHanding(t.id);
    try {
      const res = await api.get(t.kind === 'audio' ? `${base}/audio` : `${base}/video?${qs(settings, voice)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Could not prepare that file');
      }
      const blob = await res.blob();
      const name = t.kind === 'audio' ? 'music.wav' : (voice ? 'video-with-music-and-voice.mp4' : 'video-with-music.mp4');
      setToolHandoff(t.id, new File([blob], name, { type: blob.type || (t.kind === 'audio' ? 'audio/wav' : 'video/mp4') }));
      keepJobForReturn(jobId);
      navigate(`/videos?tool=${t.id}`);
    } catch (err) {
      addToast(err.message, 'error');
      setHanding('');
    }
  };

  const saveToLibrary = async () => {
    setSaving(true);
    try {
      const res = await api.post(`${base}/save`, {
        volume: settings.volume / 100,
        ducking: settings.ducking,
        ...(voice ? { voiceVolume: settings.voiceVolume / 100, voiceStart: settings.voiceStart } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the video');
      setSaved(true);
      addToast('Saved to Saved media (Video Tools)', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const finishTools = hasVideo ? FINISH_TOOLS : FINISH_TOOLS.filter((t) => t.kind === 'audio');
  const ownTrack = source === 'upload';
  const title = ownTrack ? 'Your track' : `Option ${option.n + 1}`;

  if (option.status === 'failed') {
    return (
      <div className="rounded-2xl border p-4" style={card}>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</p>
        <p className="text-xs mt-1" style={{ color: '#ef4444' }}>This one failed: {option.error || 'unknown error'}</p>
        {canRemake && onRemake && (
          <button
            type="button" onClick={() => onRemake(option.n)}
            className="mt-2 px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Try again
          </button>
        )}
      </div>
    );
  }
  if (option.status !== 'ready') {
    return (
      <div className="rounded-2xl border p-4" style={card}>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</p>
        <p className="text-xs mt-1" style={muted}>
          {option.status === 'fitting' ? (hasVideo ? 'Cutting to your video length…' : 'Cutting to length…') : 'Composing…'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border p-4 space-y-3" style={card}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</p>
        <p className="text-xs" style={muted}>
          {formatDuration(durationS)}{option.loops > 1 ? ` · loops ${option.loops}× with crossfades` : ''}
          {!ownTrack && option.seed ? (
            <Tooltip text="The number this version was made from. Type it in the Seed box with the same description to get this exact music back as option 1.">
              <span> · seed {option.seed}</span>
            </Tooltip>
          ) : null}
        </p>
      </div>

      <div className="rounded-xl overflow-hidden relative" style={{ background: hasVideo ? '#000' : 'var(--color-bg)' }}>
        {previewUrl && hasVideo && (
          <video
            ref={(el) => onMedia?.(option.n, el)} onPlay={() => onPlayed?.(option.n)}
            src={previewUrl} controls className="w-full max-h-72"
          />
        )}
        {previewUrl && !hasVideo && (
          <audio
            ref={(el) => onMedia?.(option.n, el)} onPlay={() => onPlayed?.(option.n)}
            src={previewUrl} controls className="w-full"
          />
        )}
        {!previewUrl && <div className="h-40 flex items-center justify-center text-xs" style={{ color: hasVideo ? '#fff' : 'var(--color-muted)' }}>{hasVideo ? 'Rendering preview…' : 'Loading…'}</div>}
        {rendering && previewUrl && (
          <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>Updating preview…</div>
        )}
      </div>

      {hasVideo && (
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs" style={muted}>Music volume · {settings.volume}%</span>
          <Tooltip text="How loud the music is relative to the video's own sound. The final mix is levelled to about -14 LUFS.">
            <input
              type="range" min={0} max={150} step={5} value={settings.volume}
              onChange={(e) => setSettings((s) => ({ ...s, volume: Number(e.target.value) }))}
              className="w-full"
            />
          </Tooltip>
        </label>
        <label className="block space-y-1">
          <span className="text-xs" style={muted}>Ducking under speech</span>
          <Tooltip text={hasAudio || voice ? 'Lowers the music while people (or your voiceover) are talking. Strong dips it much further.' : 'This video has no sound of its own and no voiceover, so there is nothing to duck under.'}>
            <select
              value={settings.ducking}
              disabled={!hasAudio && !voice}
              onChange={(e) => setSettings((s) => ({ ...s, ducking: e.target.value }))}
              className="w-full px-2 py-1.5 rounded-xl border text-xs disabled:opacity-40"
              style={field}
            >
              {DUCKING_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Tooltip>
        </label>
      </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {hasVideo && dirty && (
          <Tooltip text="Re-render the preview with the new volume, ducking and voiceover settings.">
            <button
              type="button" onClick={() => renderPreview(settings)} disabled={rendering}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)', color: '#fff' }}
            >
              Update preview
            </button>
          </Tooltip>
        )}
        <Tooltip text={hasVideo ? "Just the music, cut to your video's exact length with fades, as a WAV file." : 'The music, cut to the length you chose with fades, as a WAV file.'}>
          <button
            type="button" onClick={() => exportFile(`${base}/audio`, 'music.wav', 'Audio')}
            className="px-3 py-1.5 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Export audio (WAV)
          </button>
        </Tooltip>
        {hasVideo && (
        <Tooltip text="Your video with this music (and the voiceover, if you added one) mixed in, using the settings above. The picture is not re-encoded where possible.">
          <button
            type="button" onClick={() => exportFile(`${base}/video?${qs(settings, voice)}`, voice ? 'video-with-music-and-voice.mp4' : 'video-with-music.mp4', 'Video')}
            className="px-3 py-1.5 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Export video (MP4)
          </button>
        </Tooltip>
        )}
        {hasVideo && (
        <Tooltip text="Store this video with the music in Saved media, so you can caption, join or annotate it in Video Tools. Uses the volume and ducking above.">
          <button
            type="button" onClick={saveToLibrary} disabled={saving || saved}
            className="px-3 py-1.5 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
            style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
          >
            {saving ? 'Saving…' : saved ? 'Saved to Saved media' : 'Save to Saved media'}
          </button>
        </Tooltip>
        )}
        {canRemake && onRemake && (
          <Tooltip text="Make this option again with a new random seed. The other options stay as they are. Has a small cost.">
            <button
              type="button" onClick={() => onRemake(option.n)}
              className="px-3 py-1.5 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              Make a new version
            </button>
          </Tooltip>
        )}
      </div>

      {videosOk && (
        <div className="flex flex-wrap items-center gap-2" data-tour="music-finish">
          <span className="text-xs" style={muted}>Finish in Video Tools:</span>
          {finishTools.map((t) => (
            <Tooltip key={t.id} text={t.tip}>
              <button
                type="button" onClick={() => finishIn(t)} disabled={Boolean(handing)}
                className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                {handing === t.id ? 'Preparing…' : t.label}
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
