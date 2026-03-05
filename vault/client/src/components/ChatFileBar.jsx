import React from 'react';
import { useIcon } from '../providers/IconProvider';

function FileChip({ attachment, onRemove }) {
  const getIcon = useIcon();
  const isImage = attachment.mimetype?.startsWith('image/');
  const isPdf = attachment.mimetype === 'application/pdf';

  return (
    <div
      className="flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-lg border text-xs max-w-48"
      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
    >
      {isImage && attachment.preview ? (
        <img src={attachment.preview} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
      ) : (
        <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}>
          {isPdf ? getIcon('file-text', { size: 13 }) : getIcon('file', { size: 13 })}
        </span>
      )}
      <span className="truncate" style={{ color: 'var(--color-text)', maxWidth: '120px' }}>
        {attachment.name}
      </span>
      {isPdf && (
        <span
          className="flex-shrink-0 text-xs px-1 rounded font-medium"
          style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}
        >
          PDF
        </span>
      )}
      <button
        onClick={() => onRemove(attachment.id)}
        className="flex-shrink-0 ml-0.5 rounded hover:opacity-60"
        style={{ color: 'var(--color-muted)' }}
      >
        {getIcon('x', { size: 12 })}
      </button>
    </div>
  );
}

function ChatFileBar({ attachments, onRemove }) {
  if (!attachments.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
      {attachments.map(att => (
        <FileChip key={att.id} attachment={att} onRemove={onRemove} />
      ))}
    </div>
  );
}

export default ChatFileBar;
