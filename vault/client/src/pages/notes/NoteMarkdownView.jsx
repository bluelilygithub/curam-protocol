import React, { createContext, useContext, useMemo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { mdComponents } from '../../utils/mdComponents';
import Tooltip from '../../components/Tooltip';
import { NOTE_TIPS } from './noteTips.mjs';
import { chipify, dueLabel } from './noteTodos.mjs';

// react-markdown does not render raw HTML by default, so a pasted <script> or <img onerror> shows as text, never runs.
// remark-breaks keeps a single line break as a line break, so notes typed as plain text look the same here as in the editor.
const PLUGINS = [remarkGfm, remarkBreaks];

// The generated checkbox has no source position of its own, but its list item does: each <li> tells the checkbox inside it
// which line of the note it came from (checked in the browser; a nested list's item overrides its parent's for its own box).
const TaskLine = createContext(null);

function TaskCheckbox({ checked, onToggle }) {
  const line = useContext(TaskLine);
  return (
    <Tooltip text={NOTE_TIPS.todoBox}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={() => line && onToggle?.(line)}
        aria-label="To-do"
        style={{ width: 18, height: 18, marginRight: 8, verticalAlign: 'text-bottom', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
      />
    </Tooltip>
  );
}

/**
 * A note shown as formatted text (Preview). `onToggleTask(line)` is called with the 1-based source line when a to-do
 * checkbox is ticked or unticked; the page writes it back into the note.
 */
export default function NoteMarkdownView({ body, onToggleTask, linkedTasks = {}, today = '' }) {
  const components = useMemo(() => ({
    ...mdComponents,
    // a to-do linked to a task ends with a small chip: its due date or state, opening Tasks
    a: ({ href, children, ...props }) => {
      const m = /^vault-task:(\d+)$/.exec(href || '');
      if (!m) return mdComponents.a({ href, children, ...props });
      const task = linkedTasks[m[1]];
      const label = dueLabel(task, today);
      const late = /^Overdue/.test(label);
      return (
        <Tooltip text={NOTE_TIPS.todoLinked(task?.title || '')}>
          <Link to="/tasks" className="inline-flex items-center rounded px-1.5 ml-1 text-xs align-middle hover:opacity-70 transition-opacity duration-200" style={{ background: 'var(--color-surface)', border: `1px solid ${late ? '#ef4444' : 'var(--color-border)'}`, color: late ? '#ef4444' : 'var(--color-muted)', textDecoration: 'none' }}>{label}</Link>
        </Tooltip>
      );
    },
    input: ({ type, checked }) => (type === 'checkbox' ? <TaskCheckbox checked={checked} onToggle={onToggleTask} /> : null),
    li: ({ node, children, className }) => (
      <TaskLine.Provider value={node?.position?.start?.line ?? null}>
        <li className={`leading-relaxed ${className || ''}`}>{children}</li>
      </TaskLine.Provider>
    ),
  }), [onToggleTask, linkedTasks, today]);

  return (
    <div className="notes-md" style={{ color: 'var(--color-text)', overflowWrap: 'anywhere' }}>
      <style>{`
        .notes-md a { color: var(--color-primary); text-decoration: underline; }
        .notes-md li.task-list-item { list-style: none; margin-left: -1.25rem; }
        .notes-md li.task-list-item:has(input:checked) { color: var(--color-muted); text-decoration: line-through; }
        .notes-md img { max-width: 100%; height: auto; }
      `}</style>
      <ReactMarkdown remarkPlugins={PLUGINS} components={components} urlTransform={(url) => (/^vault-task:\d+$/.test(url) ? url : defaultUrlTransform(url))}>{chipify(body)}</ReactMarkdown>
    </div>
  );
}
