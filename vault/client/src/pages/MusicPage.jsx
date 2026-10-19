import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import Tooltip from '../components/Tooltip';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { startMusicTour, TOUR_KEY as MUSIC_TOUR_KEY } from '../utils/tours/musicTour';
import { musicProgressSteps, formatElapsed } from './music/musicProgress.mjs';
import { takeVideoHandoff } from '../utils/videoHandoff';
import OptionCard from './music/OptionCard';
import { shouldKeepJob, takeKeptJob } from './music/jobMemory.mjs';
import VoiceoverPanel from './music/VoiceoverPanel';
import MusicSidebar from './music/MusicSidebar';
import MusicTutorChat from './music/MusicTutorChat';
import MusicTimeline from './music/MusicTimeline';
import { negationTip } from './music/promptTips.mjs';
import { clampMusicStart, snapTime } from './music/timelineMath.mjs';
import { ToolHeader, ToolHelpModal } from './music/ToolHeader';
import { TOOL_GROUPS, DEFAULT_TOOL, groupOfTool } from './music/musicTools.mjs';
import { POLL_MS, card, field, muted, formatDuration } from './music/musicShared';

// Music (/music): pick a video, choose a mood (or describe the music), get 3 instrumental options
// cut to the video's exact length, preview each against the video, then export the audio (WAV) or the
// video with the music mixed in (ducked under speech). Generation runs on the server as a job; this
// page polls it. Laid out like Video Tools: a tool list on the left, one tool at a time on the right.
// The job lives here, so it survives switching tools. Docs: docs/music.md, docs/music-plan.md.

const DEFAULT_TUNE = { fadeInS: 0.5, fadeOutS: 2, startS: 0 };

