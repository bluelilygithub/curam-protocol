import React, { useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { NOTE_TIPS } from './noteTips.mjs';
import { ACCEPT, MAX_FILES, formatSize, isViewable, kindOf, ICONS } from './noteAttachments.mjs';

/** A small picture of an image file. The picture is fetched with the sign-in header (an <img src> cannot carry it) and dropped when the chip goes. */
function Thumb({ att, size }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let objectUrl;
    let cancelled = false;
    api.get(`/api/attachments/${att.id}/download`).then((r) => r.blob()).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {}); // a thumbnail is a nicety: without it the chip shows an icon
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [att.id]);
  return url ? <img src={url} alt="" className="rounded object-cover flex-shrink-0" style={{ width: size, height: size }} /> : null;
}

/** Show an image, PDF or text file in a new tab; save anything else. The tab is opened at once (a click is what lets a browser open one) and pointed at the file when it arrives. */
async function openFile(att) {
  const viewable = isViewable(att);
  const tab = viewable ? window.open('', '_blank') : null;
  try {
    const res = await api.get(`/api/attachments/${att.id}/download`);
    if (!res.ok) throw new Error('missing');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (tab) {
      tab.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url; a.download = att.filename;
      document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    if (tab) tab.close();
  }
}

function FileChip({ att, mobile, onRemove }) {
  const getIcon = useIcon();
  const [confirming, setConfirming] = useState(false);
  const kind = kindOf(att);
  const height = mobile ? 36 : 26;
  const chip = { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', minHeight: height };
  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs rounded-lg px-2" style={{ ...chip, borderColor: '#ef4444' }}>
        Remove {att.filename}?
        <button type="button" onClick={() => onRemove(att)} className="px-2 rounded font-medium hover:opacity-80 transition-opacity duration-200" style={{ background: '#ef4444', color: '#fff', minHeight: mobile ? 28 : 20 }}>Yes</button>
        <button type="button" onClick={() => setConfirming(false)} className="px-2 rounded hover:opacity-70 transition-opacity duration-200" style={{ border: '1px solid var(--color-border)', minHeight: mobile ? 28 : 20 }}>No</button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-lg text-xs min-w-0" style={{ ...chip, maxWidth: '100%' }}>
      <Tooltip text={NOTE_TIPS.attachOpen(att.filename, formatSize(att.sizeBytes), isViewable(att))}>
        <button type="button" onClick={() => openFile(att)} className="inline-flex items-center gap-1.5 pl-2 pr-1.5 min-w-0 hover:opacity-70 transition-opacity duration-200" style={{ minHeight: height }}>
          {kind === 'image' ? <Thumb att={att} size={mobile ? 24 : 18} /> : null}
          <span className="flex-shrink-0" style={{ color: 'var(--color-primary)' }}>{kind === 'image' ? null : getIcon(ICONS[kind], { size: 13 })}</span>
          <span className="truncate" style={{ maxWidth: mobile ? 150 : 200 }}>{att.filename}</span>
          <span className="flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{formatSize(att.sizeBytes)}</span>
        </button>
      </Tooltip>
      <Tooltip text={NOTE_TIPS.attachRemove}>
        <button type="button" onClick={() => setConfirming(true)} aria-label={`Remove ${att.filename}`} className="flex items-center justify-center hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)', minWidth: mobile ? 32 : 22, minHeight: height }}>{getIcon('x', { size: 12 })}</button>
      </Tooltip>
    </span>
  );
}

/**
 * The files on the open note: an Attach button (or drop files anywhere on the note, or paste them into the text), then a chip for each.
 *   attachments  [{ id, filename, mimeType, sizeBytes }]     uploading  true while files are being sent
 *   error        text to show (and a Dismiss)                onPick(files)  upload these      onRemove(att)  take one off
 */
export default function NoteFilesStrip({ attachments, uploading, error, mobile, onPick, onRemove, onClearError }) {
  const getIcon = useIcon();
  const input = useRef(null);
  const list = Array.isArray(attachments) ? attachments : [];
  const height = mobile ? 36 : 26;
  return (
    <div className="space-y-1" role="group" aria-label="Files on this note" data-tour="notes-attach">
      <div className="flex flex-wrap items-center gap-1.5">
        <Tooltip text={list.length >= MAX_FILES ? NOTE_TIPS.attachFull : NOTE_TIPS.attach}>
          <button
            type="button" disabled={uploading || list.length >= MAX_FILES} onClick={() => input.current?.click()}
            className="inline-flex items-center gap-1.5 text-xs rounded-lg px-2.5 hover:opacity-70 transition-opacity duration-200 disabled:opacity-40"
            style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-border)', minHeight: height }}
          >{getIcon('paperclip', { size: 13 })}{list.length ? 'Attach' : 'Attach files'}</button>
        </Tooltip>
        <input
          ref={input} type="file" multiple accept={ACCEPT} className="hidden" aria-label="Choose files to attach"
          onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ''; if (files.length) onPick(files); }}
        />
        {uploading && <span className="text-xs" style={{ color: 'var(--color-muted)' }} role="status">Attaching…</span>}
        {list.map((a) => <FileChip key={a.id} att={a} mobile={mobile} onRemove={onRemove} />)}
      </div>
      {error && (
        <p className="text-xs" style={{ color: '#ef4444' }} role="alert">
          {error}{' '}
          <button type="button" onClick={onClearError} className="underline hover:opacity-70 transition-opacity duration-200">Dismiss</button>
        </p>
      )}
    </div>
  );
}
