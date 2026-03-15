import React, { useState, useRef } from 'react';
import { useIcon } from '../providers/IconProvider';
import useSettingsStore from '../store/settingsStore';
import useAuthStore from '../store/authStore';

function FileUploader({ projectId, onUpload }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const getIcon = useIcon();
  const { allowedFileTypes } = useSettingsStore();

  const upload = (file) => {
    setUploading(true);
    setProgress(0);
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    const token = useAuthStore.getState().token;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/files/upload/${projectId}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      setUploading(false);
      if (xhr.status === 201) {
        setProgress(100);
        setTimeout(() => setProgress(0), 1000);
        onUpload?.();
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          setError(data.error || 'Upload failed. Please try again.');
        } catch {
          setError('Upload failed. Please try again.');
        }
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setError('Upload error.');
    };

    xhr.send(formData);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) upload(file);
  };

  const handleFileInput = (e) => {
    const file = e.target.files[0];
    if (file) upload(file);
    e.target.value = '';
  };

  return (
    <div className="mb-4">
      <div
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${dragging ? 'border-primary' : ''}`}
        style={{
          borderColor: dragging ? 'var(--color-primary)' : 'var(--color-border)',
          background: dragging ? 'var(--color-surface)' : 'transparent',
        }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="flex justify-center mb-2 opacity-50" style={{ color: 'var(--color-muted)' }}>
          {getIcon('upload', { size: 24 })}
        </div>
        <p className="text-sm" style={{ color: 'var(--color-text)' }}>
          Drop a file or <span style={{ color: 'var(--color-primary)' }}>browse</span>
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          PDF, images, text, and code files (code files: 500KB limit)
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={allowedFileTypes}
        className="hidden"
        onChange={handleFileInput}
      />

      {uploading && (
        <div className="mt-2">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress}%`, background: 'var(--color-primary)' }}
            />
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Uploading... {progress}%
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs mt-2 text-red-500">{error}</p>
      )}
    </div>
  );
}

export default FileUploader;
