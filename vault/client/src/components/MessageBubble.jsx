import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useIcon } from '../providers/IconProvider';
import { downloadResponseMd } from '../utils/exportMd';
import { mdComponents } from '../utils/mdComponents';
import { extractCodeBlocks } from './ArtifactPanel';

// Parse "[Files: a.pdf, b.jpg]\nuser text" stored in history messages
function parseFilesPrefix(content) {
  const match = content?.match(/^\[Files: ([^\]]+)\]\n?([\s\S]*)$/);
  if (!match) return { fileNames: [], text: content };
  return {
    fileNames: match[1].split(', ').map(s => s.trim()),
    text: match[2].trim(),
  };
}

const COLLAPSE_CHAR_THRESHOLD = 2500;
const COLLAPSED_HEIGHT = 220; // px

function MessageBubble({ message, onDelete, onOpenArtifact, onBranch, messageIndex, searching, bookmarked, onToggleBookmark, isLatest, isSpeaking, isPaused, onSpeak, onPause, onResume, onStop, markdownVariant = 'default' }) {
  const isUser = message.role === 'user';
  const [showThinking, setShowThinking] = useState(false);
  const getIcon = useIcon();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Compute code blocks only when message content changes (not on every parent re-render)
  const codeBlocks = useMemo(
    () => message.role === 'assistant' ? extractCodeBlocks(message.content) : [],
    [message.role, message.content]
  );

  // Collapse logic — never collapse if content has a code block or is the latest message
  const hasCodeBlock = useMemo(() => /```/.test(message.content ?? ''), [message.content]);
  const canCollapse = !isUser && !hasCodeBlock && (message.content?.length ?? 0) > COLLAPSE_CHAR_THRESHOLD;

  // null = use default (collapse non-latest long messages); true/false = explicit user toggle
  const [userCollapsed, setUserCollapsed] = useState(null);
  const collapsed = canCollapse && (userCollapsed !== null ? userCollapsed : !isLatest);

  const remarkPlugins = useMemo(
    () => (markdownVariant === 'comfortable' ? [remarkGfm, remarkBreaks] : [remarkGfm]),
    [markdownVariant]
  );
  const proseWrapClass = markdownVariant === 'comfortable'
    ? 'prose prose-base max-w-none text-[15px] leading-relaxed'
    : 'prose prose-sm max-w-none text-sm leading-relaxed';

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
                  style={{ background: 'var(--color-primary)', color: '#fff' }}
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
                  style={{ background: 'var(--color-primary)', color: '#fff' }}
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
              data-message-content
            >
              <p className="whitespace-pre-wrap">{displayText}</p>
            </div>
          ) : null}

          {/* Delete + Branch + Bookmark controls */}
          <div className="flex items-center gap-2">
            {message.id && onToggleBookmark && (
              <button
                onClick={() => onToggleBookmark(message.id)}
                className="self-end opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity flex items-center gap-1 text-xs"
                style={{ color: bookmarked ? '#f59e0b' : 'var(--color-muted)' }}
                title={bookmarked ? 'Remove bookmark' : 'Bookmark this message'}
              >
                {getIcon('star', { size: 11, fill: bookmarked ? 'currentColor' : 'none' })}
              </button>
            )}
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
                    onClick={() => { onDelete(messageIndex); setConfirmingDelete(false); }}
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

      <div className="flex-1 min-w-0">
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
          searching ? (
            <div className="flex items-center gap-2 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>
              {getIcon('globe', { size: 13 })}
              Searching the web…
            </div>
          ) : (
          <div className="flex items-center gap-1.5 py-3" style={{ color: 'var(--color-muted)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--color-primary)', animationDelay: '300ms' }} />
          </div>
          )
        ) : message.content === '' ? null : (
          <div data-message-content>
            <div className="relative">
              <div
                className={proseWrapClass}
                style={{
                  color: 'var(--color-text)',
                  ...(collapsed ? { maxHeight: `${COLLAPSED_HEIGHT}px`, overflow: 'hidden' } : {}),
                }}
              >
                <ReactMarkdown
                  remarkPlugins={remarkPlugins}
                  components={mdComponents}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
              {collapsed && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
                  style={{ background: 'linear-gradient(to bottom, transparent, var(--color-bg))' }}
                />
              )}
            </div>
            {canCollapse && (
              <button
                onClick={() => setUserCollapsed(!collapsed)}
                className="mt-2 flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-primary)' }}
              >
                {collapsed ? 'Show more' : 'Show less'}
                {collapsed
                  ? getIcon('chevron-down', { size: 12 })
                  : getIcon('chevron-up', { size: 12 })}
              </button>
            )}
          </div>
        )}

        {/* Timestamp — always visible below content */}
        {message.content && message.receivedAt && (
          <div className="mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
            {new Date(message.receivedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
          </div>
        )}

        {/* Action buttons — appear on hover (always visible while speaking) */}
        {message.content && (
          <div className={`flex items-center gap-1 mt-1.5 transition-opacity${isSpeaking ? ' opacity-100' : ' opacity-0 group-hover:opacity-100'}`}>
            {onOpenArtifact && codeBlocks.length > 0 && (
              <button
                onClick={() => onOpenArtifact(0, codeBlocks)}
                className="flex items-center gap-1 h-6 px-2 rounded-md text-xs font-medium"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-primary)' }}
                title="Open in Artifacts panel"
              >
                {getIcon('external-link', { size: 10 })}
                {codeBlocks.length > 1 ? `${codeBlocks.length} artifacts` : 'Artifact'}
              </button>
            )}
            {message.id && onToggleBookmark && (
              <button
                onClick={() => onToggleBookmark(message.id)}
                className="w-6 h-6 flex items-center justify-center rounded-md"
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: bookmarked ? '#f59e0b' : 'var(--color-muted)',
                }}
                title={bookmarked ? 'Remove bookmark' : 'Bookmark this message'}
              >
                {getIcon('star', { size: 11, fill: bookmarked ? 'currentColor' : 'none' })}
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

            {/* Read aloud controls — only on latest assistant message */}
            {onSpeak && (
              isSpeaking ? (
                <>
                  <button
                    onClick={isPaused ? onResume : onPause}
                    className="w-6 h-6 flex items-center justify-center rounded-md"
                    style={{ background: 'color-mix(in srgb, var(--color-primary) 12%, var(--color-surface))', border: '1px solid var(--color-primary)', color: 'var(--color-primary)' }}
                    title={isPaused ? 'Resume' : 'Pause'}
                  >
                    {isPaused ? getIcon('play', { size: 11 }) : getIcon('pause', { size: 11 })}
                  </button>
                  <button
                    onClick={onStop}
                    className="w-6 h-6 flex items-center justify-center rounded-md"
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                    title="Stop reading"
                  >
                    {getIcon('x', { size: 11 })}
                  </button>
                </>
              ) : (
                <button
                  onClick={onSpeak}
                  className="w-6 h-6 flex items-center justify-center rounded-md"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                  title="Read aloud"
                >
                  {getIcon('speaker', { size: 11 })}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(MessageBubble);
