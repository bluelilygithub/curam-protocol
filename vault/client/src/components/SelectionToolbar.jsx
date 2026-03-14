import React, { useEffect, useState, useRef } from 'react';
import api from '../utils/apiClient';

export default function SelectionToolbar({ projectId, sessionId, contextRef }) {
  const [toolbar, setToolbar] = useState(null); // { x, y, text, context }
  const [loading, setLoading] = useState(false);
  const toolbarRef = useRef(null);

  useEffect(() => {
    const handleMouseUp = (e) => {
      // Ignore clicks inside the toolbar itself
      if (toolbarRef.current?.contains(e.target)) return;

      // Small delay so the selection is finalised
      setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim();
        if (!text || text.length < 3) { setToolbar(null); return; }

        // Only show when the selection is inside the message list
        const container = contextRef?.current;
        if (container) {
          const range = sel.getRangeAt(0);
          if (!container.contains(range.commonAncestorContainer)) {
            setToolbar(null);
            return;
          }
        }

        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // Grab surrounding text as context for Haiku
        const ancestor = range.commonAncestorContainer?.parentElement;
        const context = ancestor?.closest('[data-message-content]')?.textContent || '';

        setToolbar({
          x: rect.left + rect.width / 2,
          y: rect.top + window.scrollY,
          text,
          context,
        });
      }, 10);
    };

    const handleMouseDown = (e) => {
      if (!toolbarRef.current?.contains(e.target)) {
        setToolbar(null);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [contextRef]);

  const handleCreateTask = async () => {
    if (!toolbar?.text || loading) return;
    setLoading(true);

    let priority = 'medium';
    let dueDate = '';

    try {
      const res = await Promise.race([
        api.post('/api/tasks/suggest', { text: toolbar.text, context: toolbar.context })
          .then(r => r.json()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
      ]);
      priority = res.priority || 'medium';
      dueDate = res.dueDate || '';
    } catch (_) {
      // fall through with defaults
    }

    setLoading(false);
    setToolbar(null);
    window.getSelection()?.removeAllRanges();

    document.dispatchEvent(new CustomEvent('vault:open-quick-capture', {
      detail: {
        title: toolbar.text,
        projectId: projectId || null,
        sessionId: sessionId || null,
        priority,
        dueDate,
      },
    }));
  };

  if (!toolbar) return null;

  return (
    <div
      ref={toolbarRef}
      style={{
        position: 'fixed',
        left: toolbar.x,
        top: toolbar.y - 8,
        transform: 'translate(-50%, -100%)',
        zIndex: 60,
        pointerEvents: 'auto',
      }}
    >
      <button
        onMouseDown={e => e.preventDefault()} // prevent selection loss
        onClick={handleCreateTask}
        disabled={loading}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium shadow-lg border transition-opacity disabled:opacity-60"
        style={{
          background: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-text)',
          whiteSpace: 'nowrap',
        }}
      >
        {loading ? (
          <span className="animate-pulse">…</span>
        ) : (
          <>
            <span style={{ color: 'var(--color-primary)', fontSize: '0.85em', fontWeight: 700 }}>+</span>
            Task
          </>
        )}
      </button>
    </div>
  );
}
