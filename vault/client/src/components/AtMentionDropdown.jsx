import React, { useEffect, useRef } from 'react';
import useProjectStore from '../store/projectStore';
import { useIcon } from '../providers/IconProvider';

function AtMentionDropdown({ query, onSelect, onSearch, onClose }) {
  const { projects, setActive } = useProjectStore();
  const getIcon = useIcon();
  const listRef = useRef(null);
  const [selected, setSelected] = React.useState(0);

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  // Show "Search the web" when query is blank or starts to match "search"
  const showSearch = query === '' || 'search the web'.startsWith(query.toLowerCase()) || query.toLowerCase().includes('search');
  const items = showSearch
    ? [{ id: '__search__', isSearch: true }, ...filtered]
    : filtered;

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[selected];
        if (!item) return;
        if (item.isSearch) onSearch?.();
        else handleSelect(item);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, selected]);

  const handleSelect = (project) => {
    setActive(project.id);
    onSelect(`@[${project.name}]`);
  };

  if (items.length === 0) return null;

  return (
    <div
      className="absolute bottom-full mb-2 left-0 w-56 rounded-lg border shadow-lg py-1 z-50"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      ref={listRef}
    >
      {items.map((item, i) =>
        item.isSearch ? (
          <button
            key="__search__"
            onClick={() => onSearch?.()}
            className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors"
            style={{
              background: i === selected ? 'var(--color-bg)' : 'transparent',
              color: 'var(--color-primary)',
            }}
          >
            {getIcon('search', { size: 14 })}
            <span>Search the web…</span>
          </button>
        ) : (
          <button
            key={item.id}
            onClick={() => handleSelect(item)}
            className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors"
            style={{
              background: i === selected ? 'var(--color-bg)' : 'transparent',
              color: 'var(--color-text)',
            }}
          >
            {getIcon('folder', { size: 14 })}
            <span className="truncate">{item.name}</span>
          </button>
        )
      )}
    </div>
  );
}

export default AtMentionDropdown;
