import React, { useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { card, field, muted, formatDuration } from './musicShared';

// Voiceover for the whole job: type a script for an AI voice, or upload a recording. It is mixed over
// the music (which dips under it) in every option's preview and export.
export default function VoiceoverPanel({ job, status, onJobChange, voiceSettings, onVoiceSettings }) {
  const addToast = useToastStore((s) => s.addToast);
  const voiceInfo = status?.voice;
  const ttsOk = Boolean(voiceInfo?.provider?.configured);
  const voices = voiceInfo?.voices || [];
  const [mode, setMode] = useState('script'); // 'script' | 'upload'
  const [text, setText] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [speed, setSpeed] = useState(1);
  const [recording, setRecording] = useState(null);
  const [busy, setBusy] = useState(false);
  const [listenUrl, setListenUrl] = useState(null);
  const recInputRef = useRef(null);
  const voice = job.voice;

  useEffect(() => { if (!ttsOk && voiceInfo) setMode('upload'); }, [ttsOk, voiceInfo]);

  // The voiceover on its own, for a quick listen (needs the auth header, so fetched as a blob).
  useEffect(() => {
    let url = null;
    let live = true;
    setListenUrl(null);
    if (voice) {
      api.get(`/api/music/jobs/${job.id}/voiceover/audio`)
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => { if (b && live) { url = URL.createObjectURL(b); setListenUrl(url); } })
        .catch(() => {});
    }
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [job.id, voice?.rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    setBusy(true);
    try {
      let res;
      if (mode === 'upload') {
        const fd = new FormData();
        fd.append('voice', recording);
        res = await api.postForm(`/api/music/jobs/${job.id}/voiceover`, fd);
      } else {
        res = await api.post(`/api/music/jobs/${job.id}/voiceover`, { text, voice: voiceId || undefined, speed });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not add the voiceover');
      onJobChange(data);
      onVoiceSettings({ volume: 100, start: 0 });
      addToast('Voiceover added — previews are updating', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await api.delete(`/api/music/jobs/${job.id}/voiceover`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not remove the voiceover');
      onJobChange(data);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const canAdd = !busy && (mode === 'upload' ? Boolean(recording) : text.trim() && ttsOk);
  const over = voice && voice.durationS + voiceSettings.start > job.durationS + 0.25;

  return (
    <section className="rounded-2xl border p-4 space-y-3" style={card} data-tour="music-voiceover">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Voiceover (optional)</p>
        {voice && (
          <button
            type="button" onClick={remove} disabled={busy}
            className="text-xs transition-opacity duration-200 hover:opacity-60 disabled:opacity-40"
            style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Remove voiceover
          </button>
        )}
      </div>

      {voice ? (
        <div className="space-y-3">
          <p className="text-xs" style={muted}>
            {voice.source === 'tts' ? `AI voice (${voices.find((v) => v.id === voice.voice)?.label || voice.voice})` : 'Your recording'} · {formatDuration(voice.durationS)}
            {voice.text ? ` · “${voice.text.length > 90 ? `${voice.text.slice(0, 90)}…` : voice.text}”` : ''}
          </p>
          {listenUrl && <audio src={listenUrl} controls className="w-full h-8" />}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs" style={muted}>Voice volume · {voiceSettings.volume}%</span>
              <Tooltip text="How loud the voiceover is. The music and the video's own sound dip underneath it, and the final mix is levelled to about -14 LUFS.">
                <input
                  type="range" min={0} max={200} step={5} value={voiceSettings.volume}
                  onChange={(e) => onVoiceSettings({ ...voiceSettings, volume: Number(e.target.value) })}
                  className="w-full"
                />
              </Tooltip>
            </label>
            <label className="block space-y-1">
              <span className="text-xs" style={muted}>Starts at · {voiceSettings.start.toFixed(1)}s</span>
              <Tooltip text="Where in the video the voice begins. Use the sliders and then Update preview on an option to hear the change.">
                <input
                  type="range" min={0} max={Math.max(0, Math.floor((job.durationS - 0.5) * 2) / 2)} step={0.5} value={voiceSettings.start}
                  onChange={(e) => onVoiceSettings({ ...voiceSettings, start: Number(e.target.value) })}
                  className="w-full"
                />
              </Tooltip>
            </label>
          </div>
          {over && (
            <p className="text-xs" style={{ color: '#b45309' }}>
              The voiceover runs {formatDuration(voice.durationS)} from {voiceSettings.start.toFixed(1)}s, past the end of your {formatDuration(job.durationS)} {job.hasVideo === false ? 'of music' : 'video'} — the end will be cut off. Start it earlier or shorten the script.
            </p>
          )}
          <p className="text-xs" style={muted}>To change the words or the voice, add a new one below — it replaces this one.</p>
        </div>
      ) : (
        <p className="text-xs" style={muted}>Add narration: type a script for an AI voice, or upload a recording. The music dips under it automatically.</p>
      )}

      <div className="flex gap-2">
        {[['script', 'Write a script'], ['upload', 'Upload a recording']].map(([id, label]) => (
          <button
            key={id} type="button" onClick={() => setMode(id)}
            className="px-3 py-1.5 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
            style={{
              borderColor: mode === id ? 'var(--color-primary)' : 'var(--color-border)',
              color: mode === id ? 'var(--color-primary)' : 'var(--color-muted)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'script' ? (
        <div className="space-y-2">
          {!ttsOk && (
            <p className="text-xs" style={{ color: '#b45309' }}>{voiceInfo?.provider?.note || 'AI voices are not set up on this server.'} You can still upload a recording.</p>
          )}
          <Tooltip text={`What the voice should say, up to ${voiceInfo?.maxChars || 1500} characters. About 14 characters is a second of speech. Type it or tap the mic.`}>
            <div>
              <VoiceInput
                type="textarea" append rows={3} value={text} onChange={setText}
                label="Voiceover script"
                placeholder="e.g. Welcome to our summer sale — everything must go this weekend."
                className="!text-xs"
              />
            </div>
          </Tooltip>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs" style={muted}>Voice</span>
              <Tooltip text="The AI voice that reads the script.">
                <select value={voiceId || voices[0]?.id || ''} onChange={(e) => setVoiceId(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={field}>
                  {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </Tooltip>
            </label>
            <label className="block space-y-1">
              <span className="text-xs" style={muted}>Speed · {speed.toFixed(2)}×</span>
              <Tooltip text="Slower or faster delivery. 1× is natural.">
                <input type="range" min={0.7} max={1.3} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-full" />
              </Tooltip>
            </label>
          </div>
          <p className="text-xs" style={muted}>{text.length} / {voiceInfo?.maxChars || 1500} characters · about {Math.max(1, Math.round(text.length / 14))}s spoken. The AI voice has a small per-use cost.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            ref={recInputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" className="hidden"
            onChange={(e) => { setRecording(e.target.files?.[0] || null); e.target.value = ''; }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip text="Choose a recording of the narration (MP3, WAV, M4A…). Record it on your phone or computer first.">
              <button
                type="button" onClick={() => recInputRef.current?.click()}
                className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {recording ? 'Choose a different recording' : 'Choose recording'}
              </button>
            </Tooltip>
            {recording && <span className="text-xs" style={muted}>{recording.name}</span>}
          </div>
        </div>
      )}

      <Tooltip text={mode === 'upload' ? 'Add this recording to the mix.' : 'Have the AI voice read the script and add it to the mix.'}>
        <button
          type="button" onClick={add} disabled={!canAdd}
          className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          {busy ? 'Working…' : voice ? 'Replace voiceover' : mode === 'upload' ? 'Add recording' : 'Add voiceover'}
        </button>
      </Tooltip>
    </section>
  );
}