function MusicPageInner({ videosOk }) {
  const addToast = useToastStore((s) => s.addToast);
  const info = useToolInfoModal('vault_music_info_seen');
  const { startProcessing, stopProcessing, setProcessingSteps, updateProcessingDetail } = useProcessingStore();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [tool, setTool] = useState(DEFAULT_TOOL);
  const [openGroup, setOpenGroup] = useState(groupOfTool(TOOL_GROUPS, DEFAULT_TOOL));
  const [search, setSearch] = useState('');
  const [helpTool, setHelpTool] = useState(null);

  const [status, setStatus] = useState(null);
  const [file, setFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [clientDuration, setClientDuration] = useState(null);
  const [mood, setMood] = useState('lofi-chill');
  const [customPrompt, setCustomPrompt] = useState('');
  const [bpm, setBpm] = useState('');
  const [job, setJob] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [trackFile, setTrackFile] = useState(null);
  const [lengthS, setLengthS] = useState(30); // "Music from a description": how long, in seconds
  const [seed, setSeed] = useState('');
  const [tune, setTune] = useState(DEFAULT_TUNE); // fades + where the music starts, as set on the sliders (applied with the button)
  const [snapToCuts, setSnapToCuts] = useState(true);
  const [aboutVideo, setAboutVideo] = useState(''); // "Not sure which mood?": a sentence about the video
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState(null); // { mood, label, bpm, why } from the last suggestion
  const [cutsFor, setCutsFor] = useState({ jobId: null, cuts: null }); // picture cuts of the current job's video
  const [voiceSettings, setVoiceSettings] = useState({ volume: 100, start: 0 });
  const trackInputRef = useRef(null);
  const mediaRef = useRef({}); // option number -> its <video>/<audio>, for "play from the same moment"
  const lastPlayedRef = useRef(null);
  const jobIdRef = useRef(null);
  const inputRef = useRef(null);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);

  const selectTool = useCallback((id) => {
    setTool(id);
    const g = groupOfTool(TOOL_GROUPS, id);
    if (g) setOpenGroup(g);
  }, []);

  // The tutor's "Open" buttons. A Music tool opens here; anything else is a Video Tools tool, opened on /videos.
  const openToolById = useCallback((id) => {
    const musicTool = id === 'add-music' ? 'score' : (id.startsWith('music-') ? id.slice(6) : null);
    if (musicTool) {
      if (TOOL_GROUPS.some((g) => g.tools.some((t) => t.id === musicTool))) selectTool(musicTool);
      return;
    }
    navigate(`/videos?tool=${encodeURIComponent(id)}`);
  }, [navigate, selectTool]);

  // /music?tool=voiceover opens that tool (used when the Video Tools tutor points here).
  useEffect(() => {
    const wanted = searchParams.get('tool');
    if (wanted && TOOL_GROUPS.some((g) => g.tools.some((t) => t.id === wanted))) selectTool(wanted);
  }, [searchParams, selectTool]);

  useEffect(() => {
    api.get('/api/music/status').then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  // A video sent over from Video Tools ("Add music").
  useEffect(() => {
    const handed = takeVideoHandoff();
    if (handed) setFile(handed);
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

  // The fine-tune sliders start from what the job has applied (or the defaults) whenever the job or its applied settings change.
  const appliedFit = job?.fit || DEFAULT_TUNE;
  useEffect(() => {
    setTune({ ...DEFAULT_TUNE, ...(job?.fit || {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, JSON.stringify(job?.fit || null)]);

  // Where the video's picture cuts, once the music is done (found on the server once and kept).
  useEffect(() => {
    if (!job || job.status !== 'done' || job.hasVideo === false || cutsFor.jobId === job.id) return;
    let live = true;
    api.get(`/api/music/jobs/${job.id}/cuts`)
      .then((r) => (r.ok ? r.json() : { cuts: [] }))
      .then((d) => { if (live) setCutsFor({ jobId: job.id, cuts: Array.isArray(d.cuts) ? d.cuts : [] }); })
      .catch(() => { if (live) setCutsFor({ jobId: job.id, cuts: [] }); });
    return () => { live = false; };
  }, [job?.id, job?.status, job?.hasVideo, cutsFor.jobId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Coming back from Video Tools ("Finish in Video Tools"): pick the kept job up again. The video file itself is not
  // remembered, so to generate again the person chooses it again; the options and previews work as before.
  useEffect(() => {
    const keptId = takeKeptJob();
    if (!keptId) return;
    api.get(`/api/music/jobs/${keptId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) { addToast('Those music options have expired — generate again.', 'warn'); return; }
        jobIdRef.current = j.id;
        setJob(j);
      })
      .catch(() => {});
  }, [addToast]);

  // Best-effort cleanup of the server's temp files when leaving the page (unless a result was just sent to Video Tools).
  useEffect(() => () => {
    stopProcessing();
    if (jobIdRef.current && !shouldKeepJob(jobIdRef.current)) api.delete(`/api/music/jobs/${jobIdRef.current}`).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Use my own track" is its own tool; the Score a video tool generates.
  const ownTrackMode = tool === 'own-track';
  const textMode = tool === 'text'; // no video: the music is made to a length
  const scoreVisible = tool === 'score' || tool === 'own-track' || tool === 'text';
  const toolLabel = TOOL_GROUPS.flatMap((g) => g.tools).find((t) => t.id === tool)?.label || 'Score a video';
  const minLen = status?.musicOnly?.minSec ?? 5;
  const maxLen = status?.musicOnly?.maxSec ?? 300;
  const lengthOk = Number.isFinite(lengthS) && lengthS >= minLen && lengthS <= maxLen;
  const moods = status?.moods || [];
  const presetBpm = moods.find((m) => m.id === mood)?.defaultBpm;
  const providerOk = status ? (ownTrackMode || status.provider?.configured) : true;
  const ffmpegOk = status ? status.ffmpeg : true;
  const tooLong = status && clientDuration && clientDuration > status.maxVideoSec;
  const canGenerate = (textMode ? lengthOk : Boolean(file)) && providerOk && ffmpegOk && !submitting && job?.status !== 'running'
    && (ownTrackMode ? Boolean(trackFile) : (mood !== 'custom' || customPrompt.trim())) && !(tooLong && !textMode);

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
    startProcessing(ownTrackMode ? 'Fitting your track…' : 'Creating your music…', textMode ? 'Starting…' : 'Uploading your video…', { onCancel: cancelGeneration });
    setProcessingSteps(musicProgressSteps(textMode ? { mode: 'music-only' } : null).map((st, i) => (i === 0
      ? { ...st, label: textMode ? 'Sending your description…' : 'Uploading your video…', status: 'active' }
      : { ...st, status: 'pending' })));
    try {
      if (jobIdRef.current) api.delete(`/api/music/jobs/${jobIdRef.current}`).catch(() => {});
      setJob(null);
      const fd = new FormData();
      if (textMode) fd.append('durationS', String(lengthS));
      else fd.append('video', file);
      if (ownTrackMode) {
        fd.append('track', trackFile);
      } else {
        fd.append('mood', mood);
        if (customPrompt.trim()) fd.append('prompt', customPrompt.trim());
        if (bpm) fd.append('bpm', String(bpm));
        if (seed.trim()) fd.append('seed', seed.trim());
      }
      const res = await api.postForm('/api/music/jobs', fd);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start generating');
      if (cancelledRef.current) {
        // Cancelled while the upload was still in flight: throw the job away.
        api.delete(`/api/music/jobs/${data.id}`).catch(() => {});
        return;
      }
      jobIdRef.current = data.id;
      setVoiceSettings({ volume: 100, start: 0 });
      setJob(data);
      setProcessingSteps(musicProgressSteps(data));
    } catch (err) {
      stopProcessing();
      addToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Make one option again, or add one more (same description). The job goes back to "running" and the poll above picks it up.
  const changeOptions = async (url, body, title) => {
    cancelledRef.current = false;
    startedAtRef.current = Date.now();
    startProcessing(title, 'Starting…');
    try {
      const res = await api.post(url, body);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start that');
      setJob(data);
      setProcessingSteps(musicProgressSteps(data));
    } catch (err) {
      stopProcessing();
      addToast(err.message, 'error');
    }
  };
  const remakeOption = (n) => changeOptions(`/api/music/jobs/${job.id}/options/${n}/regenerate`, {}, `Making a new version of option ${n + 1}…`);
  const addAnotherOption = () => changeOptions(`/api/music/jobs/${job.id}/options`, {}, 'Making another option…');

  // "Play from the same moment": start option n where the one that was playing is up to.
  const registerMedia = useCallback((n, el) => { if (el) mediaRef.current[n] = el; else delete mediaRef.current[n]; }, []);
  const markPlayed = useCallback((n) => { lastPlayedRef.current = n; }, []);
  const playFromHere = (n) => {
    const to = mediaRef.current[n];
    if (!to) return;
    const from = mediaRef.current[lastPlayedRef.current];
    const t = from ? from.currentTime : 0;
    if (from && from !== to) from.pause();
    try { to.currentTime = Number.isFinite(to.duration) ? Math.min(t, to.duration) : t; } catch (_) { /* not seekable yet */ }
    to.play().catch(() => {});
  };

  const suggestMood = async () => {
    setSuggesting(true);
    try {
      const res = await api.post('/api/music/suggest-mood', { description: aboutVideo });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not suggest a mood');
      setMood(data.mood);
      if (data.mood === 'custom') setCustomPrompt(data.prompt); // no ready-made mood fits: the description is written for them
      if (data.bpm) setBpm(String(data.bpm));
      setSuggestion(data);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSuggesting(false);
    }
  };

  const tuneChanged = ['fadeInS', 'fadeOutS', 'startS'].some((k) => Math.abs((tune[k] ?? 0) - (appliedFit[k] ?? 0)) > 0.04);
  const applyTune = () => changeOptions(`/api/music/jobs/${job.id}/fit`, tune, 'Applying your fades…');
  const cuts = cutsFor.jobId === job?.id ? cutsFor.cuts : null;
  const snapNow = () => {
    // one click: move the voice (and the music start, if it is not at the very start) onto the closest cut
    if (job?.voice) setVoiceSettings((v) => ({ ...v, start: snapTime(v.start, cuts, { withinS: 3 }) }));
    if (tune.startS > 0) setTune((t) => ({ ...t, startS: clampMusicStart(snapTime(t.startS, cuts, { withinS: 3 }), job.durationS) }));
  };

  const startTour = () => {
    try { localStorage.removeItem(MUSIC_TOUR_KEY); } catch (_) { /* ignore */ }
    startMusicTour();
  };

  return (
    <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
      <MusicSidebar
        tool={tool} onSelect={selectTool}
        search={search} onSearch={setSearch}
        openGroup={openGroup} onOpenGroup={setOpenGroup}
        onTour={startTour} onInfo={info.open}
      />

      {info.show && (
        <ToolInfoModal title="How Music Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Music writes instrumental background music for a video you provide, cut to its exact length — so it can end on your last frame instead of cutting off. The list on the left is arranged by what you are doing; hover over any item for a plain explanation, and press the (?) beside a title for more.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p style={{ color: 'var(--color-text)' }}><strong>1 · Your video</strong> — choose the file. It is only used to read its length and to preview the mix. Up to five minutes.</p>
            <p style={{ color: 'var(--color-text)' }}><strong>2 · The music</strong> — pick a mood (upbeat vlog, cinematic tension, calm corporate, travel montage, suspense, documentary, lo-fi chill) or write your own description, with an optional tempo. Always instrumental — no vocals. You can speak the description with the mic.</p>
            <p style={{ color: 'var(--color-text)' }}><strong>3 · Three options</strong> — three variations are made so you can compare. Each fades in over about half a second and fades out over the last two seconds, and is previewed against your video.</p>
            <p style={{ color: 'var(--color-text)' }}><strong>Volume and ducking</strong> — set how loud the music is, and let it dip while people are talking (light or strong). The final mix is levelled to about -14 LUFS. Ducking needs a video that has its own sound.</p>
            <p style={{ color: 'var(--color-text)' }}><strong>Use my own track</strong> — fit music you already have instead: it is looped or trimmed to your video, faded, and mixed the same way. No generation cost. Use music you have the rights to.</p>
            <p style={{ color: 'var(--color-text)' }}><strong>Voiceover</strong> — once your music is ready, add narration: type a script for an AI voice (small per-use cost), or upload a recording. Choose when it starts and how loud it is; the music and the video's own sound dip underneath it, and every option's preview and export includes it.</p>
            <p style={{ color: 'var(--color-text)' }}><strong>Export or save</strong> — the music alone as a WAV, your video with the music as an MP4, or save the video to Saved media to keep editing it in Video Tools.</p>
          </div>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Good to know: the music is created by an AI model through Replicate, so each generation has a small cost. Clips are about 30 seconds long, so for longer videos the music loops with smooth crossfades. Your video and the results are kept for about 90 minutes and then deleted — export what you want to keep.
          </p>
        </ToolInfoModal>
      )}

      <main className="flex-1 overflow-y-auto p-6 space-y-4 max-w-2xl">
        {status && !ffmpegOk && (
          <p className="text-xs rounded-xl border p-3" style={{ borderColor: '#f59e0b', color: '#b45309' }}>ffmpeg is not available on this server, so music can't be fitted or mixed.</p>
        )}
        {status && !providerOk && (
          <p className="text-xs rounded-xl border p-3" style={{ borderColor: '#f59e0b', color: '#b45309' }}>{status.provider?.note || 'Music generation is not set up on this server.'}</p>
        )}

        {/* Kept mounted (just hidden) while another tool is open, so the video, the previews and the job are still there on return. */}
        <div className={scoreVisible ? 'space-y-5' : 'hidden'}>
          <ToolHeader id={tool} label={toolLabel} onHelp={setHelpTool} />

          {textMode && (
            <section className="rounded-2xl border p-4 space-y-3" style={card} data-tour="music-video">
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>1 · How long</p>
              <div className="flex flex-wrap items-center gap-2">
                {[15, 30, 60, 120].filter((n) => n <= maxLen).map((n) => (
                  <button
                    key={n} type="button" onClick={() => setLengthS(n)}
                    className="px-3 py-1.5 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
                    style={{
                      borderColor: lengthS === n ? 'var(--color-primary)' : 'var(--color-border)',
                      color: lengthS === n ? 'var(--color-primary)' : 'var(--color-muted)',
                    }}
                  >
                    {n >= 60 ? `${n / 60} min` : `${n} sec`}
                  </button>
                ))}
                <Tooltip text={`How many seconds of music, from ${minLen} up to ${maxLen}. The music is cut to exactly this length with a fade in and out.`}>
                  <input
                    type="number" min={minLen} max={maxLen} value={lengthS}
                    onChange={(e) => setLengthS(e.target.value === '' ? NaN : Number(e.target.value))}
                    aria-label="Length in seconds"
                    className="w-24 px-2 py-1.5 rounded-xl border text-xs" style={field}
                  />
                </Tooltip>
                <span className="text-xs" style={muted}>seconds</span>
              </div>
              {!lengthOk && <p className="text-xs" style={{ color: '#ef4444' }}>Choose a length from {minLen} seconds to {formatDuration(maxLen)}.</p>}
              <p className="text-xs" style={muted}>Cut to exactly this length with a fade in and out. Clips are about 30 seconds, so a longer length loops with smooth crossfades.</p>
            </section>
          )}

          {!textMode && (
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
          )}

          <section className="rounded-2xl border p-4 space-y-3" style={card} data-tour="music-mood">
            <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>2 · The music</p>
            {ownTrackMode && (
              <div className="space-y-2">
                <input
                  ref={trackInputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" className="hidden"
                  onChange={(e) => { setTrackFile(e.target.files?.[0] || null); e.target.value = ''; }}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Tooltip text="Choose a music file you have the rights to use. If it is shorter than the video it loops with smooth crossfades; if longer it is trimmed and faded out.">
                    <button
                      type="button" onClick={() => trackInputRef.current?.click()}
                      className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      {trackFile ? 'Choose a different track' : 'Choose music file'}
                    </button>
                  </Tooltip>
                  {trackFile && <span className="text-xs" style={muted}>{trackFile.name}</span>}
                </div>
                <p className="text-xs" style={muted}>Looped or trimmed to your video's exact length with a short fade in and a 2 second fade out. Use music you have the rights to.</p>
              </div>
            )}
            {!ownTrackMode && (<>
              <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Need help choosing? (optional)</p>
                <p className="text-xs" style={muted}>Say what your video is about, or the sound you are after, and the assistant fills in the mood and tempo below, or writes the description for you. This box does not make music by itself.</p>
                <Tooltip text="Say what your video is about, or the sound you want, for example a slow cello in a cathedral. The assistant picks a mood, or writes a description if none of the moods fits, and fills them in below. You can change them. It only reads your words, not the video.">
                  <div>
                    <VoiceInput
                      type="textarea" append rows={2} value={aboutVideo} onChange={setAboutVideo}
                      label="Describe your video, or the sound you are after"
                      placeholder="e.g. a rainy day, I'd like something like a slow cello in a cathedral"
                      className="!text-xs"
                    />
                  </div>
                </Tooltip>
                <div className="flex flex-wrap items-center gap-3">
                  <Tooltip text="Fill in the mood and tempo below, or write the description, from what you wrote. Has a very small cost.">
                    <button
                      type="button" onClick={suggestMood} disabled={suggesting || aboutVideo.trim().length < 3}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                      style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                    >
                      {suggesting ? 'Thinking…' : 'Fill in the mood for me'}
                    </button>
                  </Tooltip>
                  {suggestion && (
                    <span className="text-xs" style={muted}>
                      {suggestion.mood === 'custom'
                        ? <>Wrote a description below{suggestion.bpm ? ` at ${suggestion.bpm} BPM` : ''}{suggestion.why ? ` — ${suggestion.why}` : ''}</>
                        : <>Chose <strong style={{ color: 'var(--color-text)' }}>{suggestion.label}</strong>{suggestion.bpm ? ` at ${suggestion.bpm} BPM` : ''}{suggestion.why ? ` — ${suggestion.why}` : ''}</>}
                    </span>
                  )}
                </div>
              </div>
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
              {negationTip(customPrompt) && <p className="text-xs" style={{ color: '#b45309' }}>{negationTip(customPrompt)}</p>}
              <label className="block space-y-1">
                <span className="text-xs" style={muted}>Seed (optional)</span>
                <Tooltip text="Leave blank for a fresh random result each time. To get a version you liked back, type its seed (shown on its card) with the same description and tempo: it comes back as option 1.">
                  <input
                    inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="e.g. 482913" className="w-full sm:w-48 px-2 py-2 rounded-xl border text-xs" style={field}
                  />
                </Tooltip>
              </label>
              <p className="text-xs" style={muted}>
                Always instrumental — no vocals. Three variations are generated so you can compare.
                {status?.costPerRunUsd ? ` Roughly $${(status.costPerRunUsd * 3).toFixed(2)} for the three.` : ''}
              </p>
            </>)}
            {!ownTrackMode && aboutVideo.trim().length > 2 && !suggestion && (
              <p className="text-xs" style={{ color: '#b45309' }}>What you wrote in “Need help choosing?” is only used when you press “Fill in the mood for me”. The music is made from the mood and description below.</p>
            )}
            <Tooltip text={ownTrackMode ? "Fit your track to your video's length and preview it mixed in. Quick, and no generation cost." : "Generate three instrumental options cut to your video's length. Takes about a minute and a small per-generation cost."}>
              <button
                type="button" onClick={generate} disabled={!canGenerate} data-tour="music-generate"
                className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)', color: '#fff' }}
              >
                {submitting ? 'Starting…' : job?.status === 'running' ? (ownTrackMode ? 'Fitting…' : 'Generating…') : ownTrackMode ? 'Fit my track' : job ? 'Generate again' : 'Generate 3 options'}
              </button>
            </Tooltip>
          </section>

          {job && (
            <section className="space-y-3" data-tour="music-options">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>3 · {job.source === 'upload' ? 'Your track' : 'Your options'} · {job.hasVideo === false ? `${formatDuration(job.durationS)} of music` : `video is ${formatDuration(job.durationS)}${job.hasAudio ? '' : ' · no sound of its own'}`}</p>
              </div>
              {job.status === 'failed' && <p className="text-xs" style={{ color: '#ef4444' }}>{job.error || 'Music generation failed.'}</p>}
              {job.status === 'done' && !job.voice && (
                <p className="text-xs" style={muted}>
                  Want narration?{' '}
                  <button
                    type="button" onClick={() => selectTool('voiceover')}
                    className="underline transition-opacity duration-200 hover:opacity-60"
                    style={{ color: 'var(--color-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
                  >
                    Add a voiceover
                  </button>
                </p>
              )}
              {job.options.filter((o) => o.status === 'ready').length > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs" style={muted}>Compare, from the same moment:</span>
                  {job.options.filter((o) => o.status === 'ready').map((o) => (
                    <Tooltip key={o.n} text={`Stop what is playing and start option ${o.n + 1} at the same point, so you can hear the difference.`}>
                      <button
                        type="button" onClick={() => playFromHere(o.n)}
                        className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      >
                        Play option {o.n + 1}
                      </button>
                    </Tooltip>
                  ))}
                </div>
              )}
              {job.status === 'done' && (
                <details className="rounded-2xl border p-4 space-y-3" style={card} open>
                  <summary className="text-xs font-semibold cursor-pointer" style={{ color: 'var(--color-text)' }}>Timeline and fine-tuning</summary>
                  <div className="space-y-3 pt-3">
                    <MusicTimeline
                      durationS={job.durationS} cuts={cuts} tune={tune}
                      voice={job.voice} voiceStart={voiceSettings.start} snap={snapToCuts && Boolean(cuts?.length)}
                      onVoiceStart={job.voice ? (t) => setVoiceSettings((v) => ({ ...v, start: t })) : undefined}
                      onMusicStart={(t) => setTune((x) => ({ ...x, startS: t }))}
                    />
                    {job.hasVideo !== false && (
                      <div className="flex flex-wrap items-center gap-3">
                        <Tooltip text="While dragging the voice or the start of the music, jump onto a picture cut when one is close, so a change lands on a cut.">
                          <label className="flex items-center gap-1.5 text-xs" style={muted}>
                            <input type="checkbox" checked={snapToCuts} onChange={(e) => setSnapToCuts(e.target.checked)} /> Snap to cuts
                          </label>
                        </Tooltip>
                        <Tooltip text="Move the voice (and the music start, if it is not at the very start) onto the closest picture cut within a few seconds.">
                          <button
                            type="button" onClick={snapNow} disabled={!cuts?.length}
                            className="px-2.5 py-1 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                          >
                            Snap to nearest cut
                          </button>
                        </Tooltip>
                        <span className="text-xs" style={muted}>
                          {cuts === null ? 'Looking for picture cuts…' : cuts.length ? `${cuts.length} picture cut${cuts.length === 1 ? '' : 's'} found` : 'No picture cuts found (a single shot)'}
                        </span>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {[
                        ['fadeInS', 'Fade in', 0, 10, 'How long the music takes to come up at its start.'],
                        ['fadeOutS', 'Fade out', 0, 15, 'How long the music takes to fade away at the end. It always ends exactly on the last frame.'],
                        ['startS', 'Music starts at', 0, Math.max(0, Math.floor((job.durationS - 1) * 10) / 10), 'Leave a quiet gap before the music begins. Drag the left edge of the Music bar above, or set it here.'],
                      ].map(([key, label, min, max, tip]) => (
                        <label key={key} className="block space-y-1">
                          <span className="text-xs" style={muted}>{label} · {(tune[key] ?? 0).toFixed(1)}s</span>
                          <Tooltip text={tip}>
                            <input
                              type="range" min={min} max={max} step={0.1} value={Math.min(max, tune[key] ?? 0)}
                              onChange={(e) => setTune((t) => ({ ...t, [key]: Number(e.target.value) }))}
                              className="w-full"
                            />
                          </Tooltip>
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Tooltip text="Fit every option again with these fades and start. Nothing new is made, so there is no cost; the previews update.">
                        <button
                          type="button" onClick={applyTune} disabled={!tuneChanged}
                          className="px-3 py-1.5 rounded-xl text-xs font-medium transition-opacity duration-200 hover:opacity-80 disabled:opacity-40"
                          style={{ background: 'var(--color-primary)', color: '#fff' }}
                        >
                          Apply to all options
                        </button>
                      </Tooltip>
                      <button
                        type="button" onClick={() => setTune({ ...DEFAULT_TUNE })} disabled={['fadeInS', 'fadeOutS', 'startS'].every((k) => tune[k] === DEFAULT_TUNE[k])}
                        className="px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                      >
                        Back to the defaults
                      </button>
                    </div>
                  </div>
                </details>
              )}
              <div className="grid grid-cols-1 gap-3">
                {job.options.map((o) => (
                  <OptionCard
                    key={`${job.id}-${o.n}`} jobId={job.id} option={o} hasAudio={job.hasAudio} durationS={job.durationS} source={job.source}
                    voice={job.voice} voiceSettings={voiceSettings} videosOk={videosOk}
                    hasVideo={job.hasVideo !== false} canRemake={job.source === 'generated' && job.status !== 'running'}
                    onRemake={remakeOption} onMedia={registerMedia} onPlayed={markPlayed}
                  />
                ))}
              </div>
              {job.source === 'generated' && job.status === 'done' && job.options.length < (status?.maxOptions || 6) && (
                <Tooltip text="Make one more option from the same description, with a new random seed. The ones you have stay as they are. Has a small cost.">
                  <button
                    type="button" onClick={addAnotherOption}
                    className="px-3 py-1.5 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    Make another option
                  </button>
                </Tooltip>
              )}
              <p className="text-xs" style={muted}>Results are kept for about 90 minutes, then deleted — export or save what you want to keep.</p>
            </section>
          )}
        </div>

        {tool === 'voiceover' && (
          <div className="space-y-4">
            <ToolHeader id="voiceover" label="Voiceover" onHelp={setHelpTool} />
            {job?.status === 'done' ? (
              <>
                <VoiceoverPanel job={job} status={status} onJobChange={setJob} voiceSettings={voiceSettings} onVoiceSettings={setVoiceSettings} />
                {job.voice && (
                  <button
                    type="button" onClick={() => selectTool(job.source === 'upload' ? 'own-track' : (job.hasVideo === false ? 'text' : 'score'))}
                    className="px-3 py-1.5 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
                    style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                  >
                    Hear it in the options →
                  </button>
                )}
              </>
            ) : (
              <section className="rounded-2xl border p-4 space-y-3" style={card}>
                <p className="text-xs" style={muted}>
                  {job?.status === 'running'
                    ? 'Your music is still being made. The voiceover can be added as soon as it is ready.'
                    : 'Make your music first — a voiceover is mixed over it, and the music dips while the voice speaks.'}
                </p>
                <button
                  type="button" onClick={() => selectTool('score')}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium border transition-opacity duration-200 hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  Go to Score a video
                </button>
              </section>
            )}
          </div>
        )}
      </main>

      <ToolHelpModal toolId={helpTool} onClose={() => setHelpTool(null)} />
      <MusicTutorChat currentTool={`music-${tool}`} onOpenTool={openToolById} />
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
      <MusicPageInner videosOk={Boolean(user?.isAdmin) || featureAccess.videos !== false} />
    </VoiceInputProvider>
  );
}
