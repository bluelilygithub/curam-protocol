import React, { useState, useEffect } from 'react';
import api from '../utils/apiClient';

// Shared attachment display — used on touchpoints (ClientDetailPage) and
// tasks (TasksPage), backed by the generic /api/attachments/:id/download
// route (server/routes/attachments.js). Images get a small thumbnail
// (fetched as a blob since <img src> can't carry the auth header); every
// other type is a filename chip. Click either to open/download.
export default function AttachmentChip({ attachment, onDelete }) {
  const isImage = (attachment.mimeType || '').startsWith('image/');
  const [thumbUrl, setThumbUrl] = useState(null);

  useEffect(() => {
    if (!isImage) return;
    let objectUrl;
    let cancelled = false;
    api.get(`/api/attachments/${attachment.id}/download`)
      .then(r => r.blob())
      .then(blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbUrl(objectUrl);
      })
      .catch(() => {}); // thumbnail is cosmetic — silently fall back to the filename chip
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, isImage]);

  const open = async () => {
    try {
      const res = await api.get(`/api/attachments/${attachment.id}/download`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      // best-effort — nothing else to do if the file can't be fetched
    }
  };

  if (isImage && thumbUrl) {
    return (
      <span className="group/att relative inline-block">
        <img
          src={thumbUrl}
          alt={attachment.filename}
          onClick={open}
          className="w-12 h-12 object-cover rounded-lg border cursor-pointer"
          style={{ borderColor: 'var(--color-border)' }}
        />
        {onDelete && (
          <button
            onClick={() => onDelete(attachment)}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full text-[10px] opacity-0 group-hover/att:opacity-100 transition-opacity"
            style={{ background: '#ef4444', color: '#fff' }}
          >
            ✕
          </button>
        )}
      </span>
    );
  }

  return (
    <span
      className="group/att inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
      style={{ color: 'var(--color-muted)', borderColor: 'var(--color-border)' }}
    >
      <button onClick={open} className="hover:opacity-70">📎 {attachment.filename}</button>
      {onDelete && (
        <button
          onClick={() => onDelete(attachment)}
          className="opacity-0 group-hover/att:opacity-100 transition-opacity hover:opacity-60"
          style={{ color: '#ef4444' }}
        >
          ✕
        </button>
      )}
    </span>
  );
}
