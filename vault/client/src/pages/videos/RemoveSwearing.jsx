import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';

// "Remove swearing" (Video Tools, Audio group). Give it a video, an audio file, a transcript, or a recording plus its transcript.
// Media runs as a background job on the server (word-by-word timing from Whisper on Replicate, then ffmpeg bleeps or silences each
// swear word); a transcript on its own is cleaned straight away at no cost. Server: server/services/cleanLanguage.js.

const btn = 'px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70';
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function RemoveSwearing({ ffmpegOk, aiOk, runJob, jobDetails, resultUrl, resultName, onUseResult }) {
  const addToast = useToastStore((s) => s.addToast);
  const mediaRef = useRef(null);
  const transcriptRef = useRef(null);
  const [media, setMedia] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [mode, setMode] = useState('bleep');
  const [style, setStyle] = useState('mask');
  const [mild, setMild] = useState(false);
  const [extra, setExtra] = useState('');
  const [allow, setAllow] = useState('');
  const [textResult, setTextResult] = useState(null); // transcript-only run: { text, format, found }
  const [busy, setBusy] = useState(false);

  const mediaUrl = useMemo(() => (media ? URL.createObjectURL(media) : ''), [media]);
  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, [mediaUrl]);
  const isVideo = media && /^video\//.test(media.type || '');

  const options = { mild: mild ? '1' : '0', extra, allow, style };

  const loadTranscriptFile = async (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { addToast('That transcript file is too big (over 2 MB).', 'error'); return; }
    setTranscript(await file.text());
  };

  const runMedia = async () => {
    const fd = new FormData();
    fd.append('media', media);
    fd.append('mode', mode);
    Object.entries(options).forEach(([k, v]) => fd.append(k, v));
    if (transcript.trim()) fd.append('transcript', transcript);
    setTextResult(null);
    await runJob('clean-language', fd, { label: 'Removing swearing…', resultFilename: isVideo ? 'clean.mp4' : 'clean.mp3', forTool: 'clean-language' });
  };

  const runTextOnly = async () => {
    setBusy(true);
    try {
      const res = await api.post('/api/videos/clean-language/text', { text: transcript, ...options });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not clean the transcript');
      setTextResult(data);
      addToast(data.found.length ? `Cleaned ${data.found.length} word${data.found.length === 1 ? '' : 's'}` : 'No swear words found', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); addToast('Copied', 'success'); } catch { addToast('Could not copy', 'error'); }
  };
  const download = (text, format) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-clean.${format === 'srt' ? 'srt' : 'txt'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // What to show as the cleaned transcript: from the media job, or from a transcript-only run.
  const media_done = jobDetails && resultUrl;
  const shownText = textResult ? textResult.text : (media_done ? jobDetails.transcript : '');
  const shownFormat = textResult ? textResult.format : (media_done ? jobDetails.transcriptFormat : 'text');

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        Give it a video or an audio file and it bleeps (or silences) each swear word, and gives you a clean transcript. Or give it just a
        transcript and it masks the words in it. Your originals are not changed.
      </p>

      <div className="space-y-2">
        <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>1. Video or audio (optional if you only have a transcript)</p>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip text="Choose a video (MP4, MOV and similar) or an audio file (MP3, M4A, WAV and similar).">
            <button type="button" onClick={() => mediaRef.current?.click()} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              {media ? 'Change file' : 'Choose video or audio'}
            </button>
          </Tooltip>
          {media && (
            <>
              <span className="text-xs truncate max-w-xs" style={{ color: 'var(--color-muted)' }}>{media.name}</span>
              <Tooltip text="Clear the file, to clean a transcript on its own.">
                <button type="button" onClick={() => setMedia(null)} className="text-xs hover:opacity-60" style={{ color: 'var(--color-muted)' }}>Remove</button>
              </Tooltip>
            </>
          )}
          <input ref={mediaRef} type="file" accept="video/*,audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac,.opus,.mp4,.mov,.mkv,.webm" className="hidden"
            onChange={(e) => { setMedia(e.target.files?.[0] || null); e.target.value = ''; }} />
        </div>
        {media && (isVideo
          ? <video src={mediaUrl} controls playsInline preload="metadata" className="w-full max-h-56 rounded-lg bg-black" />
          : <audio src={mediaUrl} controls className="w-full" />)}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>2. Transcript (optional with a video or audio file)</p>
        <VoiceInput type="textarea" rows={5} append value={transcript} onChange={setTranscript} label="Transcript"
          placeholder="Paste a transcript or captions (plain text or SRT). Leave empty to have the recording written out for you."
          className="w-full px-3 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip text="Load a transcript from a text (.txt) or subtitle (.srt, .vtt) file.">
            <button type="button" onClick={() => transcriptRef.current?.click()} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Load a transcript file</button>
          </Tooltip>
          <input ref={transcriptRef} type="file" accept=".txt,.srt,.vtt,text/plain" className="hidden" onChange={(e) => { loadTranscriptFile(e.target.files?.[0]); e.target.value = ''; }} />
          {media && transcript.trim() && (
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Your transcript&apos;s wording is kept; the recording is still listened to, to find when each word is said.</span>
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>3. How</p>
        {media && (
          <div className="flex flex-wrap gap-4 text-xs" style={{ color: 'var(--color-text)' }}>
            <Tooltip text="Silence each swear word and play a short beep over it, as on TV.">
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="clMode" checked={mode === 'bleep'} onChange={() => setMode('bleep')} /> Bleep</label>
            </Tooltip>
            <Tooltip text="Silence each swear word, with no beep.">
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="clMode" checked={mode === 'mute'} onChange={() => setMode('mute')} /> Silence</label>
            </Tooltip>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--color-text)' }}>
          <span style={{ color: 'var(--color-muted)' }}>In the transcript:</span>
          <Tooltip text="Keep the first letter: f***."><label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="clStyle" checked={style === 'mask'} onChange={() => setStyle('mask')} /> f***</label></Tooltip>
          <Tooltip text="Write [bleep] in place of the word."><label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="clStyle" checked={style === 'bleep'} onChange={() => setStyle('bleep')} /> [bleep]</label></Tooltip>
          <Tooltip text="Leave the word out altogether."><label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" name="clStyle" checked={style === 'remove'} onChange={() => setStyle('remove')} /> Remove it</label></Tooltip>
        </div>
        <Tooltip text="Strong swearing and slurs are always caught. Tick this to also catch milder words: damn, hell, crap, piss, bloody, bugger, arse.">
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
            <input type="checkbox" checked={mild} onChange={(e) => setMild(e.target.checked)} /> Also milder words (damn, hell, crap, bloody…)
          </label>
        </Tooltip>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <VoiceInput value={extra} onChange={setExtra} label="Also catch" placeholder="Also catch (commas; end with * for any ending)"
            className="w-full px-3 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
          <VoiceInput value={allow} onChange={setAllow} label="Never catch" placeholder="Never catch (for example a name like Dick)"
            className="w-full px-3 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
        </div>
      </div>

      {media ? (
        <div className="space-y-1">
          <Tooltip text={aiOk ? 'Listen to the recording word by word, bleep or silence each swear word, and give back a clean file and transcript. Small cost per run on the server\'s Replicate account; usually a minute or two.' : 'This needs the Replicate key on the server (REPLICATE_API_TOKEN). You can still clean a transcript on its own.'}>
            <button type="button" onClick={runMedia} disabled={!ffmpegOk || !aiOk}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
              {mode === 'bleep' ? 'Bleep the swearing' : 'Silence the swearing'}
            </button>
          </Tooltip>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Uses AI to hear each word: a small cost per run (a few cents a minute of sound).</p>
        </div>
      ) : (
        <Tooltip text="Mask the swear words in the transcript above. No AI and no cost.">
          <button type="button" onClick={runTextOnly} disabled={!transcript.trim() || busy}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
            Clean the transcript
          </button>
        </Tooltip>
      )}

      {(media_done || textResult) && (
        <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Result</p>
          {media_done && !textResult && (
            <>
              {jobDetails.isVideo
                ? <video src={resultUrl} controls playsInline preload="metadata" className="w-full max-h-64 rounded-lg bg-black" />
                : <audio src={resultUrl} controls className="w-full" />}
              <p className="text-xs" style={{ color: 'var(--color-text)' }}>
                {jobDetails.bleeped.length
                  ? `${jobDetails.mode === 'mute' ? 'Silenced' : 'Bleeped'} ${jobDetails.bleeped.length} word${jobDetails.bleeped.length === 1 ? '' : 's'}: ${jobDetails.bleeped.map((b) => `${b.word} (${fmtTime(b.start)})`).join(', ')}.`
                  : 'No swear words were heard, so the sound is unchanged.'}
              </p>
              {jobDetails.notHeard?.length > 0 && (
                <p className="text-xs" style={{ color: '#b45309' }}>
                  In your transcript but not clearly heard in the recording, so not bleeped: {jobDetails.notHeard.join(', ')}. Play those parts to check.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Tooltip text="Save the cleaned file to your computer.">
                  <a href={resultUrl} download={resultName} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Download {jobDetails.isVideo ? 'video' : 'audio'}</a>
                </Tooltip>
                {jobDetails.isVideo && onUseResult && (
                  <Tooltip text="Carry the cleaned video over to another tool, without downloading it.">
                    <button type="button" onClick={onUseResult} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Use in another tool</button>
                  </Tooltip>
                )}
              </div>
            </>
          )}
          {shownText && (
            <div className="space-y-2">
              <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                Clean transcript {media_done && !textResult ? `(${jobDetails.transcriptSource === 'yours' ? 'your wording' : 'written out from the recording, with timestamps'})` : ''}
              </p>
              <textarea readOnly value={shownText} rows={8} className="w-full px-3 py-2 rounded-xl border text-xs font-mono"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              <div className="flex flex-wrap gap-2">
                <Tooltip text="Copy the clean transcript."><button type="button" onClick={() => copy(shownText)} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Copy</button></Tooltip>
                <Tooltip text={shownFormat === 'srt' ? 'Save it as a subtitle file (.srt) for Caption studio or any player.' : 'Save it as a text file.'}>
                  <button type="button" onClick={() => download(shownText, shownFormat)} className={btn} style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Download {shownFormat === 'srt' ? '.srt' : '.txt'}</button>
                </Tooltip>
              </div>
              {textResult && (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {textResult.found.length ? `Cleaned: ${textResult.found.join(', ')}.` : 'No swear words found.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
