import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';
import useProjectStore from '../store/projectStore';
import api from '../utils/apiClient';

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileCard({ file, onDelete, onChat, onTogglePin }) {
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(!!file.pinned);
  const getIcon = useIcon();
  const isPdf = file.mimetype === 'application/pdf';
  const isImage = file.mimetype?.startsWith('image/');

  const handlePin = async () => {
    const res = await api.patch(`/api/files/${file.id}/pin`);
    const data = await res.json();
    setPinned(data.pinned);
    onTogglePin && onTogglePin(file.id, data.pinned);
  };

  return (
    <div
      className="p-3 rounded-lg border mb-2"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: 'var(--color-muted)', flexShrink: 0 }}>
            {isImage ? getIcon('file-image', { size: 16 }) : getIcon('file-text', { size: 16 })}
          </span>
          <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
            {file.name}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
            style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
          >
            {formatBytes(file.size)}
          </span>
          {isPdf && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 text-white"
              style={{ background: 'var(--color-primary)' }}
            >
              PDF
            </span>
          )}
          {pinned && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{ background: 'var(--color-primary)', color: '#fff', opacity: 0.85 }}
            >
              pinned
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Pin toggle */}
          <button
            onClick={handlePin}
            className="p-1 rounded hover:opacity-70 transition-opacity"
            style={{ color: pinned ? 'var(--color-primary)' : 'var(--color-muted)' }}
            title={pinned ? 'Unpin from context' : 'Pin to context (always included in system prompt)'}
          >
            {getIcon('pin', { size: 13 })}
          </button>
          {isPdf && (
            <button
              onClick={() => onChat(file)}
              className="text-xs px-2 py-1 rounded border flex items-center gap-1"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              title="Chat about this file"
            >
              {getIcon('chat', { size: 12 })}
              Chat
            </button>
          )}
          {isPdf && file.aiSummary && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 rounded"
              style={{ color: 'var(--color-muted)' }}
              title="Toggle summary"
            >
              {getIcon(expanded ? 'chevron-down' : 'chevron-right', { size: 14 })}
            </button>
          )}
          <button
            onClick={() => onDelete(file.id)}
            className="p-1 rounded hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
            title="Delete file"
          >
            {getIcon('trash', { size: 14 })}
          </button>
        </div>
      </div>

      {expanded && file.aiSummary && (
        <div
          className="mt-2 pt-2 border-t text-xs"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          <p className="font-semibold mb-1" style={{ color: 'var(--color-text)' }}>AI Summary</p>
          <p>{file.aiSummary}</p>
        </div>
      )}
    </div>
  );
}

function FileList({ projectId }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { activeProjectId } = useProjectStore();

  const fetchFiles = async () => {
    setLoading(true);
    const res = await api.get(`/api/files/${projectId}`);
    const data = await res.json();
    setFiles(data);
    setLoading(false);
  };

  useEffect(() => {
    if (projectId) fetchFiles();
  }, [projectId]);

  const handleDelete = async (id) => {
    await api.delete(`/api/files/${id}`);
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleChat = (file) => {
    // Store selected file in session storage for ChatPage to pick up
    sessionStorage.setItem('chatFileId', String(file.id));
    sessionStorage.setItem('chatFileName', file.name);
    navigate(`/projects/${projectId}/chat`);
  };

  if (loading) return <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading files...</p>;
  if (files.length === 0) return <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No files uploaded yet.</p>;

  return (
    <div>
      {files.map((file) => (
        <FileCard key={file.id} file={file} onDelete={handleDelete} onChat={handleChat} onTogglePin={() => {}} />
      ))}
    </div>
  );
}

export default FileList;
