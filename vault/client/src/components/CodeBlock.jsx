import React, { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Clipboard, Check } from 'lucide-react';

const BG = '#0F1923';
const BORDER = '#1B3A5C';
const TEAL = '#0D7B8A';
const TEXT = '#E2E8F0';
const MUTED = '#64748B';

function CodeBlock({ language, code }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="not-prose"
      style={{
        background: BG,
        border: `1px solid ${BORDER}`,
        borderRadius: '8px',
        overflow: 'hidden',
        margin: '0.75em 0',
      }}
    >
      {/* Header bar — language label + copy button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 12px',
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <span
          style={{
            color: TEAL,
            fontSize: '11px',
            fontFamily: 'monospace',
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: copied ? TEAL : MUTED,
            fontSize: '11px',
            padding: '2px 6px',
            borderRadius: '4px',
            transition: 'color 0.15s',
          }}
          title="Copy code"
        >
          {copied ? <Check size={12} /> : <Clipboard size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Code content */}
      {language ? (
        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: 0,
            backgroundColor: BG,
            padding: '16px',
            fontSize: '13px',
            fontFamily: 'monospace',
            color: TEXT,
          }}
        >
          {code}
        </SyntaxHighlighter>
      ) : (
        <pre
          style={{
            margin: 0,
            padding: '16px',
            backgroundColor: BG,
            color: TEXT,
            fontSize: '13px',
            fontFamily: 'monospace',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

export default CodeBlock;
