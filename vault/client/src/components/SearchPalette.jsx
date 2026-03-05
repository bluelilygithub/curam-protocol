import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearch } from '../hooks/useSearch';
import { useIcon } from '../providers/IconProvider';

const TYPE_ICON = {
  project: 'folder',
  file: 'file',
  message: 'chat',
};

const TYPE_LABEL = {
  project: 'Projects',
  file: 'Files',
  message: 'Messages',
};

function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const { results, loading, search, clear } = useSearch();
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const getIcon = useIcon();

  // Group results
  const grouped = results.reduce((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});

  const flatResults = results;

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      clear();
      setSelectedIdx(0);
    }
  }, [open]);

  useEffect(() => {
    search(query);
    setSelectedIdx(0);
  }, [query]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((s) => Math.min(s + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatResults[selectedIdx]) navigateTo(flatResults[selectedIdx]);
    }
  };

  const navigateTo = (result) => {
    setOpen(false);
    if (result.type === 'project') navigate(`/projects/${result.projectId}`);
    else if (result.type === 'file') navigate(`/projects/${result.projectId}`);
    else if (result.type === 'message') navigate(`/projects/${result.projectId}/chat`);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div
        className="w-full max-w-lg rounded-xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          {getIcon('search', { size: 18, style: { color: 'var(--color-muted)', flexShrink: 0 } })}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search projects, files, messages..."
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: 'var(--color-text)' }}
          />
          {loading && (
            <span style={{ color: 'var(--color-muted)' }}>{getIcon('loader', { size: 14 })}</span>
          )}
          <kbd
            className="text-xs px-1.5 py-0.5 rounded"
            style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {query.length < 2 && (
            <p className="px-4 py-6 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
              Type at least 2 characters to search
            </p>
          )}

          {query.length >= 2 && results.length === 0 && !loading && (
            <p className="px-4 py-6 text-center text-sm" style={{ color: 'var(--color-muted)' }}>
              No results for "{query}"
            </p>
          )}

          {Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>
                {TYPE_LABEL[type] || type}
              </div>
              {items.map((result, i) => {
                const globalIdx = flatResults.indexOf(result);
                return (
                  <button
                    key={i}
                    onClick={() => navigateTo(result)}
                    className="w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors"
                    style={{
                      background: globalIdx === selectedIdx ? 'var(--color-bg)' : 'transparent',
                      color: 'var(--color-text)',
                    }}
                  >
                    <span style={{ color: 'var(--color-muted)', flexShrink: 0, marginTop: 2 }}>
                      {getIcon(TYPE_ICON[result.type] || 'file', { size: 14 })}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{result.title}</p>
                      {result.snippet && (
                        <p
                          className="text-xs mt-0.5 line-clamp-1"
                          style={{ color: 'var(--color-muted)' }}
                          dangerouslySetInnerHTML={{ __html: result.snippet }}
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SearchPalette;
