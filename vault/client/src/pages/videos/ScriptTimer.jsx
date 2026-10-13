import React, { useState } from 'react';
import api from '../../utils/apiClient';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import Tooltip from '../../components/Tooltip';

/**
 * "I wrote a script, I have no timestamps." The script is sent to the server with the video/audio; the speech is listened to
 * once so each caption appears when its words are spoken (or, failing that, the script is spread evenly over the length). The
 * timed captions come back through `onTimed` for the page to put in its captions box, where they can still be checked and edited.
 *
 * Props: `file` (a File) or `libraryId` (a saved video) say what to listen to; `onTimed({ srt, method, note, captions })`.
 */
export default function ScriptTimer({ file = null, libraryId = '', onTimed, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const [script, setScript] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { kind: 'ok'|'warn'|'error', text }
  const haveMedia = Boolean(file || libraryId);
  // Times written in the script ([00:00 - 00:12] ...) are used as they are, so no file is needed to read them.
  const writtenTimes = /\[\s*\d{1,2}:\d{2}/.test(script);

  const run = async () => {
    if (!script.trim() || (!haveMedia && !writtenTimes) || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      if (file) fd.append('media', file);
      else fd.append('libraryId', String(libraryId));
      fd.append('script', script);
      const res = await api.postForm('/api/videos/time-script', fd);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not time the script');
      onTimed?.(data);
      setResult({
        kind: data.method === 'speech' || data.method === 'markers' ? 'ok' : 'warn',
        text: `${data.captions} captions made. ${data.note}`,
      });
    } catch (err) {
      setResult({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <Tooltip text="Use this if you wrote the words yourself and have no timestamps. Vault listens to the speech and shows each line when it is spoken.">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs font-semibold flex items-center gap-1 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-text)' }}
          aria-expanded={open}
        >
          {open ? '▾' : '▸'} I have a script, not captions
        </button>
      </Tooltip>
      {open && (
        <div className="space-y-2">
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Paste or say what is spoken. Start a new line wherever you want a new caption (long lines are split for you).
            Vault listens to the {file || libraryId ? 'recording' : 'file you choose'} and shows each line as it is said.
            If your script already has times written in it, like [00:12 - 00:30] before a paragraph, those times are used exactly as written and no listening is needed.
          </p>
          <Tooltip text="Your words, as they are spoken. Each new line becomes its own caption, and long lines are split for you. Use the microphone to say it instead of typing.">
            <div>
              <VoiceInput
                type="textarea"
                append
                rows={6}
                value={script}
                onChange={(v) => { setScript(v.slice(0, 60000)); setResult(null); }}
                placeholder="Paste your script here…"
                label="Your script"
                className="!text-xs"
              />
            </div>
          </Tooltip>
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip text={haveMedia || writtenTimes ? 'Work out when each line is shown and fill in the captions. You can check and edit them afterwards.' : 'Choose the video or audio file first, so there is speech to listen to. (Or put times like [00:00 - 00:12] in your script.)'}>
              <button
                type="button"
                onClick={run}
                disabled={!script.trim() || (!haveMedia && !writtenTimes) || busy}
                className="px-4 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70 disabled:opacity-40"
                style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
              >
                {busy ? 'Listening and timing…' : 'Time my script'}
              </button>
            </Tooltip>
            {!haveMedia && !writtenTimes && <span className="text-xs" style={{ color: '#b45309' }}>Choose the video or audio first.</span>}
          </div>
          {result && (
            <p
              className="text-xs"
              role="status"
              style={{ color: result.kind === 'error' ? '#ef4444' : result.kind === 'warn' ? '#b45309' : 'var(--color-text)' }}
            >
              {result.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
