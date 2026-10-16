import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useToastStore from '../store/toastStore';
import AttachmentChip from '../components/AttachmentChip';
import { StatusSelect } from './ClientProjectsPage';

// Everything for one piece of client work, in one place: brief, activity log, notes, files and
// links, tasks, chats, and (read-only) the client's quotes and invoices.
// Anything added here inherits this project and its client. Server: routes/clientProjects.js.

const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const INPUT = 'text-sm px-3 py-2 rounded-xl border w-full outline-none';
const PRIMARY = { background: 'var(--color-primary)', color: '#fff' };
const GHOST = { border: '1px solid var(--color-border)', color: 'var(--color-muted)' };

const ACTIVITY_TYPES = [
  ['note', 'Note'], ['call', 'Phone call'], ['email', 'Email'], ['meeting', 'Meeting / review'],
  ['decision', 'Decision'], ['milestone', 'Milestone'], ['other', 'Other'],
];
const TYPE_LABEL = Object.fromEntries(ACTIVITY_TYPES);
const LINK_KINDS = [['raw', 'Raw files'], ['delivered', 'Delivered'], ['reference', 'Reference'], ['other', 'Other']];
const KIND_LABEL = Object.fromEntries(LINK_KINDS);
const BRIEF_FIELDS = [
  ['goal', 'Goal'], ['problem', 'Problem / what the client asked for'], ['audience', 'Audience'],
  ['constraints', 'Constraints'], ['successCriteria', 'Success criteria'], ['notes', 'Other notes'],
];

