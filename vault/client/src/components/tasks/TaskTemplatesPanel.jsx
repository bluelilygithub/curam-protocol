import React, { useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';

const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

const EMPTY_TEMPLATE_FORM = { name: '', description: '', category: '', priority: 'medium', recurrence: 'none', tags: '', subtasks: '' };

export default function TaskTemplatesPanel({ templates, templatesLoading, onApply, onDelete, onTemplateSaved, onClose }) {
  const getIcon = useIcon();
  const [templateForm, setTemplateForm] = useState(EMPTY_TEMPLATE_FORM);
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const handleSaveNewTemplate = async () => {
    if (!templateForm.name.trim()) return;
    setSavingTemplate(true);
    try {
      const subtasks = templateForm.subtasks.split('\n').map(s => s.trim()).filter(Boolean).map(title => ({ title }));
      const tmpl = await api.post('/api/task-templates', {
        ...templateForm,
        subtasks,
      }).then(r => r.json());
      onTemplateSaved(tmpl);
      setTemplateForm(EMPTY_TEMPLATE_FORM);
      setShowNewTemplate(false);
    } catch (err) { console.error(err); }
    finally { setSavingTemplate(false); }
  };

  return (
    <div className="w-72 flex-shrink-0 border-r flex flex-col overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Task Templates</span>
        <div className="flex gap-1.5">
          <button onClick={() => setShowNewTemplate(v => !v)} className="text-xs px-2 py-0.5 rounded-lg border" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>+ New</button>
          <button onClick={onClose} className="hover:opacity-60" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 14 })}</button>
        </div>
      </div>
      {/* New template form */}
      {showNewTemplate && (
        <div className="border-b px-4 py-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <input value={templateForm.name} onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} placeholder="Template name *" className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
          <input value={templateForm.category} onChange={e => setTemplateForm(f => ({ ...f, category: e.target.value }))} placeholder="Category (optional)" className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
          <select value={templateForm.priority} onChange={e => setTemplateForm(f => ({ ...f, priority: e.target.value }))} className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            <option value="high">High priority</option>
            <option value="medium">Medium priority</option>
            <option value="low">Low priority</option>
          </select>
          <textarea value={templateForm.subtasks} onChange={e => setTemplateForm(f => ({ ...f, subtasks: e.target.value }))} placeholder="Subtasks (one per line)" rows={3} className="w-full text-xs px-2 py-1.5 rounded-lg border outline-none resize-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
          <div className="flex gap-2">
            <button onClick={handleSaveNewTemplate} disabled={savingTemplate || !templateForm.name.trim()} className="flex-1 text-xs py-1.5 rounded-lg font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{savingTemplate ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setShowNewTemplate(false)} className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Cancel</button>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-2">
        {templatesLoading ? (
          <div className="flex justify-center py-6" style={{ color: 'var(--color-muted)' }}>{getIcon('loader', { size: 16 })}</div>
        ) : templates.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--color-muted)' }}>No templates yet. Create one above or save a task as a template.</div>
        ) : (
          templates.map(tmpl => (
            <div key={tmpl.id} className="px-4 py-2.5 border-b hover:opacity-90" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{tmpl.name}</span>
                <div className="flex gap-0.5 flex-shrink-0">
                  <button onClick={() => onApply(tmpl.id)} className="text-xs px-1.5 py-0.5 rounded border font-medium" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>Apply</button>
                  <button onClick={() => onDelete(tmpl.id)} className="hover:opacity-60 p-0.5" style={{ color: 'var(--color-muted)' }}>{getIcon('trash', { size: 11 })}</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <span className="text-xs px-1 py-0.5 rounded" style={{ background: PRIORITY_COLOR[tmpl.priority] + '22', color: PRIORITY_COLOR[tmpl.priority] }}>{PRIORITY_LABEL[tmpl.priority]}</span>
                {tmpl.category && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{tmpl.category}</span>}
                {tmpl.subtasks.length > 0 && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{tmpl.subtasks.length} subtask{tmpl.subtasks.length !== 1 ? 's' : ''}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
