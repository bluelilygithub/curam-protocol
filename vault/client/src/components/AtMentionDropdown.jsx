import React, { useEffect, useRef } from 'react';
import useProjectStore from '../store/projectStore';
import { useIcon } from '../providers/IconProvider';

function AtMentionDropdown({ query, onSelect, onClose }) {
  const { projects, setActive } = useProjectStore();
  const getIcon = useIcon();
  const listRef = useRef(null);
  const [selected, setSelected] = React.useState(0);

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selected]) handleSelect(filtered[selected]);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filtered, selected]);

  const handleSelect = (project) => {
    setActive(project.id);
    onSelect(`@[${project.name}]`);
  };

  if (filtered.length === 0) return null;

  return (
    <div
      className="absolute bottom-full mb-2 left-0 w-56 rounded-lg border shadow-lg py-1 z-50"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      ref={listRef}
    >
      {filtered.map((project, i) => (
        <button
          key={project.id}
          onClick={() => handleSelect(project)}
          className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors"
          style={{
            background: i === selected ? 'var(--color-bg)' : 'transparent',
            color: 'var(--color-text)',
          }}
        >
          {getIcon('folder', { size: 14 })}
          <span className="truncate">{project.name}</span>
        </button>
      ))}
    </div>
  );
}

export default AtMentionDropdown;
