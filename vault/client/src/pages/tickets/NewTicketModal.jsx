import React, { useState } from 'react';
import api from '../../utils/apiClient';
import Dialog from '../../components/Dialog';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import PlanClientPicker from '../plans/PlanClientPicker';
import { Btn, Field, Sel, FIELD_CLASS, FIELD_STYLE, MUTED } from './ticketUi';
import { TYPES, PRIORITIES, shortName } from './ticketLogic.mjs';

const EMPTY = { title: '', description: '', type: 'client', priority: 'medium', dueDate: '', assigneeId: '', clientId: null, clientProjectId: null };

/**
 * New ticket: a plain form, or "AI from text" (paste or dictate a messy request; AI fills the form for you to check, nothing is saved until
 * Create). `prefill` comes from a link in another tool (ticketLogic.prefillFrom) and may carry a source. Looks like the CRM's New client form.
 */
export default function NewTicketModal({ people, prefill, onClose, onCreated }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(prefill || {}) }));
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const draft = async () => {
    setAiBusy(true); setError(''); setAiNote('');
    try {
      const r = await api.post('/api/tickets/draft', { text: aiText });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'The AI could not fill the ticket.');
      setForm((f) => ({
        ...f, title: d.title, description: d.description || f.description, type: d.type, priority: d.priority,
        dueDate: d.dueDate || '', clientId: d.clientId ?? f.clientId, clientProjectId: d.clientId && d.clientId !== f.clientId ? null : f.clientProjectId,
      }));
      setAiNote(`Filled in by AI (${d.model}). Check it before you create the ticket.`);
    } catch (e) { setError(e.message); } finally { setAiBusy(false); }
  };

  const save = async () => {
    if (!form.title.trim()) { setError('Give the ticket a title.'); return; }
    setSaving(true); setError('');
    try {
      const body = { ...form, assigneeId: form.assigneeId ? Number(form.assigneeId) : null, dueDate: form.dueDate || null };
      const r = await api.post('/api/tickets', body);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'The ticket could not be saved.');
      window.dispatchEvent(new Event('vault:tickets-changed'));
      onCreated(d);
    } catch (e) { setError(e.message); setSaving(false); }
  };

  return (
    <Dialog raw onClose={onClose}
      overlayClassName="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4"
      overlayStyle={{ background: 'rgba(0,0,0,0.5)' }}
      panelClassName="relative w-full max-w-lg rounded-xl shadow-xl overflow-y-auto"
      panelStyle={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', maxHeight: '88vh' }}
      onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>New ticket</span>
        <button onClick={onClose} aria-label="Close" className="w-7 h-7 flex items-center justify-center rounded hover:opacity-60 text-base" style={MUTED}>✕</button>
      </div>

      <div className="p-5 flex flex-col gap-4">
        <div className="rounded-lg border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="text-xs font-medium" style={MUTED}>AI from text (optional)</div>
          <VoiceInput append type="textarea" rows={3} value={aiText} onChange={setAiText} label="Request for AI to turn into a ticket"
            placeholder="Paste or dictate the request, e.g. “Acme says the invoice totals are wrong again, need it fixed before Friday”"
            className={FIELD_CLASS} style={FIELD_STYLE} mic />
          <div className="flex items-center gap-2">
            <Tooltip text="AI fills in the title, type, priority, due date, client and steps below. Only this text and your client names are sent. Nothing is saved until you press Create.">
              <Btn variant="secondary" onClick={draft} disabled={aiBusy || !aiText.trim()}>{aiBusy ? 'Filling in…' : 'Fill in with AI'}</Btn>
            </Tooltip>
            {aiNote && <span className="text-xs" style={MUTED}>{aiNote}</span>}
          </div>
        </div>

        <Field label="Title">
          <VoiceInput append value={form.title} onChange={set('title')} label="Ticket title" placeholder="What needs doing?" className={FIELD_CLASS} style={FIELD_STYLE} mic />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Sel value={form.type} onChange={set('type')} label="Type">{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Sel>
          </Field>
          <Field label="Priority">
            <Sel value={form.priority} onChange={set('priority')} label="Priority">{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Sel>
          </Field>
          <Field label="Due date">
            <input type="date" value={form.dueDate || ''} onChange={(e) => set('dueDate')(e.target.value)} aria-label="Due date" className={FIELD_CLASS} style={FIELD_STYLE} />
          </Field>
          <Field label="Assigned to">
            <Sel value={form.assigneeId || ''} onChange={set('assigneeId')} label="Assigned to">
              <option value="">Nobody yet</option>
              {people.map((p) => <option key={p.id} value={p.id}>{shortName(p.email)}</option>)}
            </Sel>
          </Field>
        </div>

        <div className="flex flex-wrap gap-3">
          <PlanClientPicker what="ticket" clientId={form.clientId} clientProjectId={form.clientProjectId}
            onChange={(ch) => setForm((f) => ({ ...f, ...ch }))} />
        </div>

        <Field label="Description">
          <VoiceInput append type="textarea" rows={5} value={form.description} onChange={set('description')} label="Description"
            placeholder="Details, links, steps…" className={FIELD_CLASS} style={FIELD_STYLE} mic />
        </Field>

        {form.sourceKind && <p className="text-xs" style={MUTED}>From: {form.sourceLabel || form.sourceKind}</p>}
        {error && <p className="text-xs" role="alert" style={{ color: '#ef4444' }}>{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create ticket'}</Btn>
        </div>
      </div>
    </Dialog>
  );
}
