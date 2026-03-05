import React, { useEffect, useRef, useState } from 'react';
import { useIcon } from '../providers/IconProvider';

const ACCEPTED = '.pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.json,.csv,.md';

function formatBytes(b) {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}

function ChatFilePicker({ projectId, onUpload, onAttachExisting, onClose, attachedIds = [] }) {
  const [projectFiles, setProjectFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);
  const panelRef = useRef(null);
  const getIcon = useIcon();

  useEffect(() => {
    if (projectId) {
      fetch(`/api/files/${projectId}`).then(r => r.json()).then(setProjectFiles);
    }
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [projectId]);

  const handleFiles = (files) => {
    Array.from(files).forEach(f => onUpload(f));
    onClose();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full mb-2 left-0 w-72 rounded-xl border shadow-xl overflow-hidden z-50"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      {/* Upload zone */}
      <div
        className="p-3 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div
          className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors"
          style={{
            borderColor: dragging ? 'var(--color-primary)' : 'var(--color-border)',
            background: dragging ? 'var(--color-bg)' : 'transparent',
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex justify-center mb-1.5" style={{ color: 'var(--color-primary)' }}>
            {getIcon('upload', { size: 18 })}
          </div>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
            Upload to project
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            PDF, images, text · 50MB max
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* Project files */}
      {projectFiles.length > 0 && (
        <div className="max-h-52 overflow-y-auto">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
            Project files
          </p>
          {projectFiles.map(file => {
            const isAttached = attachedIds.includes(file.id);
            const isImage = file.mimetype?.startsWith('image/');
            const isPdf = file.mimetype === 'application/pdf';
            return (
              <button
                key={file.id}
                onClick={() => { if (!isAttached) { onAttachExisting(file); onClose(); } }}
                disabled={isAttached}
                className="w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors hover:opacity-80"
                style={{
                  opacity: isAttached ? 0.4 : 1,
                  cursor: isAttached ? 'default' : 'pointer',
                }}
              >
                <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}>
                  {isImage ? getIcon('file-image', { size: 14 }) : getIcon('file-text', { size: 14 })}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {file.name}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {formatBytes(file.size)}{isPdf && file.aiSummary ? ' · has summary' : ''}
                  </p>
                </div>
                {isAttached && (
                  <span className="text-xs" style={{ color: 'var(--color-primary)' }}>
                    {getIcon('check', { size: 12 })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {projectFiles.length === 0 && (
        <p className="px-3 py-3 text-xs text-center" style={{ color: 'var(--color-muted)' }}>
          No files in this project yet
        </p>
      )}
    </div>
  );
}

export default ChatFilePicker;
