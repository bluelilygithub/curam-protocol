import React, { useEffect, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { NOTE_TIPS } from './noteTips.mjs';
import { BUILT_IN_TEMPLATES } from './noteTemplates.mjs';

/**
 * "New note from a template": the built-in ones, the person's own, and (when a note is open) a way to save that note as a template.
 *   templates       the person's own: [{ id, name, title, body, tags }]  (null while loading)
 *   onUse(template) make a note from it
 *   onSave(name)    save the open note as a template (only offered when `canSave`)
 *   onDelete(t)     delete one of the person's own (it goes to the recycle bin, so the page can offer Undo)
 */
export default function TemplatePicker({ templates, mobile, canSave, onUse, onSave, onDelete, onClose }) {
  const getIcon = useIcon();
  const [confirmId, setConfirmId] = useState(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const border = { borderColor: 'var(--color-border)' };
  const row = (key, title, hint, tags, onPick, extra) => (
    <li key={key} className="flex items-stretch border-b last:border-b-0" style={border}>
      <Tooltip text={NOTE_TIPS.templateUse} side="right">
      <button type="button" onClick={onPick} className="flex-1 min-w-0 text-left px-3 py-3 hover:opacity-70 transition-opacity duration-200" style={{ minHeight: 56 }}>
        <span className="block text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{title}</span>
        {hint && <span className="block text-xs truncate mt-0.5" style={{ color: 'var(--color-muted)' }}>{hint}</span>}
        {tags && tags.length > 0 && <span className="block text-xs truncate mt-0.5" style={{ color: 'var(--color-primary)' }}>{tags.join(' · ')}</span>}
      </button>
      </Tooltip>
      {extra}
    </li>
  );

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try { if (await onSave(name.trim())) setName(''); } finally { setSaving(false); }
  }

  return (
    <div className={`fixed inset-0 z-50 flex ${mobile ? 'items-end' : 'items-center'} justify-center`} style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        className={`w-full max-w-md flex flex-col shadow-xl ${mobile ? 'rounded-t-2xl' : 'rounded-2xl m-4'}`}
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: '85dvh', paddingBottom: mobile ? 'max(16px, env(safe-area-inset-bottom))' : undefined }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New note from a template"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>New note from a template</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)', minWidth: 40, minHeight: 40 }}>{getIcon('x', { size: 18 })}</button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 px-4 pb-3 space-y-4">
          <section aria-label="Your templates">
            <h4 className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-muted)' }}>Yours</h4>
            {templates === null && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
            {templates && templates.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>None yet. Open a note you like, press New, From a template, and save it here.</p>
            )}
            {templates && templates.length > 0 && (
              <ul className="rounded-xl border overflow-hidden" style={border}>
                {templates.map((t) => row(
                  `own-${t.id}`, t.name, t.title || t.body.replace(/\s+/g, ' ').slice(0, 60), t.tags, () => onUse(t),
                  confirmId === t.id ? (
                    <div className="flex items-center gap-1.5 pr-2 flex-shrink-0 text-xs" style={{ color: 'var(--color-text)' }}>
                      Delete?
                      <button type="button" onClick={() => { setConfirmId(null); onDelete(t); }} className="px-3 rounded-lg font-medium hover:opacity-80 transition-opacity duration-200" style={{ background: '#ef4444', color: '#fff', minHeight: 36 }}>Yes</button>
                      <button type="button" onClick={() => setConfirmId(null)} className="px-3 rounded-lg hover:opacity-70 transition-opacity duration-200" style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', minHeight: 36 }}>No</button>
                    </div>
                  ) : (
                    <Tooltip text={NOTE_TIPS.templateDelete}>
                      <button type="button" onClick={() => setConfirmId(t.id)} aria-label={`Delete template ${t.name}`} className="flex items-center justify-center hover:opacity-60 transition-opacity duration-200 flex-shrink-0" style={{ color: 'var(--color-muted)', width: 44 }}>{getIcon('trash', { size: 14 })}</button>
                    </Tooltip>
                  )
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Built-in templates">
            <h4 className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-muted)' }}>Built in</h4>
            <ul className="rounded-xl border overflow-hidden" style={border}>
              {BUILT_IN_TEMPLATES.map((t) => row(`built-${t.id}`, t.name, t.hint, t.tags, () => onUse(t)))}
            </ul>
          </section>
        </div>

        {canSave && (
          <div className="px-4 pt-3 border-t flex-shrink-0" style={border}>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Save the open note as a template</label>
            <div className="flex items-center gap-2">
              <input
                value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                placeholder="Template name" maxLength={60} aria-label="Template name"
                className="flex-1 min-w-0 rounded-lg px-3 outline-none"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 16, minHeight: mobile ? 44 : 34 }}
              />
              <Tooltip text={NOTE_TIPS.templateSave}>
                <button type="button" disabled={!name.trim() || saving} onClick={save} className="text-sm font-medium px-4 rounded-lg hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff', minHeight: mobile ? 44 : 34 }}>{saving ? 'Saving…' : 'Save'}</button>
              </Tooltip>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Keeps its title, text and tags. Dates written as {'{{date}}'} are filled in each time it is used.</p>
          </div>
        )}
      </div>
    </div>
  );
}
