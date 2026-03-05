import React from 'react';
import { Link, X, AlertCircle, Loader2 } from 'lucide-react';

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
}

function UrlBar({ urlAttachments, onRemove }) {
  if (!urlAttachments || urlAttachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
      {urlAttachments.map((ua) => (
        <div
          key={ua.url}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs max-w-xs"
          style={{
            background: ua.status === 'error' ? '#fff1f2' : 'var(--color-bg)',
            border: `1px solid ${ua.status === 'error' ? '#fca5a5' : 'var(--color-border)'}`,
            color: ua.status === 'error' ? '#dc2626' : 'var(--color-text)',
          }}
          title={ua.status === 'error' ? ua.error : ua.url}
        >
          {ua.status === 'fetching' ? (
            <Loader2 size={11} className="animate-spin flex-shrink-0" style={{ color: 'var(--color-primary)' }} />
          ) : ua.status === 'error' ? (
            <AlertCircle size={11} className="flex-shrink-0" />
          ) : (
            <Link size={11} className="flex-shrink-0" style={{ color: 'var(--color-primary)' }} />
          )}
          <span className="truncate max-w-[180px]">
            {ua.status === 'ready' && ua.title ? ua.title : getDomain(ua.url)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(ua.url)}
            className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default UrlBar;
