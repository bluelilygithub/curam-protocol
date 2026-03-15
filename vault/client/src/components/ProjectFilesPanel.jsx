import React, { useEffect, useRef, useState } from 'react';
import FileList from './FileList';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useSettingsStore from '../store/settingsStore';
import api from '../utils/apiClient';

function formatLastFetched(ts) {
  if (!ts) return '';
  const diffDays = Math.floor((Date.now() - new Date(ts)) / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return `${diffDays}d ago`;
}

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function ProjectFilesPanel({ projectId, onClose, onAttach, onAttachUrl, sessionFileIds = [] }) {
  const getIcon = useIcon();
  const fileInputRef = useRef(null);
  const { allowedFileTypes } = useSettingsStore();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [listKey, setListKey] = useState(0);
  const [pinnedUrls, setPinnedUrls] = useState([]);

  useEffect(() => {
    if (!projectId) return;
    api.get(`/api/pinned-urls/${projectId}`)
      .then(r => r.json())
      .then(data => setPinnedUrls(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [projectId]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const token = useAuthStore.getState().token;
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/files/upload/${projectId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }
      setListKey(k => k + 1);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div
      className="flex-shrink-0 flex flex-col border-l overflow-hidden w-full sm:w-72 h-full"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          Project Files
        </span>
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept={allowedFileTypes}
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:opacity-70 transition-opacity"
            style={{ color: 'var(--color-primary)' }}
            title="Upload file to project"
          >
            {uploading ? getIcon('loader', { size: 14 }) : getIcon('upload', { size: 14 })}
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:opacity-70 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
            title="Close"
          >
            {getIcon('x', { size: 14 })}
          </button>
        </div>
      </div>

      {uploadError && (
        <p className="flex-shrink-0 text-xs px-4 py-2" style={{ color: '#ef4444' }}>{uploadError}</p>
      )}

      <p className="flex-shrink-0 text-xs px-4 py-2" style={{ color: 'var(--color-muted)' }}>
        Pin files to include them in every chat's context.
      </p>

      {/* File list + pinned pages */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <FileList key={listKey} projectId={projectId} onAttach={onAttach} sessionFileIds={sessionFileIds} />

        {pinnedUrls.length > 0 && (
          <div className="mt-3">
            <div
              className="pb-1 text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-muted)', opacity: 0.6 }}
            >
              Pinned Pages
            </div>
            {pinnedUrls.map(pu => (
              <div
                key={pu.id}
                className="flex items-start gap-2 py-2 border-b last:border-b-0"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <span className="flex-shrink-0 mt-0.5" style={{ fontSize: 13 }}>
                  {pu.isYoutube ? '📺' : '🌐'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {pu.title || pu.url}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>
                    {getDomain(pu.url)}{pu.lastFetchedAt ? ` · ${formatLastFetched(pu.lastFetchedAt)}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => onAttachUrl?.({ url: pu.url, title: pu.title || pu.url, content: pu.content || '' })}
                  className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--color-primary)' }}
                  title="Attach to chat"
                >
                  {getIcon('paperclip', { size: 12 })}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ProjectFilesPanel;
