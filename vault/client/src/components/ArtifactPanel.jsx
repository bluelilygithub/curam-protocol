import React, { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { X, Copy, Check, ChevronLeft, ChevronRight } from 'lucide-react';

function ArtifactPanel({ artifacts, initialIndex = 0, onClose }) {
  const [idx, setIdx] = useState(Math.min(initialIndex, artifacts.length - 1));
  const [copied, setCopied] = useState(false);

  const artifact = artifacts[idx];
  if (!artifact) return null;

  const isHtml = ['html', 'svg'].includes(artifact.language?.toLowerCase());

  const handleCopy = () => {
    navigator.clipboard.writeText(artifact.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="flex flex-col border-l h-full overflow-hidden w-full sm:w-[45%]"
      style={{ minWidth: '320px', borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <span
          className="text-xs font-mono px-2 py-0.5 rounded-md"
          style={{ background: 'var(--color-bg)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}
        >
          {artifact.language || 'code'}
        </span>

        {artifacts.length > 1 && (
          <div className="flex items-center gap-1 ml-1">
            <button
              onClick={() => setIdx(i => Math.max(0, i - 1))}
              disabled={idx === 0}
              className="w-5 h-5 flex items-center justify-center rounded disabled:opacity-30"
              style={{ color: 'var(--color-muted)' }}
            >
              <ChevronLeft size={13} />
            </button>
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{idx + 1}/{artifacts.length}</span>
            <button
              onClick={() => setIdx(i => Math.min(artifacts.length - 1, i + 1))}
              disabled={idx === artifacts.length - 1}
              className="w-5 h-5 flex items-center justify-center rounded disabled:opacity-30"
              style={{ color: 'var(--color-muted)' }}
            >
              <ChevronRight size={13} />
            </button>
          </div>
        )}

        <div className="flex-1" />

        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors hover:opacity-70"
          style={{ borderColor: 'var(--color-border)', color: copied ? 'var(--color-primary)' : 'var(--color-muted)' }}
          title="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>

        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
          style={{ color: 'var(--color-muted)' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {isHtml ? (
          <iframe
            srcDoc={artifact.code}
            sandbox="allow-scripts allow-same-origin"
            className="w-full h-full border-0"
            title="Artifact preview"
          />
        ) : (
          <div className="h-full overflow-auto text-xs">
            <SyntaxHighlighter
              language={artifact.language || 'text'}
              style={oneDark}
              customStyle={{ margin: 0, height: '100%', borderRadius: 0, fontSize: '12px' }}
              showLineNumbers
            >
              {artifact.code}
            </SyntaxHighlighter>
          </div>
        )}
      </div>
    </div>
  );
}

// Utility: extract code blocks from markdown text
export function extractCodeBlocks(text) {
  const re = /```(\w+)?\n([\s\S]*?)```/g;
  const blocks = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[2].trim().length > 40) {
      blocks.push({ language: (m[1] || 'text').toLowerCase(), code: m[2].trim() });
    }
  }
  return blocks;
}

export default ArtifactPanel;
