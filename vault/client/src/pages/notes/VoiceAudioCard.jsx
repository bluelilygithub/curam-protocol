import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { NOTE_TIPS } from './noteTips.mjs';
import { formatSize } from './noteAttachments.mjs';
import { describeKept } from './voiceNoteUtils.mjs';

/**
 * The recording a voice note was made from, when the person chose to keep it: a play button (the audio is only fetched when asked, so a
 * phone on mobile data does not download it just by opening the note), how long it will stay, and the two choices that matter: keep it for
 * good, or remove it now. `onKeep(att, 'forever')` and `onRemove(att)` do the work (useNoteAttachments.js).
 */
export default function VoiceAudioCard({ att, mobile, onKeep, onRemove }) {
  const getIcon = useIcon();
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState('');
  const [confirming, setConfirming] = useState(false);
  const height = mobile ? 40 : 28;

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function load() {
    setLoading(true);
    setProblem('');
    try {
      const res = await api.get(`/api/attachments/${att.id}/download`);
      if (!res.ok) throw new Error('missing');
      setUrl(URL.createObjectURL(await res.blob()));
    } catch {
      setProblem('The recording could not be loaded. It may have been removed.');
    } finally {
      setLoading(false);
    }
  }

  const btn = { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', minHeight: height };
  const expiring = Boolean(att.expiresAt);
  return (
    <div className="rounded-lg p-2 space-y-1.5" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} role="group" aria-label="Voice recording">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span style={{ color: 'var(--color-primary)' }}>{getIcon('audio-lines', { size: 14 })}</span>
        <span className="font-medium" style={{ color: 'var(--color-text)' }}>Recording</span>
        <span style={{ color: 'var(--color-muted)' }}>{formatSize(att.sizeBytes)}</span>
        <span style={{ color: expiring ? '#b45309' : 'var(--color-muted)' }}>{describeKept(att.expiresAt)}</span>
      </div>
      {url ? (
        <audio controls autoPlay src={url} className="w-full" style={{ height: mobile ? 44 : 36 }} />
      ) : (
        <Tooltip text={NOTE_TIPS.voicePlay}>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 text-xs rounded-lg px-3 hover:opacity-70 transition-opacity duration-200 disabled:opacity-50" style={btn}>
            {getIcon('play', { size: 13 })}{loading ? 'Loading…' : 'Play the recording'}
          </button>
        </Tooltip>
      )}
      {problem && <p className="text-xs" style={{ color: '#ef4444' }} role="alert">{problem}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {expiring && (
          <Tooltip text={NOTE_TIPS.voiceKeepForGood}>
            <button type="button" onClick={() => onKeep(att, 'forever')} className="text-xs rounded-lg px-3 hover:opacity-70 transition-opacity duration-200" style={btn}>Keep it for good</button>
          </Tooltip>
        )}
        {confirming ? (
          <span className="inline-flex items-center gap-1.5 text-xs">
            Remove the recording?
            <button type="button" onClick={() => onRemove(att)} className="px-2 rounded font-medium hover:opacity-80 transition-opacity duration-200" style={{ background: '#ef4444', color: '#fff', minHeight: mobile ? 32 : 22 }}>Yes</button>
            <button type="button" onClick={() => setConfirming(false)} className="px-2 rounded hover:opacity-70 transition-opacity duration-200" style={{ border: '1px solid var(--color-border)', minHeight: mobile ? 32 : 22 }}>No</button>
          </span>
        ) : (
          <Tooltip text={NOTE_TIPS.voiceRemoveAudio}>
            <button type="button" onClick={() => setConfirming(true)} className="text-xs rounded-lg px-3 hover:opacity-70 transition-opacity duration-200" style={btn}>Remove the recording</button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