const money = n => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(n) || 0);
const day = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const when = d => (d ? new Date(d).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const dateOnly = d => (d ? String(d).slice(0, 10) : '');

function Section({ id, title, hint, right, children }) {
  return (
    <section id={`cp-${id}`} className="rounded-2xl border p-5 space-y-4 scroll-mt-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
          {hint && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }) => <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{children}</p>;

// Routine delete: inline "Delete? Yes / No", never a modal.
function DeleteInline({ onConfirm }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" onClick={() => setAsking(true)} className="text-xs transition-opacity hover:opacity-60" style={{ color: 'var(--color-muted)' }}>Delete</button>;
  return (
    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
      Delete?{' '}
      <button type="button" onClick={onConfirm} className="font-medium hover:opacity-60" style={{ color: '#ef4444' }}>Yes</button>{' / '}
      <button type="button" onClick={() => setAsking(false)} className="hover:opacity-60">No</button>
    </span>
  );
}

// ── Brief ──────────────────────────────────────────────────────────────────────

function Brief({ project, onSaved }) {
  const addToast = useToastStore(s => s.addToast);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const start = () => {
    setForm({ ...Object.fromEntries(BRIEF_FIELDS.map(([k]) => [k, project[k] || ''])), startDate: dateOnly(project.startDate), targetEndDate: dateOnly(project.targetEndDate) });
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put(`/api/projects/${project.id}`, form);
      if (!res.ok) throw new Error();
      addToast('Brief saved');
      setEditing(false);
      onSaved();
    } catch { addToast('Could not save the brief', 'error'); } finally { setSaving(false); }
  };

  const filled = BRIEF_FIELDS.filter(([k]) => project[k]);
  return (
    <Section
      id="brief" title="Brief" hint="What the client asked for. The chats in this project use it as background."
      right={!editing && <button onClick={start} className="text-sm px-3 py-1 rounded-lg transition-opacity hover:opacity-70" style={GHOST}>Edit</button>}
    >
      {editing ? (
        <div className="space-y-3">
          {BRIEF_FIELDS.map(([k, label]) => (
            <label key={k} className="block">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</span>
              <textarea rows={k === 'goal' ? 2 : 3} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className={`${INPUT} mt-1`} style={FIELD} />
            </label>
          ))}
          <div className="grid grid-cols-2 gap-3">
            {[['startDate', 'Start date'], ['targetEndDate', 'Target end date']].map(([k, label]) => (
              <label key={k} className="block">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</span>
                <input type="date" value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className={`${INPUT} mt-1`} style={FIELD} />
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="px-3.5 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-40" style={PRIMARY}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setEditing(false)} className="px-3.5 py-1.5 text-sm rounded-lg transition-opacity hover:opacity-70" style={GHOST}>Cancel</button>
          </div>
        </div>
      ) : filled.length === 0 && !project.startDate && !project.targetEndDate ? (
        <Empty>No brief yet. Use Edit to write down what was asked for.</Empty>
      ) : (
        <div className="space-y-3">
          {filled.map(([k, label]) => (
            <div key={k}>
              <div className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</div>
              <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{project[k]}</div>
            </div>
          ))}
          {(project.startDate || project.targetEndDate) && (
            <div className="text-sm" style={{ color: 'var(--color-muted)' }}>
              {project.startDate && <>Starts {day(project.startDate)}</>}{project.startDate && project.targetEndDate && ' · '}{project.targetEndDate && <>Target end {day(project.targetEndDate)}</>}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── Activity (the client's log, for this project) ─────────────────────────────

function Activity({ project }) {
  const addToast = useToastStore(s => s.addToast);
  const [items, setItems] = useState(null);
  const [note, setNote] = useState('');
  const [type, setType] = useState('note');
  const [at, setAt] = useState('');
  const [follow, setFollow] = useState(false);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/api/client-projects/${project.id}/activity`).then(r => r.json()).then(d => setItems(Array.isArray(d) ? d : [])).catch(() => setItems([]));
  }, [project.id]);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post(`/api/client-projects/${project.id}/activity`, { note, type, date: at ? new Date(at).toISOString() : undefined, needsFollowUp: follow });
      const data = await res.json();
      if (!res.ok) { addToast(data.error || 'Could not add the entry', 'error'); return; }
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        const up = await api.postForm(`/api/clients/${project.clientId}/touchpoints/${data.id}/attachments`, fd);
        if (!up.ok) addToast('Entry saved, but the file did not upload', 'error');
      }
      setNote(''); setType('note'); setAt(''); setFollow(false); setFile(null);
      load();
    } catch { addToast('Could not add the entry', 'error'); } finally { setBusy(false); }
  };

  return (
    <Section id="activity" title="Activity log" hint="Calls, emails, meetings, reviews, decisions. Each entry is also on the client's own log.">
      <form onSubmit={add} className="rounded-xl border p-3 space-y-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
        <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="What happened? (a call, a review, what was agreed…)" className={INPUT} style={{ ...FIELD, background: 'var(--color-surface)' }} />
        <div className="flex flex-wrap items-center gap-2">
          <select value={type} onChange={e => setType(e.target.value)} className="text-sm px-2 py-1.5 rounded-lg border" style={{ ...FIELD, background: 'var(--color-surface)' }} aria-label="Type">
            {ACTIVITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input type="datetime-local" value={at} max={new Date().toISOString().slice(0, 16)} onChange={e => setAt(e.target.value)} className="text-sm px-2 py-1.5 rounded-lg border" style={{ ...FIELD, background: 'var(--color-surface)' }} aria-label="When it happened (blank = now)" title="When it happened (blank = now)" />
          <label className="text-xs flex items-center gap-1" style={{ color: 'var(--color-muted)' }}>
            <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> Needs follow-up
          </label>
          <input type="file" onChange={e => setFile(e.target.files?.[0] || null)} className="text-xs max-w-[14rem]" style={{ color: 'var(--color-muted)' }} aria-label="Attach a file" />
          <button type="submit" disabled={busy || !note.trim()} className="ml-auto px-3.5 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-40" style={PRIMARY}>{busy ? 'Adding…' : 'Add entry'}</button>
        </div>
      </form>

      {items === null ? <Empty>Loading…</Empty> : items.length === 0 ? <Empty>Nothing logged for this project yet.</Empty> : (
        <ul className="space-y-2">
          {items.map(i => (
            <li key={i.id} className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                <span className="font-medium" style={{ color: 'var(--color-text)' }}>{TYPE_LABEL[i.type] || i.type}{i.contactName ? ` with ${i.contactName}` : ''}{i.needsFollowUp ? ' · needs follow-up' : ''}</span>
                <span>{when(i.date)}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap mt-1" style={{ color: 'var(--color-text)' }}>{i.note}</div>
              {i.attachments?.length > 0 && <div className="flex flex-wrap gap-2 mt-2">{i.attachments.map(a => <AttachmentChip key={a.id} attachment={a} />)}</div>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ── Notes ──────────────────────────────────────────────────────────────────────

function Notes({ project }) {
  const addToast = useToastStore(s => s.addToast);
  const [notes, setNotes] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', body: '' });
  const [openId, setOpenId] = useState(null);
  const [edit, setEdit] = useState({ title: '', body: '' });

  const load = useCallback(() => {
    api.get(`/api/client-projects/${project.id}/notes`).then(r => r.json()).then(d => setNotes(Array.isArray(d) ? d : [])).catch(() => setNotes([]));
  }, [project.id]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const res = await api.post(`/api/client-projects/${project.id}/notes`, draft);
    if (!res.ok) { addToast('Could not add the note', 'error'); return; }
    setDraft({ title: '', body: '' }); setAdding(false); load();
  };
  const save = async (id) => {
    const res = await api.put(`/api/notes/${id}`, edit);
    if (!res.ok) { addToast('Could not save the note', 'error'); return; }
    setOpenId(null); load();
  };
  const remove = async (id) => {
    const res = await api.delete(`/api/notes/${id}`);
    if (!res.ok) { addToast('Could not delete the note', 'error'); return; }
    load();
  };

  return (
    <Section id="notes" title="Notes" hint="Free-form. Anything you write here belongs to this project and its client."
      right={!adding && <button onClick={() => setAdding(true)} className="text-sm px-3 py-1 rounded-lg font-medium transition-opacity hover:opacity-80" style={PRIMARY}>Add note</button>}>
      {adding && (
        <div className="rounded-xl border p-3 space-y-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
          <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Title" className={INPUT} style={{ ...FIELD, background: 'var(--color-surface)' }} />
          <textarea rows={5} value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} placeholder="Write anything…" className={INPUT} style={{ ...FIELD, background: 'var(--color-surface)' }} />
          <div className="flex gap-2">
            <button onClick={create} disabled={!draft.title.trim() && !draft.body.trim()} className="px-3.5 py-1.5 text-sm rounded-lg font-medium disabled:opacity-40 transition-opacity hover:opacity-80" style={PRIMARY}>Save note</button>
            <button onClick={() => setAdding(false)} className="px-3.5 py-1.5 text-sm rounded-lg transition-opacity hover:opacity-70" style={GHOST}>Cancel</button>
          </div>
        </div>
      )}
      {notes === null ? <Empty>Loading…</Empty> : notes.length === 0 && !adding ? <Empty>No notes yet.</Empty> : (
        <ul className="space-y-2">
          {notes.map(n => (
            <li key={n.id} className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
              {openId === n.id ? (
                <div className="space-y-2">
                  <input value={edit.title} onChange={e => setEdit(d => ({ ...d, title: e.target.value }))} className={INPUT} style={{ ...FIELD, background: 'var(--color-surface)' }} />
                  <textarea rows={6} value={edit.body} onChange={e => setEdit(d => ({ ...d, body: e.target.value }))} className={INPUT} style={{ ...FIELD, background: 'var(--color-surface)' }} />
                  <div className="flex items-center gap-3">
                    <button onClick={() => save(n.id)} className="px-3.5 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-80" style={PRIMARY}>Save</button>
                    <button onClick={() => setOpenId(null)} className="text-sm hover:opacity-60" style={{ color: 'var(--color-muted)' }}>Cancel</button>
                    <span className="ml-auto"><DeleteInline onConfirm={() => remove(n.id)} /></span>
                  </div>
                </div>
              ) : (
                <button className="w-full text-left transition-opacity hover:opacity-70" onClick={() => { setOpenId(n.id); setEdit({ title: n.title, body: n.body }); }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{n.title}</span>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{when(n.updated_at)}</span>
                  </div>
                  {n.body && <div className="text-xs mt-1 line-clamp-2 whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>{n.body}</div>}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ── Files and links ────────────────────────────────────────────────────────────

function FilesAndLinks({ project }) {
  const addToast = useToastStore(s => s.addToast);
  const [files, setFiles] = useState(null);
  const [links, setLinks] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: '', location: '', kind: 'raw', note: '' });

  const loadLinks = useCallback(() => {
    api.get(`/api/client-projects/${project.id}/links`).then(r => r.json()).then(d => setLinks(Array.isArray(d) ? d : [])).catch(() => setLinks([]));
  }, [project.id]);
  useEffect(() => {
    api.get(`/api/client-projects/${project.id}/files`).then(r => r.json()).then(d => setFiles(Array.isArray(d) ? d : [])).catch(() => setFiles([]));
    loadLinks();
  }, [project.id, loadLinks]);

  const add = async () => {
    const res = await api.post(`/api/client-projects/${project.id}/links`, draft);
    const data = await res.json();
    if (!res.ok) { addToast(data.error || 'Could not add the link', 'error'); return; }
    setDraft({ label: '', location: '', kind: 'raw', note: '' }); setAdding(false); loadLinks();
  };
  const remove = async (id) => {
    const res = await api.delete(`/api/client-projects/${project.id}/links/${id}`);
    if (!res.ok) { addToast('Could not delete the link', 'error'); return; }
    loadLinks();
  };
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); addToast('Path copied'); } catch { addToast('Could not copy', 'error'); }
  };

  return (
    <Section id="files" title="Files and links" hint="Small files are uploaded to the project. Large ones (raw video) stay where they are: add a link to the real location.">
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Links to large files</h3>
          {!adding && <button onClick={() => setAdding(true)} className="text-sm px-3 py-1 rounded-lg font-medium transition-opacity hover:opacity-80" style={PRIMARY}>Add link</button>}
        </div>
        {adding && (
          <div className="rounded-xl border p-3 space-y-2 mb-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
            <input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="Name (e.g. Raw footage, day 1)" className={INPUT} style={{ ...FIELD, background: 'var(--color-surface)' }} />
            <input value={draft.location} onChange={e => setDraft(d => ({ ...d, location: e.target.value }))} placeholder="Web address, or a path such as D:\Clients\Margot\raw" className={INPUT} style={{ ...FIELD, background: 'var(--color-surface)' }} />
            <div className="flex gap-2">
              <select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value }))} className="text-sm px-2 py-1.5 rounded-lg border" style={{ ...FIELD, background: 'var(--color-surface)' }}>
                {LINK_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} placeholder="Note (optional, e.g. 40 GB, original audio)" className={INPUT} style={{ ...FIELD, background: 'var(--color-surface)' }} />
            </div>
            <div className="flex gap-2">
              <button onClick={add} disabled={!draft.label.trim() || !draft.location.trim()} className="px-3.5 py-1.5 text-sm rounded-lg font-medium disabled:opacity-40 transition-opacity hover:opacity-80" style={PRIMARY}>Save link</button>
              <button onClick={() => setAdding(false)} className="px-3.5 py-1.5 text-sm rounded-lg transition-opacity hover:opacity-70" style={GHOST}>Cancel</button>
            </div>
          </div>
        )}
        {links === null ? <Empty>Loading…</Empty> : links.length === 0 && !adding ? <Empty>No links yet.</Empty> : (
          <ul className="space-y-2">
            {links.map(l => {
              const isWeb = /^https?:\/\//i.test(l.location);
              return (
                <li key={l.id} className="rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{l.label} <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>· {KIND_LABEL[l.kind]}</span></span>
                    <DeleteInline onConfirm={() => remove(l.id)} />
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {isWeb
                      ? <a href={l.location} target="_blank" rel="noopener noreferrer" className="text-xs break-all hover:opacity-70" style={{ color: 'var(--color-primary)' }}>{l.location}</a>
                      : <><code className="text-xs break-all" style={{ color: 'var(--color-text)' }}>{l.location}</code>
                          <button onClick={() => copy(l.location)} className="text-xs px-2 py-0.5 rounded-lg transition-opacity hover:opacity-70" style={GHOST}>Copy path</button></>}
                  </div>
                  {l.note && <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{l.note}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Uploaded files</h3>
          <Link to={`/projects/${project.id}`} className="text-xs hover:opacity-70" style={{ color: 'var(--color-primary)' }}>Upload or manage files →</Link>
        </div>
        {files === null ? <Empty>Loading…</Empty> : files.length === 0 ? <Empty>No uploaded files.</Empty> : (
          <ul className="space-y-1">
            {files.map(f => (
              <li key={f.id} className="flex items-center justify-between text-sm gap-2" style={{ color: 'var(--color-text)' }}>
                <span className="truncate">{f.name}</span>
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{f.size ? `${Math.max(1, Math.round(f.size / 1024))} KB` : ''} · {day(f.uploadedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

// ── Tasks ──────────────────────────────────────────────────────────────────────

function Tasks({ project, onChanged }) {
  const addToast = useToastStore(s => s.addToast);
  const [tasks, setTasks] = useState(null);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [templates, setTemplates] = useState([]);
  const [tmpl, setTmpl] = useState('');
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(() => {
    api.get(`/api/tasks?projectId=${project.id}`).then(r => r.json()).then(d => setTasks(Array.isArray(d) ? d : [])).catch(() => setTasks([]));
  }, [project.id]);
  useEffect(() => {
    load();
    api.get('/api/task-templates').then(r => r.json()).then(d => setTemplates(Array.isArray(d) ? d : [])).catch(() => {});
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    const res = await api.post('/api/tasks', { title: title.trim(), dueDate: due || null, projectId: project.id, clientId: project.clientId });
    if (!res.ok) { addToast('Could not add the task', 'error'); return; }
    setTitle(''); setDue(''); load(); onChanged();
  };
  const toggle = async (t) => {
    const res = await api.put(`/api/tasks/${t.id}`, { status: t.status === 'done' ? 'todo' : 'done' });
    if (!res.ok) { addToast('Could not update the task', 'error'); return; }
    load(); onChanged();
  };
  const apply = async () => {
    const res = await api.post(`/api/task-templates/${tmpl}/apply`, { projectId: project.id });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { addToast(data.error || 'Could not apply the template', 'error'); return; }
    addToast('Template applied'); setTmpl(''); load(); onChanged();
  };

  const open = (tasks || []).filter(t => t.status !== 'done');
  const done = (tasks || []).filter(t => t.status === 'done');
  const shown = showDone ? [...open, ...done] : open;
  const q = `project=${project.id}`;

  return (
    <Section id="tasks" title="Tasks" hint="Things you need to do for this client. For board, calendar or timeline views, open them in Tasks."
      right={
        <div className="flex gap-1.5 flex-wrap">
          {[['', 'List'], ['board', 'Board'], ['calendar', 'Calendar'], ['timeline', 'Timeline']].map(([v, l]) => (
            <Link key={l} to={`/tasks?${q}${v ? `&view=${v}` : ''}`} className="text-xs px-2.5 py-1 rounded-lg transition-opacity hover:opacity-70" style={GHOST}>{l} ↗</Link>
          ))}
        </div>
      }>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="New task…" className={`${INPUT} flex-1 min-w-[12rem]`} style={FIELD} />
        <input type="date" value={due} onChange={e => setDue(e.target.value)} className="text-sm px-2 py-2 rounded-xl border" style={FIELD} aria-label="Due date" />
        <button type="submit" disabled={!title.trim()} className="px-3.5 py-1.5 text-sm rounded-lg font-medium disabled:opacity-40 transition-opacity hover:opacity-80" style={PRIMARY}>Add task</button>
      </form>

      {templates.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <select value={tmpl} onChange={e => setTmpl(e.target.value)} className="text-sm px-2 py-1.5 rounded-lg border" style={FIELD} aria-label="Task template">
            <option value="">Start from a template…</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.subtasks?.length || 0} steps)</option>)}
          </select>
          <button onClick={apply} disabled={!tmpl} className="px-3 py-1.5 text-sm rounded-lg disabled:opacity-40 transition-opacity hover:opacity-70" style={GHOST}>Apply to this project</button>
        </div>
      )}

      {tasks === null ? <Empty>Loading…</Empty> : shown.length === 0 ? <Empty>No open tasks.</Empty> : (
        <ul className="space-y-1.5">
          {shown.map(t => (
            <li key={t.id} className="flex items-center gap-3 rounded-xl border px-3 py-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
              <input type="checkbox" checked={t.status === 'done'} onChange={() => toggle(t)} aria-label={`Mark "${t.title}" ${t.status === 'done' ? 'not done' : 'done'}`} />
              <span className="text-sm flex-1 min-w-0 truncate" style={{ color: t.status === 'done' ? 'var(--color-muted)' : 'var(--color-text)', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</span>
              {t.subtaskCount > 0 && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.subtaskDone}/{t.subtaskCount}</span>}
              {t.dueDate && <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{day(t.dueDate)}</span>}
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <button onClick={() => setShowDone(v => !v)} className="text-xs hover:opacity-60" style={{ color: 'var(--color-muted)' }}>{showDone ? 'Hide' : 'Show'} {done.length} done</button>
      )}
    </Section>
  );
}

// ── Chats ──────────────────────────────────────────────────────────────────────

function Chats({ project }) {
  const [chats, setChats] = useState(null);
  useEffect(() => {
    api.get(`/api/client-projects/${project.id}/chats`).then(r => r.json()).then(d => setChats(Array.isArray(d) ? d : [])).catch(() => setChats([]));
  }, [project.id]);
  return (
    <Section id="chats" title="Chats" hint="Conversations with the AI about this client's work. They start with the brief above."
      right={<Link to={`/projects/${project.id}/chat`} className="text-sm px-3 py-1 rounded-lg font-medium transition-opacity hover:opacity-80" style={PRIMARY}>Open chat</Link>}>
      {chats === null ? <Empty>Loading…</Empty> : chats.length === 0 ? <Empty>No chats yet.</Empty> : (
        <ul className="space-y-1.5">
          {chats.map(c => (
            <li key={c.sessionId}>
              <Link to={`/projects/${project.id}/chat`} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 transition-opacity hover:opacity-70" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                <span className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{c.title || c.firstUserMsg || 'Untitled chat'}</span>
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{day(c.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ── Quotes and invoices (read-only) ───────────────────────────────────────────

function Finance({ project }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get(`/api/client-projects/${project.id}/finance`).then(r => r.json()).then(setData).catch(() => setData({ documents: [] }));
  }, [project.id]);
  const docs = data?.documents || [];
  return (
    <Section id="finance" title="Quotes and invoices" hint={`Read-only. Every quote and invoice for ${project.clientName || 'this client'}, not just this project. Create or change them in Finance.`}
      right={<Link to="/finance" className="text-xs hover:opacity-70" style={{ color: 'var(--color-primary)' }}>Open Finance →</Link>}>
      {data === null ? <Empty>Loading…</Empty> : docs.length === 0 ? (
        <Empty>Nothing recorded in Finance for {project.clientName || 'this client'} yet.</Empty>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {docs.map(d => (
            <div key={d.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1.2fr_90px_90px_110px_100px] gap-2 px-3 py-2 text-sm items-center" style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
              <span className="font-medium truncate">{d.number}</span>
              <span className="hidden sm:inline text-xs" style={{ color: 'var(--color-muted)' }}>{d.docType === 'quote' ? 'Quote' : 'Invoice'}</span>
              <span className="hidden sm:inline text-xs capitalize" style={{ color: 'var(--color-muted)' }}>{d.status}</span>
              <span className="hidden sm:inline text-xs" style={{ color: 'var(--color-muted)' }}>{day(d.issueDate)}</span>
              <span className="text-right">{money(d.total)}</span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

const NAV = [['brief', 'Brief'], ['activity', 'Activity'], ['notes', 'Notes'], ['files', 'Files'], ['tasks', 'Tasks'], ['chats', 'Chats'], ['finance', 'Quotes & invoices']];

export default function ClientProjectPage() {
  const { id } = useParams();
  const addToast = useToastStore(s => s.addToast);
  const [overview, setOverview] = useState(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => {
    api.get(`/api/client-projects/${id}`)
      .then(async r => { if (!r.ok) { setMissing(true); return null; } return r.json(); })
      .then(d => { if (d) setOverview(d); })
      .catch(() => setMissing(true));
  }, [id]);
  useEffect(() => { setOverview(null); setMissing(false); load(); }, [load]);

  const setStatus = async (clientStatus) => {
    const res = await api.patch(`/api/client-projects/${id}/status`, { clientStatus });
    if (!res.ok) { addToast('Could not change the status', 'error'); return; }
    load();
  };

  if (missing) {
    return (
      <div className="flex-1 p-6" style={{ background: 'var(--color-bg)' }}>
        <p className="text-sm" style={{ color: 'var(--color-text)' }}>This client project was not found. <Link to="/client-projects" style={{ color: 'var(--color-primary)' }}>Back to client projects</Link></p>
      </div>
    );
  }
  if (!overview) return <div className="flex-1 p-6 text-sm" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>Loading…</div>;

  const { project, counts, nextTask } = overview;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto" style={{ background: 'var(--color-bg)' }}>
      <div className="max-w-4xl w-full mx-auto p-4 sm:p-6 space-y-5">
        <div>
          <Link to="/client-projects" className="text-xs hover:opacity-70" style={{ color: 'var(--color-muted)' }}>← Client projects</Link>
          <div className="flex items-start justify-between gap-3 flex-wrap mt-1">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>{project.name}</h1>
              <div className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                {project.clientId ? <Link to={`/clients/${project.clientId}`} className="hover:opacity-70" style={{ color: 'var(--color-primary)' }}>{project.clientName}</Link> : 'No client'}
                {' · '}
                {nextTask ? <>Next due: {nextTask.title}, {day(nextTask.dueDate)}</> : counts.openTasks ? 'No task dates set' : 'No open tasks'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusSelect value={project.clientStatus} onChange={setStatus} />
              <Link to={`/projects/${project.id}`} className="text-xs px-2.5 py-1.5 rounded-lg transition-opacity hover:opacity-70" style={GHOST} title="Model, persona, pinned files and other project settings">Project settings</Link>
            </div>
          </div>
          <nav className="flex gap-1.5 flex-wrap mt-3" aria-label="Sections">
            {NAV.map(([k, l]) => (
              <button key={k} onClick={() => document.getElementById(`cp-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="text-xs px-2.5 py-1 rounded-lg transition-opacity hover:opacity-70" style={GHOST}>{l}</button>
            ))}
          </nav>
        </div>

        <Brief project={project} onSaved={load} />
        <Activity project={project} />
        <Notes project={project} />
        <FilesAndLinks project={project} />
        <Tasks project={project} onChanged={load} />
        <Chats project={project} />
        <Finance project={project} />
      </div>
    </div>
  );
}
