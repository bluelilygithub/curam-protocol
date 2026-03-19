import React, { useState, useEffect } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';

const EMPTY = { title: '', priority: 'medium', dueDate: '', isUrgent: 0, isMilestone: 0, projectId: null, sessionId: null, notes: '' };

export default function QuickCapture() {
  const getIcon = useIcon();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(false);
  const [toastText, setToastText] = useState('Task captured ✓');

  useEffect(() => {
    const keyHandler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    const openHandler = (e) => {
      const { title = '', priority = 'medium', dueDate = '', projectId = null, sessionId = null, notes = '', toastMessage = '' } = e.detail || {};
      setForm({ ...EMPTY, title, priority, dueDate, projectId, sessionId, notes });
      if (toastMessage) setToastText(toastMessage);
      setOpen(true);
    };
    window.addEventListener('keydown', keyHandler);
    document.addEventListener('vault:open-quick-capture', openHandler);
    return () => {
      window.removeEventListener('keydown', keyHandler);
      document.removeEventListener('vault:open-quick-capture', openHandler);
    };
  }, [open]);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/tasks', {
        title: form.title.trim(),
        priority: form.priority,
        dueDate: form.dueDate || null,
        status: 'todo',
        isUrgent: form.isUrgent ? 1 : 0,
        isMilestone: form.isMilestone ? 1 : 0,
        ...(form.notes ? { notes: form.notes } : {}),
        ...(form.projectId ? { projectId: form.projectId } : {}),
        ...(form.sessionId ? { sourceSessionId: form.sessionId } : {}),
      });
      document.dispatchEvent(new CustomEvent('vault:task-created'));
      setOpen(false);
      setForm(EMPTY);
      setToast(true);
      setTimeout(() => { setToast(false); setToastText('Task captured ✓'); }, 2500);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* FAB */}
      {!open && (
        <button
          data-tour="quick-capture-fab"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
          title="Quick capture task (Ctrl+Shift+N)"
        >
          {getIcon('plus', { size: 22 })}
        </button>
      )}

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border shadow-2xl overflow-hidden"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Quick Capture</span>
              <button onClick={() => setOpen(false)} className="hover:opacity-60" style={{ color: 'var(--color-muted)' }}>
                {getIcon('x', { size: 15 })}
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <input
                autoFocus
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                placeholder="What needs to be done?"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              {form.notes !== '' && (
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Notes (optional)"
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl border text-sm resize-none outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              )}
              <div className="flex gap-2">
                <select
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  className="flex-1 px-3 py-2 rounded-xl border text-sm outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  <option value="high">High priority</option>
                  <option value="medium">Medium priority</option>
                  <option value="low">Low priority</option>
                </select>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  className="flex-1 px-3 py-2 rounded-xl border text-sm outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, isUrgent: f.isUrgent ? 0 : 1 }))}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-all"
                  style={{
                    background: form.isUrgent ? '#f59e0b22' : 'transparent',
                    borderColor: form.isUrgent ? '#f59e0b' : 'var(--color-border)',
                    color: form.isUrgent ? '#f59e0b' : 'var(--color-muted)',
                  }}
                >
                  ⚡ {form.isUrgent ? 'Urgent' : 'Not urgent'}
                </button>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, isMilestone: f.isMilestone ? 0 : 1 }))}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-all"
                  style={{
                    background: form.isMilestone ? '#f59e0b22' : 'transparent',
                    borderColor: form.isMilestone ? '#f59e0b' : 'var(--color-border)',
                    color: form.isMilestone ? '#f59e0b' : 'var(--color-muted)',
                  }}
                >
                  🏁 {form.isMilestone ? 'Milestone' : 'Not a milestone'}
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-4">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-xl text-sm border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.title.trim()}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {saving ? 'Saving…' : 'Capture'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-20 right-6 z-50 px-4 py-2 rounded-xl shadow-lg text-sm font-medium text-white pointer-events-none"
          style={{ background: 'var(--color-primary)' }}
        >
          {toastText}
        </div>
      )}
    </>
  );
}
