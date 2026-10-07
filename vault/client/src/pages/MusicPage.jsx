import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import Tooltip from '../components/Tooltip';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { startMusicTour, TOUR_KEY as MUSIC_TOUR_KEY } from '../utils/tours/musicTour';
import { musicProgressSteps, formatElapsed } from './music/musicProgress.mjs';

// Music (/music): pick a video, choose a mood (or describe the music), get 3 instrumental options
// cut to the video's exact length, preview each against the video, then export the audio (WAV) or the
// video with the music mixed in (ducked under speech). Generation runs on the server as a job; this
// page polls it. Docs: docs/music.md.

const POLL_MS = 2000;
const DEFAULT_SETTINGS = { volume: 70, ducking: 'light' };
const DUCKING_OPTIONS = [['off', 'Off'], ['light', 'Light'], ['strong', 'Strong']];

const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const field = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const muted = { color: 'var(--color-muted)' };

function formatDuration(s) {
  if (!Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${s.toFixed(1)}s`;
}

const qs = (s) => `volume=${(s.volume / 100).toFixed(2)}&ducking=${s.ducking}`;

function OptionCard({ jobId, option, hasAudio, durationS }) {
  const addToast = useToastStore((s) => s.addToast);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [rendered, setRendered] = useState(null); // settings the current preview was rendered with
  const [previewUrl, setPreviewUrl] = useState(null);
  const [rendering, setRendering] = useState(false);
  const urlRef = useRef(null);

  const base = `/api/music/jobs/${jobId}/options/${option.n}`;

  const renderPreview = useCallback(async (s) => {
    setRendering(true);
    try {
      const res = await api.get(`${base}/preview?${qs(s)}`);
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
  }, [base, addToast]);

  useEffect(() => {
    if (option.status === 'ready') renderPreview(DEFAULT_SETTINGS);
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option.status, jobId]);

  const dirty = rendered && (rendered.volume !== settings.volume || rendered.ducking !== settings.ducking);

  const exportFile = async (url, name, label) => {
    try {
      await api.download(url, name);
      addToast(`${label} saved`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  if (option.status === 'failed') {
    return (
      <div className="rounded-2xl border p-4" style={card}>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Option {option.n + 1}</p>
        <p className="text-xs mt-1" style={{ color: '#ef4444' }}>This one failed: {option.error || 'unknown error'}</p>
      </div>
    );
  }
  if (option.status !== 'ready') {
    return (
      <div className="rounded-2xl border p-4" style={card}>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Option {option.n + 1}</p>
        <p className="text-xs mt-1" style={muted}>
          {option.status === 'fitting' ? 'Cutting to your video length…' : 'Composing…'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border p-4 space-y-3" style={card}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Option {option.n + 1}</p>
        <p className="text-xs" style={muted}>
          {formatDuration(durationS)}{option.loops > 1 ? ` · loops ${option.loops}× with crossfades` : ''}
        </p>
      </div>

      <div className="rounded-xl overflow-hidden relative" style={{ background: '#000' }}>
        {previewUrl
          ? <video src={previewUrl} controls className="w-full max-h-72" />
          : <div className="h-40 flex items-center justify-center text-xs" style={{ color: '#fff' }}>Rendering preview…</div>}
        {rendering && previewUrl && (
          <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>Updating preview…</div>
        )}
      </div>

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
          <Tooltip text={hasAudio ? 'Lowers the music while people are talking. Strong dips it much further.' : 'This video has no sound of its own, so there is nothing to duck under.'}>
            <select
              value={settings.ducking}
              disabled={!hasAudio}
              onChange={(e) => setSettings((s) => ({ ...s, ducking: e.target.value }))}
              className="w-full px-2 py-1.5 rounded-xl border text-xs disabled:opacity-40"
              style={field}
            >
              {DUCKING_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Tooltip>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {dirty && (
          <Tooltip text="Re-render the preview with the new volume / ducking settings.">
            <button
              type="button" onClick={() => renderPreview(settings)} disabled={rendering}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)', color: '#fff' }}
            >
              Update preview
            </button>
          </Tooltip>
        )}
        <Tooltip text="Just the music, cut to your video's exact length with fades, as a WAV file.">
          <button
            type="button" onClick={() => exportFile(`${base}/audio`, 'music.wav', 'Audio')}
            className="px-3 py-1.5 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Export audio (WAV)
          </button>
        </Tooltip>
        <Tooltip text="Your video with this music mixed in, using the volume and ducking above. The picture is not re-encoded where possible.">
          <button
            type="button" onClick={() => exportFile(`${base}/video?${qs(settings)}`, 'video-with-music.mp4', 'Video')}
            className="px-3 py-1.5 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Export video (MP4)
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function MusicPageInner() {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const info = useToolInfoModal('vault_music_info_seen');
  const { startProcessing, stopProcessing, setProcessingSteps, updateProcessingDetail } = useProcessingStore();
  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState(null);
  const [file, setFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [clientDuration, setClientDuration] = useState(null);
  const [mood, setMood] = useState('lofi-chill');
  const [customPrompt, setCustomPrompt] = useState('');
  const [bpm, setBpm] = useState('');
  const [job, setJob] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const jobIdRef = useRef(null);
  const inputRef = useRef(null);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    api.get('/api/music/status').then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  // Settings → Music Tour opens /music?tour=1
  useEffect(() => {
    if (searchParams.get('tour') === '1') {
      const t = setTimeout(() => startMusicTour(), 400);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [searchParams]);

  // Object URL for the chosen video (immediate duration + a plain preview), revoked on change.
  useEffect(() => {
    if (!file) { setVideoUrl(null); setClientDuration(null); return undefined; }
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Poll the running job.
  useEffect(() => {
    if (!job || job.status !== 'running') return undefined;
    const t = setInterval(async () => {
      try {
        const res = await api.get(`/api/music/jobs/${job.id}`);
        if (!res.ok) throw new Error('Lost track of that job — generate again.');
        const next = await res.json();
        if (cancelledRef.current) return;
        setJob(next);
        if (next.status === 'running') {
          setProcessingSteps(musicProgressSteps(next));
        } else {
          stopProcessing();
          if (next.status === 'failed') addToast(next.error || 'Music generation failed', 'error');
          else addToast('Your music options are ready', 'success');
        }
      } catch (err) {
        stopProcessing();
        addToast(err.message, 'error');
        setJob((j) => (j ? { ...j, status: 'failed', error: err.message } : j));
      }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [job, addToast, setProcessingSteps, stopProcessing]);

  // Elapsed time in the progress modal, ticking every second while a job runs.
  useEffect(() => {
    if (job?.status !== 'running') return undefined;
    const tick = () => updateProcessingDetail(`Elapsed ${formatElapsed(Date.now() - startedAtRef.current)} · usually about a minute`);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [job?.status, job?.id, updateProcessingDetail]);

  // Best-effort cleanup of the server's temp files when leaving the page.
  useEffect(() => () => {
    stopProcessing();
    if (jobIdRef.current) api.delete(`/api/music/jobs/${jobIdRef.current}`).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moods = status?.moods || [];
  const presetBpm = moods.find((m) => m.id === mood)?.defaultBpm;
  const providerOk = status ? status.provider?.configured : true;
  const ffmpegOk = status ? status.ffmpeg : true;
  const tooLong = status && clientDuration && clientDuration > status.maxVideoSec;
  const canGenerate = Boolean(file) && providerOk && ffmpegOk && !submitting && job?.status !== 'running'
    && (mood !== 'custom' || customPrompt.trim()) && !tooLong;

  // Cancel from the progress modal: stop waiting and delete the job. The modal itself closes after this.
  // The provider has usually already been asked to compose, so that spend can't be undone.
  const cancelGeneration = useCallback(() => {
    cancelledRef.current = true;
    if (jobIdRef.current) {
      api.delete(`/api/music/jobs/${jobIdRef.current}`).catch(() => {});
      jobIdRef.current = null;
    }
    setJob(null);
    addToast('Cancelled. Anything already sent to the music provider may still be billed.', 'warn');
  }, [addToast]);

  const generate = async () => {
    setSubmitting(true);
    cancelledRef.current = false;
    startedAtRef.current = Date.now();
    startProcessing('Creating your music…', 'Uploading your video…', { onCancel: cancelGeneration });
    setProcessingSteps(musicProgressSteps(null).map((st, i) => (i === 0
      ? { ...st, label: 'Uploading your video…', status: 'active' }
      : { ...st, status: 'pending' })));
    try {
      if (jobIdRef.current) api.delete(`/api/music/jobs/${jobIdRef.current}`).catch(() => {});
      setJob(null);
      const fd = new FormData();
      fd.append('video', file);
      fd.append('mood', mood);
      if (customPrompt.trim()) fd.append('prompt', customPrompt.trim());
      if (bpm) fd.append('bpm', String(bpm));
      const res = await api.postForm('/api/music/jobs', fd);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start generating');
      if (cancelledRef.current) {
        // Cancelled while the upload was still in flight: throw the job away.
        api.delete(`/api/music/jobs/${data.id}`).catch(() => {});
        return;
      }
      jobIdRef.current = data.id;
      setJob(data);
      setProcessingSteps(musicProgressSteps(data));
    } catch (err) {
      stopProcessing();
      addToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        className="flex items-center justify-between gap-2 px-4 py-3 border-b shrink-0"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
            {getIcon('music', { size: 16 })}
          </div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Music</h1>
          <Tooltip text="Take a short guided tour of this page.">
            <button
              type="button"
              aria-label="Take the Music tour"
              onClick={() => { try { localStorage.removeItem(MUSIC_TOUR_KEY); } catch (_) { /* ignore */ } startMusicTour(); }}
              className="hover:opacity-60 transition-opacity duration-200"
              style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              {getIcon('compass', { size: 13 })}
            </button>
          </Tooltip>
          <Tooltip text="How Music works.">
            <button
              type="button"
              aria-label="How Music works"
              onClick={info.open}
              className="hover:opacity-60 transition-opacity duration-200"
              style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              {getIcon('info', { size: 13 })}
            </button>
          </Tooltip>
        </div>
        <p className="text-xs hidden sm:block" style={muted}>Instrumental background music cut to your video's exact length</p>
      </div>
        {info.show && (
          <ToolInfoModal title="How Music Works" onClose={info.close}>
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              Music writes instrumental background music for a video you provide, cut to its exact length — so it can end on your last frame instead of cutting off.
            </p>
            <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <p style={{ color: 'var(--color-text)' }}><strong>1 · Your video</strong> — choose the file. It is only used to read its length and to preview the mix. Up to five minutes.</p>
              <p style={{ color: 'var(--color-text)' }}><strong>2 · The music</strong> — pick a mood (upbeat vlog, cinematic tension, calm corporate, travel montage, suspense, documentary, lo-fi chill) or write your own description, with an optional tempo. Always instrumental — no vocals. You can speak the description with the mic.</p>
              <p style={{ color: 'var(--color-text)' }}><strong>3 · Three options</strong> — three variations are made so you can compare. Each fades in over about half a second and fades out over the last two seconds, and is previewed against your video.</p>
              <p style={{ color: 'var(--color-text)' }}><strong>Volume and ducking</strong> — set how loud the music is, and let it dip while people are talking (light or strong). The final mix is levelled to about -14 LUFS. Ducking needs a video that has its own sound.</p>
              <p style={{ color: 'var(--color-text)' }}><strong>Export</strong> — the music alone as a WAV, or your video with the music mixed in as an MP4.</p>
            </div>
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              Good to know: the music is created by an AI model through Replicate, so each generation has a small cost. Clips are about 30 seconds long, so for longer videos the music loops with smooth crossfades. Your video and the results are kept for about 90 minutes and then deleted — export what you want to keep.
            </p>
          </ToolInfoModal>
        )}
      <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {status && !ffmpegOk && (
          <p className="text-xs rounded-xl border p-3" style={{ borderColor: '#f59e0b', color: '#b45309' }}>ffmpeg is not available on this server, so music can't be fitted or mixed.</p>
        )}
        {status && !providerOk && (
          <p className="text-xs rounded-xl border p-3" style={{ borderColor: '#f59e0b', color: '#b45309' }}>{status.provider?.note || 'Music generation is not set up on this server.'}</p>
        )}

        <section className="rounded-2xl border p-4 space-y-3" style={card} data-tour="music-video">
          <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>1 · Your video</p>
          <input
            ref={inputRef} type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv" className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setJob(null); e.target.value = ''; }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip text="Choose the video you want music for. It is only used to read its length and to preview the mix.">
              <button
                type="button" onClick={() => inputRef.current?.click()}
                className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {file ? 'Choose a different video' : 'Choose video'}
              </button>
            </Tooltip>
            {file && <span className="text-xs" style={muted}>{file.name}{clientDuration ? ` · ${formatDuration(clientDuration)}` : ''}</span>}
          </div>
          {videoUrl && (
            <Tooltip text="Your video, exactly as you chose it — the music is not added to this preview.">
              <video
                src={videoUrl} controls className="w-full max-h-64 rounded-xl" style={{ background: '#000' }}
                onLoadedMetadata={(e) => setClientDuration(e.currentTarget.duration)}
              />
            </Tooltip>
          )}
          {tooLong && (
            <p className="text-xs" style={{ color: '#ef4444' }}>
              That video is {formatDuration(clientDuration)} — the limit is {formatDuration(status.maxVideoSec)}. Trim it first (Video Tools → Clip / trim).
            </p>
          )}
        </section>

        <section className="rounded-2xl border p-4 space-y-3" style={card} data-tour="music-mood">
          <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>2 · The music</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs" style={muted}>Mood</span>
              <Tooltip text="A ready-made description of the style. Choose Custom prompt to describe it yourself.">
                <select value={mood} onChange={(e) => setMood(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={field}>
                  {(moods.length ? moods : [{ id: 'lofi-chill', label: 'Lo-fi chill' }]).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </Tooltip>
            </label>
            <label className="block space-y-1">
              <span className="text-xs" style={muted}>Tempo in BPM (optional)</span>
              <Tooltip text="Leave blank to let the style decide. 40-220.">
                <input
                  type="number" min={40} max={220} value={bpm} onChange={(e) => setBpm(e.target.value)}
                  placeholder={presetBpm ? `e.g. ${presetBpm}` : 'e.g. 100'}
                  className="w-full px-2 py-2 rounded-xl border text-xs" style={field}
                />
              </Tooltip>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs" style={muted}>{mood === 'custom' ? 'Describe the music' : 'Extra direction (optional)'}</span>
            <Tooltip text={mood === 'custom' ? 'Describe the music you want — instruments, feel, pace. Type it or tap the mic and say it.' : 'Add anything the mood should also include or avoid. Optional — type it or tap the mic.'}>
              <div>
                <VoiceInput
                  type="textarea" append rows={2} value={customPrompt} onChange={setCustomPrompt}
                  label="Describe the music"
                  placeholder={mood === 'custom' ? 'e.g. slow, dreamy harp and soft strings, spacious and warm' : 'e.g. with soft rain sounds, no drums'}
                  className="!text-xs"
                />
              </div>
            </Tooltip>
          </label>
          <p className="text-xs" style={muted}>Always instrumental — no vocals. Three variations are generated so you can compare.</p>
          <Tooltip text="Generate three instrumental options cut to your video's length. Takes about a minute and a small per-generation cost.">
            <button
              type="button" onClick={generate} disabled={!canGenerate} data-tour="music-generate"
              className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
              style={{ background: 'var(--color-primary)', color: '#fff' }}
            >
              {submitting ? 'Starting…' : job?.status === 'running' ? 'Generating…' : job ? 'Generate again' : 'Generate 3 options'}
            </button>
          </Tooltip>
        </section>

        {job && (
          <section className="space-y-3" data-tour="music-options">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>3 · Your options · video is {formatDuration(job.durationS)}{job.hasAudio ? '' : ' · no sound of its own'}</p>
            </div>
            {job.status === 'failed' && <p className="text-xs" style={{ color: '#ef4444' }}>{job.error || 'Music generation failed.'}</p>}
            <div className="grid grid-cols-1 lg:grid-cols-1 gap-3">
              {job.options.map((o) => (
                <OptionCard key={`${job.id}-${o.n}`} jobId={job.id} option={o} hasAudio={job.hasAudio} durationS={job.durationS} />
              ))}
            </div>
            <p className="text-xs" style={muted}>Options are kept for about 90 minutes, then deleted — export what you want to keep.</p>
          </section>
        )}
      </div>
      </div>
    </div>
  );
}

export default function MusicPage() {
  const { user } = useAuthStore();
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  if (!(user?.isAdmin || featureAccess.music !== false)) return <Navigate to="/" replace />;
  return (
    <VoiceInputProvider lang="en-AU">
      <MusicPageInner />
    </VoiceInputProvider>
  );
}
