import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
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
import VoiceoverPanel from './music/VoiceoverPanel';
import MusicSidebar from './music/MusicSidebar';
import { ToolHeader, ToolHelpModal } from './music/ToolHeader';
import { TOOL_GROUPS, DEFAULT_TOOL, groupOfTool } from './music/musicTools.mjs';
import { POLL_MS, card, field, muted, formatDuration } from './music/musicShared';

// Music (/music): pick a video, choose a mood (or describe the music), get 3 instrumental options
// cut to the video's exact length, preview each against the video, then export the audio (WAV) or the
// video with the music mixed in (ducked under speech). Generation runs on the server as a job; this
// page polls it. Laid out like Video Tools: a tool list on the left, one tool at a time on the right.
// The job lives here, so it survives switching tools. Docs: docs/music.md, docs/music-plan.md.

function MusicPageInner() {
  const addToast = useToastStore((s) => s.addToast);
  const info = useToolInfoModal('vault_music_info_seen');
  const { startProcessing, stopProcessing, setProcessingSteps, updateProcessingDetail } = useProcessingStore();
  const [searchParams] = useSearchParams();

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
  const [voiceSettings, setVoiceSettings] = useState({ volume: 100, start: 0 });
  const trackInputRef = useRef(null);
  const jobIdRef = useRef(null);
  const inputRef = useRef(null);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);

  const selectTool = useCallback((id) => {
    setTool(id);
    const g = groupOfTool(TOOL_GROUPS, id);
    if (g) setOpenGroup(g);
  }, []);

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

  // "Use my own track" is its own tool; the Score a video tool generates.
  const ownTrackMode = tool === 'own-track';
  const scoreVisible = tool === 'score' || tool === 'own-track';
  const moods = status?.moods || [];
  const presetBpm = moods.find((m) => m.id === mood)?.defaultBpm;
  const providerOk = status ? (ownTrackMode || status.provider?.configured) : true;
  const ffmpegOk = status ? status.ffmpeg : true;
  const tooLong = status && clientDuration && clientDuration > status.maxVideoSec;
  const canGenerate = Boolean(file) && providerOk && ffmpegOk && !submitting && job?.status !== 'running'
    && (ownTrackMode ? Boolean(trackFile) : (mood !== 'custom' || customPrompt.trim())) && !tooLong;

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
    startProcessing(ownTrackMode ? 'Fitting your track…' : 'Creating your music…', 'Uploading your video…', { onCancel: cancelGeneration });
    setProcessingSteps(musicProgressSteps(null).map((st, i) => (i === 0
      ? { ...st, label: 'Uploading your video…', status: 'active' }
      : { ...st, status: 'pending' })));
    try {
      if (jobIdRef.current) api.delete(`/api/music/jobs/${jobIdRef.current}`).catch(() => {});
      setJob(null);
      const fd = new FormData();
      fd.append('video', file);
      if (ownTrackMode) {
        fd.append('track', trackFile);
      } else {
        fd.append('mood', mood);
        if (customPrompt.trim()) fd.append('prompt', customPrompt.trim());
        if (bpm) fd.append('bpm', String(bpm));
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
          <ToolHeader
            id={tool === 'own-track' ? 'own-track' : 'score'}
            label={ownTrackMode ? 'Use my own track' : 'Score a video'}
            onHelp={setHelpTool}
          />

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
            </>)}
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
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>3 · {job.source === 'upload' ? 'Your track' : 'Your options'} · video is {formatDuration(job.durationS)}{job.hasAudio ? '' : ' · no sound of its own'}</p>
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
              <div className="grid grid-cols-1 gap-3">
                {job.options.map((o) => (
                  <OptionCard
                    key={`${job.id}-${o.n}`} jobId={job.id} option={o} hasAudio={job.hasAudio} durationS={job.durationS} source={job.source}
                    voice={job.voice} voiceSettings={voiceSettings}
                  />
                ))}
              </div>
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
                    type="button" onClick={() => selectTool(job.source === 'upload' ? 'own-track' : 'score')}
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
