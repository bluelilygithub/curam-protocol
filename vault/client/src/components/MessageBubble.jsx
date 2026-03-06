import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useIcon } from '../providers/IconProvider';
import { downloadResponseMd } from '../utils/exportMd';

// Parse "[Files: a.pdf, b.jpg]\nuser text" stored in history messages
function parseFilesPrefix(content) {
  const match = content?.match(/^\[Files: ([^\]]+)\]\n?([\s\S]*)$/);
  if (!match) return { fileNames: [], text: content };
  return {
    fileNames: match[1].split(', ').map(s => s.trim()),
    text: match[2].trim(),
  };
}

function MessageBubble({ message, onDelete, onOpenArtifact, artifactCount, onBranch, messageIndex }) {
  const isUser = message.role === 'user';
  const [showThinking, setShowThinking] = useState(false);
  const getIcon = useIcon();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (isUser) {
    // Live attachments (current session) take priority; fall back to parsing history text
    const liveAttachments = message.attachments || [];
    const { fileNames: historyFileNames, text: parsedText } = liveAttachments.length === 0
      ? parseFilesPrefix(message.content)
      : { fileNames: [], text: message.content };

    const displayText = parsedText;
    const images = liveAttachments.filter(a => a.mimetype?.startsWith('image/') && a.preview);
    const nonImageLive = liveAttachments.filter(a => !a.mimetype?.startsWith('image/') || !a.preview);

    return (
      <div className="flex justify-end mb-5">
        <div className="max-w-[75%] flex flex-col gap-1.5 items-end">
          {/* Image thumbnails from live session */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-end">
              {images.map(att => (
                <img
                  key={att.id}
                  src={att.preview}
                  alt={att.name}
                  className="w-24 h-24 rounded-xl object-cover border"
                  style={{ borderColor: 'rgba(255,255,255,0.3)' }}
                />
              ))}
            </div>
          )}
          {/* Non-image live attachments */}
          {nonImageLive.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-end">
              {nonImageLive.map(att => (
                <span
                  key={att.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
                  style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
                >
                  📎 {att.name}
                </span>
              ))}
            </div>
          )}
          {/* History file names (loaded from DB) */}
          {historyFileNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-end">
              {historyFileNames.map((name, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
                  style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
                >
                  📎 {name}
                </span>
              ))}
            </div>
          )}
          {/* Message text */}
          {displayText ? (
            <div
              className="px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
              style={{ background: 'var(--color-primary)', color: '#fff' }}
            >
              <p className="whitespace-pre-wrap">{displayText}</p>
            </div>
          ) : null}

          {/* Delete + Branch controls */}
          <div className="flex items-center gap-2">
            {onBranch && (
              <button
                onClick={() => onBranch(messageIndex)}
                className="self-end opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity flex items-center gap-1 text-xs"
                style={{ color: 'var(--color-muted)' }}
                title="Branch conversation from here"
              >
                {getIcon('git-branch', { size: 11 })}
              </button>
            )}
            {onDelete && (
              confirmingDelete ? (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                  <span>Delete this exchange?</span>
                  <button
                    onClick={() => { onDelete(); setConfirmingDelete(false); }}
                    className="font-medium"
                    style={{ color: '#ef4444' }}
                  >
                    Delete
                  </button>
                  <button onClick={() => setConfirmingDelete(false)}>Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="self-end opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity flex items-center gap-1 text-xs"
                  style={{ color: 'var(--color-muted)' }}
                  title="Delete this prompt &amp; response"
                >
                  {getIcon('trash', { size: 11 })}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-5 gap-3 group">
      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold"
        style={{ background: 'var(--color-surface)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}
      >
        ✦
      </div>

      <div className="flex-1 min-w-0 relative">
        {/* Action buttons — appear on hover */}
        {message.content && (
          <div className="absolute -top-1 right-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onOpenArtifact && artifactCount > 0 && (
              <button
                onClick={() => onOpenArtifact(0)}
                className="flex items-center gap-1 h-6 px-2 rounded-md text-xs font-medium"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-primary)' }}
                title="Open in Artifacts panel"
              >
                {getIcon('external-link', { size: 10 })}
                {artifactCount > 1 ? `${artifactCount} artifacts` : 'Artifact'}
              </button>
            )}
            <button
              onClick={() => downloadResponseMd(message.content)}
              className="w-6 h-6 flex items-center justify-center rounded-md"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
              title="Save response as Markdown"
            >
              {getIcon('file-down', { size: 11 })}
            </button>
          </div>
        )}
        {/* Reasoning / thinking block */}
        {message.thinking && (
          <div className="mb-2">
            <button
              onClick={() => setShowThinking(v => !v)}
              className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
            >
              {getIcon('cpu', { size: 11 })}
              {showThinking ? 'Hide reasoning' : 'Show reasoning'}
            </button>
            {showThinking && (
              <div
                className="mt-2 px-3 py-2.5 rounded-xl text-xs leading-relaxed whitespace-pre-wrap border-l-2"
                style={{ color: 'var(--color-muted)', borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}
              >
                {message.thinking}
              </div>
            )}
          </div>
        )}

        {message.content === '' && !message.thinking ? (
          <div className="flex items-center gap-1.5 py-3" style={{ color: 'var(--color-muted)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '300ms' }} />
          </div>
        ) : message.content === '' ? null : (
          <div
            className="prose prose-sm max-w-none text-sm leading-relaxed"
            style={{ color: 'var(--color-text)' }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ node, inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  return !inline && match ? (
                    <SyntaxHighlighter
                      style={oneDark}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{ borderRadius: '10px', fontSize: '0.8em', margin: '0.75em 0' }}
                      {...props}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  ) : (
                    <code
                      style={{
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.83em',
                      }}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="mb-3 pl-4 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="mb-3 pl-4 space-y-1">{children}</ol>,
                li: ({ children }) => <li className="list-disc">{children}</li>,
                h1: ({ children }) => <h1 className="text-base font-semibold mt-4 mb-2">{children}</h1>,
                h2: ({ children }) => <h2 className="text-sm font-semibold mt-3 mb-1.5">{children}</h2>,
                h3: ({ children }) => <h3 className="text-sm font-medium mt-2 mb-1">{children}</h3>,
                blockquote: ({ children }) => (
                  <blockquote
                    className="border-l-2 pl-3 my-2"
                    style={{ borderColor: 'var(--color-primary)', color: 'var(--color-muted)' }}
                  >
                    {children}
                  </blockquote>
                ),
                a: ({ href, children, ...props }) => {
                  const isExternal = href?.startsWith('http://') || href?.startsWith('https://');
                  return (
                    <a href={href} {...(isExternal && { target: '_blank', rel: 'noopener noreferrer' })} {...props}>
                      {children}
                    </a>
                  );
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

export default MessageBubble;
