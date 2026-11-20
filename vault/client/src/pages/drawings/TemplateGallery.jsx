import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Dialog from '../../components/Dialog';
import Tooltip from '../../components/Tooltip';
import { TEMPLATES, TEMPLATE_GROUPS, buildTemplate, defaultValues } from './diagramTemplates.mjs';

const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-opacity duration-200 hover:opacity-60 disabled:opacity-40';
const BTN_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };
const FIELD = 'px-2 py-1.5 rounded-lg border text-sm';
const FIELD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
const LABEL_STYLE = { color: 'var(--color-muted)' };

/**
 * "New diagram": a blank page or one of the built-in templates (diagramTemplates.mjs), with that template's settings, direction and look.
 *   onCreate({ title, look, diagram })   diagram is null for a blank page
 */
export default function TemplateGallery({ busy, onCreate, onClose }) {
  const getIcon = useIcon();
  const [chosen, setChosen] = useState(null); // a template, or null for Blank
  const [values, setValues] = useState({});
  const [direction, setDirection] = useState('down');
  const [look, setLook] = useState('sketch');

  const choose = (t) => {
    setChosen(t);
    if (t) { setValues(defaultValues(t)); setDirection(t.direction); }
  };
  const create = () => onCreate(chosen
    ? { title: chosen.name, look, diagram: buildTemplate(chosen.id, values, direction) }
    : { title: undefined, look, diagram: null });

  const settings = () => (
    <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: 'var(--color-primary)', background: 'var(--color-bg)' }} aria-label={`Settings for ${chosen.name}`}>
      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{chosen.name}</p>
      <div className="flex flex-wrap items-end gap-3">
        {chosen.options.map((op) => (
          <label key={op.key} className="space-y-1 block">
            <span className="text-xs block" style={LABEL_STYLE}>{op.label}</span>
            {op.type === 'number' ? (
              <input type="number" min={op.min} max={op.max} value={values[op.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [op.key]: e.target.value }))} className={`${FIELD} w-24`} style={FIELD_STYLE} />
            ) : (
              <select value={values[op.key]} onChange={(e) => setValues((v) => ({ ...v, [op.key]: e.target.value }))} className={FIELD} style={FIELD_STYLE}>
                {op.choices.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </label>
        ))}
        <label className="space-y-1 block">
          <span className="text-xs block" style={LABEL_STYLE}>Direction</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value)} className={FIELD} style={FIELD_STYLE}>
            <option value="down">Top to bottom</option>
            <option value="right">Left to right</option>
          </select>
        </label>
        <label className="space-y-1 block">
          <span className="text-xs block" style={LABEL_STYLE}>Look</span>
          <select value={look} onChange={(e) => setLook(e.target.value)} className={FIELD} style={FIELD_STYLE}>
            <option value="sketch">Sketch (hand-drawn)</option>
            <option value="clean">Clean</option>
          </select>
        </label>
      </div>
    </div>
  );

  const card = (key, name, hint, selected, onClick) => (
    <li key={key}>
      <button
        type="button" onClick={onClick} aria-pressed={selected}
        className="w-full h-full text-left rounded-xl border px-3 py-2 transition-opacity duration-200 hover:opacity-80"
        style={{ borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-surface)', boxShadow: selected ? '0 0 0 1px var(--color-primary)' : 'none' }}
      >
        <span className="block text-sm font-medium" style={{ color: 'var(--color-text)' }}>{name}</span>
        <span className="block text-xs mt-0.5" style={LABEL_STYLE}>{hint}</span>
      </button>
    </li>
  );

  return (
    <Dialog
      title="New diagram"
      icon={getIcon('pen-tool', { size: 16 })}
      size="2xl"
      onClose={busy ? undefined : onClose}
      footer={(
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={BTN} style={BTN_STYLE}>Cancel</button>
          <Tooltip text={chosen ? 'Make the diagram from this template and open it. Every box can be renamed, moved or deleted, and one Undo removes the whole template.' : 'Start an empty diagram and open it.'}>
            <button type="button" onClick={create} disabled={busy} className={BTN} style={{ ...BTN_STYLE, background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderColor: 'var(--color-primary)' }}>
              {busy ? 'Making…' : 'Create'}
            </button>
          </Tooltip>
        </div>
      )}
    >
      <div className="space-y-4">
        <ul className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {card('blank', 'Blank', 'An empty page to draw on.', chosen === null, () => choose(null))}
        </ul>

        {TEMPLATE_GROUPS.map((group) => (
          <section key={group} aria-label={group}>
            <h4 className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={LABEL_STYLE}>{group}</h4>
            <ul className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {TEMPLATES.filter((t) => t.group === group).map((t) => card(t.id, t.name, t.hint, chosen === t, () => choose(t)))}
            </ul>
            {chosen && chosen.group === group && <div className="mt-2">{settings()}</div>}
          </section>
        ))}
      </div>
    </Dialog>
  );
}
