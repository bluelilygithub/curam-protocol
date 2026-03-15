import React, { useEffect, useRef, useState } from 'react';
import useProjectStore from '../store/projectStore';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';

function AtMentionDropdown({ query, onSelect, onSearch, onGmailSearch, onCalendarSearch, onPromptSelect, onClose }) {
  const { projects, setActive } = useProjectStore();
  const getIcon = useIcon();
  const listRef = useRef(null);
  const [selected, setSelected] = useState(0);
  const [tasks, setTasks] = useState([]);
  const [prompts, setPrompts] = useState([]);

  // Load incomplete tasks once on mount
  useEffect(() => {
    api.get('/api/tasks?limit=20')
      .then(r => r.json())
      .then(data => setTasks(Array.isArray(data) ? data.filter(t => t.status !== 'done').slice(0, 20) : []))
      .catch(() => {});
    api.get('/api/prompts')
      .then(r => r.json())
      .then(data => setPrompts(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  const filteredTasks = query
    ? tasks.filter(t => t.title.toLowerCase().includes(query.toLowerCase()))
    : tasks.slice(0, 5);

  const filteredPrompts = query
    ? prompts.filter(p =>
        p.title.toLowerCase().includes(query.toLowerCase()) ||
        'prompt'.startsWith(query.toLowerCase())
      )
    : prompts.slice(0, 5);

  const showSearch   = query === '' || 'search the web'.startsWith(query.toLowerCase()) || query.toLowerCase().includes('search');
  const showGmail    = query === '' || 'search gmail'.startsWith(query.toLowerCase()) || query.toLowerCase().includes('gmail');
  const showCalendar = query === '' || 'search calendar'.startsWith(query.toLowerCase()) || query.toLowerCase().includes('calendar');

  // Build items list: search option + gmail option + calendar option + projects + tasks + prompts
  const items = [
    ...(showSearch   ? [{ id: '__search__',   isSearch: true }]   : []),
    ...(showGmail    ? [{ id: '__gmail__',    isGmail: true }]    : []),
    ...(showCalendar ? [{ id: '__calendar__', isCalendar: true }] : []),
    ...filteredProjects.map(p => ({ ...p, isProject: true })),
    ...filteredTasks.map(t => ({ ...t, isTask: true })),
    ...filteredPrompts.map(p => ({ ...p, isPrompt: true })),
  ];

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
        else if (item.isGmail) onGmailSearch?.();
        else if (item.isCalendar) onCalendarSearch?.();
        else if (item.isProject) handleSelectProject(item);
        else if (item.isTask) handleSelectTask(item);
        else if (item.isPrompt) handleSelectPrompt(item);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectProject = (project) => {
    setActive(project.id);
    onSelect(`@[${project.name}]`);
  };

  const handleSelectTask = (task) => {
    const taskRef = `@task[${task.title}]`;
    const taskContext = `\n\n**Task: ${task.title}**${task.notes ? `\n${task.notes}` : ''}${task.dueDate ? `\nDue: ${task.dueDate.slice(0, 10)}` : ''}\n`;
    onSelect(taskRef, taskContext);
  };

  const handleSelectPrompt = (prompt) => {
    onPromptSelect?.(prompt);
  };

  if (items.length === 0) return null;

  const hasProjects = filteredProjects.length > 0;
  const hasTasks = filteredTasks.length > 0;
  const hasPrompts = filteredPrompts.length > 0;
  const specialCount = (showSearch ? 1 : 0) + (showGmail ? 1 : 0) + (showCalendar ? 1 : 0);
  const projectStartIdx = specialCount;
  const taskStartIdx = projectStartIdx + filteredProjects.length;
  const promptStartIdx = taskStartIdx + filteredTasks.length;

  return (
    <div
      className="absolute bottom-full mb-2 left-0 w-64 rounded-lg border shadow-lg py-1 z-50 max-h-72 overflow-y-auto"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      ref={listRef}
    >
      {items.map((item, i) => {
        const isSelected = i === selected;
        const bg = isSelected ? 'var(--color-bg)' : 'transparent';

        if (item.isSearch) {
          return (
            <button
              key="__search__"
              onClick={() => onSearch?.()}
              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors"
              style={{ background: bg, color: 'var(--color-primary)' }}
            >
              {getIcon('search', { size: 14 })}
              <span>Search the web…</span>
            </button>
          );
        }

        if (item.isGmail) {
          return (
            <button
              key="__gmail__"
              onClick={() => onGmailSearch?.()}
              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors"
              style={{ background: bg, color: 'var(--color-primary)' }}
            >
              <span style={{ fontSize: 13 }}>✉️</span>
              <span>Search Gmail…</span>
            </button>
          );
        }

        if (item.isCalendar) {
          return (
            <button
              key="__calendar__"
              onClick={() => onCalendarSearch?.()}
              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors"
              style={{ background: bg, color: 'var(--color-primary)' }}
            >
              <span style={{ fontSize: 13 }}>📅</span>
              <span>Search Calendar…</span>
            </button>
          );
        }

        if (item.isProject) {
          const showProjectHeader = i === projectStartIdx && hasProjects;
          return (
            <React.Fragment key={`project-${item.id}`}>
              {showProjectHeader && (
                <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>
                  Projects
                </div>
              )}
              <button
                onClick={() => handleSelectProject(item)}
                className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors"
                style={{ background: bg, color: 'var(--color-text)' }}
              >
                {getIcon('folder', { size: 14 })}
                <span className="truncate">{item.name}</span>
              </button>
            </React.Fragment>
          );
        }

        if (item.isTask) {
          const showTaskHeader = i === taskStartIdx && hasTasks;
          return (
            <React.Fragment key={`task-${item.id}`}>
              {showTaskHeader && (
                <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider border-t mt-1" style={{ color: 'var(--color-muted)', opacity: 0.6, borderColor: 'var(--color-border)' }}>
                  Tasks
                </div>
              )}
              <button
                onClick={() => handleSelectTask(item)}
                className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors"
                style={{ background: bg, color: 'var(--color-text)' }}
              >
                {getIcon('list-checks', { size: 14 })}
                <span className="truncate flex-1">{item.title}</span>
                {item.dueDate && (
                  <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                    {item.dueDate.slice(5, 10)}
                  </span>
                )}
              </button>
            </React.Fragment>
          );
        }

        if (item.isPrompt) {
          const showPromptHeader = i === promptStartIdx && hasPrompts;
          return (
            <React.Fragment key={`prompt-${item.id}`}>
              {showPromptHeader && (
                <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider border-t mt-1" style={{ color: 'var(--color-muted)', opacity: 0.6, borderColor: 'var(--color-border)' }}>
                  Prompts
                </div>
              )}
              <button
                onClick={() => handleSelectPrompt(item)}
                className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors"
                style={{ background: bg, color: 'var(--color-text)' }}
              >
                {getIcon('book', { size: 14 })}
                <span className="truncate flex-1">{item.title}</span>
              </button>
            </React.Fragment>
          );
        }

        return null;
      })}
    </div>
  );
}

export default AtMentionDropdown;
