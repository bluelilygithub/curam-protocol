import React, { useState, useRef } from 'react';
import { useGeminiNano } from '../hooks/useGeminiNano';
import { useIcon } from '../providers/IconProvider';

function ImageAIPanel({ onResult }) {
  const { isAvailable, generateImage, describeImage, isLoading, error } = useGeminiNano();
  const [tab, setTab] = useState('describe');
  const [prompt, setPrompt] = useState('');
  const [dragging, setDragging] = useState(false);
  const [generatedImage, setGeneratedImage] = useState(null);
  const [description, setDescription] = useState('');
  const fileInputRef = useRef(null);
  const getIcon = useIcon();

  if (!isAvailable) {
    return (
      <div
        className="p-3 rounded-lg border text-xs"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
      >
        <div className="flex items-center gap-2">
          {getIcon('alert-circle', { size: 14 })}
          <span>
            <strong>Gemini Nano</strong> is not available in this browser. Chrome 127+ with the Origin Trial enabled is required for on-device AI features.
          </span>
        </div>
      </div>
    );
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    const result = await generateImage(prompt);
    if (result) setGeneratedImage(result);
  };

  const handleDescribe = async (file) => {
    const result = await describeImage(file);
    if (result) {
      setDescription(result);
      onResult?.({ type: 'description', content: result, filename: file.name });
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleDescribe(file);
  };

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: 'var(--color-border)' }}>
        {['describe', 'generate'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
            style={{
              background: tab === t ? 'var(--color-bg)' : 'transparent',
              color: tab === t ? 'var(--color-primary)' : 'var(--color-muted)',
              borderBottom: tab === t ? `2px solid var(--color-primary)` : '2px solid transparent',
            }}
          >
            {t === 'describe' ? 'Describe Image' : 'Generate Image'}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === 'describe' && (
          <div>
            <div
              className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer"
              style={{
                borderColor: dragging ? 'var(--color-primary)' : 'var(--color-border)',
                background: dragging ? 'var(--color-bg)' : 'transparent',
              }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="flex justify-center mb-2 opacity-50" style={{ color: 'var(--color-muted)' }}>
                {getIcon('file-image', { size: 28 })}
              </div>
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                Drop an image or <span style={{ color: 'var(--color-primary)' }}>browse</span>
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files[0]; if (f) handleDescribe(f); e.target.value = ''; }}
            />
            {isLoading && (
              <p className="text-xs mt-2 text-center" style={{ color: 'var(--color-muted)' }}>Analyzing...</p>
            )}
            {description && (
              <div
                className="mt-3 p-3 rounded-lg text-xs"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}
              >
                {description}
              </div>
            )}
          </div>
        )}

        {tab === 'generate' && (
          <div>
            <div className="flex gap-2">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image to generate..."
                className="flex-1 px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleGenerate(); }}
              />
              <button
                onClick={handleGenerate}
                disabled={isLoading || !prompt.trim()}
                className="px-3 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: 'var(--color-primary)', opacity: isLoading ? 0.7 : 1 }}
              >
                {isLoading ? '...' : 'Generate'}
              </button>
            </div>
            {generatedImage && (
              <div className="mt-3">
                <img
                  src={generatedImage}
                  alt="Generated"
                  className="w-full rounded-lg"
                  style={{ border: `1px solid var(--color-border)` }}
                />
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-xs mt-2 text-red-500">{error}</p>
        )}
      </div>
    </div>
  );
}

export default ImageAIPanel;
