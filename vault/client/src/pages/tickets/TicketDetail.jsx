import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useAuthStore from '../../store/authStore';
import Tooltip from '../../components/Tooltip';
import ConfirmModal from '../../components/ConfirmModal';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { offerUndo } from '../../utils/binUndo';
import PlanClientPicker from '../plans/PlanClientPicker';
import { Btn, Field, Sel, StatusBadge, TypeTag, FIELD_CLASS, FIELD_STYLE, MUTED } from './ticketUi';
import { TYPES, STATUSES, PRIORITIES, ticketNo, shortName, isOverdue, dueText, localToday, sourceHref, lastListHref } from './ticketLogic.mjs';

const when = (iso) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** One ticket: its fields (each saves as it changes), description, the activity thread with comments, linked tasks, Make a task and Delete. */
export default function TicketDetail({ id, people }) {
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const me = useAuthStore((s) => s.user);
  const [t, setT] = useState(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const today = localToday();

  const take = (d) => { setT(d); setTitle(d.title); setDesc(d.description || ''); };
  const load = useCallback(async () => {
    try {
      const r = await api.get(`/api/tickets/${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'That ticket could not be loaded.');
      take(d); setError('');
    } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const send = async (method, path, body, okMessage) => {
    setBusy(true);
    try {
      const r = await api[method](`/api/tickets/${id}${path}`, body);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'That could not be saved.');
      if (d.ticket) take(d.ticket); else if (d.id) take(d);
      window.dispatchEvent(new Event('vault:tickets-changed'));
      if (okMessage) addToast(okMessage);
      return d;
    } catch (e) { addToast(e.message, 'error'); return null; } finally { setBusy(false); }
  };
  const save = (patch) => send('put', '', patch);

  const addComment = async () => {
    if (!comment.trim()) return;
    if (await send('post', '/comments', { body: comment })) setComment('');
  };

  const makeTask = async () => {
    const d = await send('post', '/task', {});
    if (d) addToast('Task added to your Tasks.', 'success', undefined, { label: 'Open Tasks', onClick: () => navigate('/tasks') });
  };

  const remove = async () => {
    setConfirmDelete(false);
    try {
      const r = await api.delete(`/api/tickets/${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'The ticket could not be deleted.');
      offerUndo({ message: `${ticketNo(t)} moved to the recycle bin.`, binIds: d.binId });
      navigate(lastListHref());
    } catch (e) { addToast(e.message, 'error'); }
  };

  if (error) {
    return (
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <Link to={lastListHref()} className="text-sm hover:opacity-70" style={{ color: 'var(--color-primary)' }}>← Tickets</Link>
        <p className="text-sm mt-4" role="alert" style={{ color: '#ef4444' }}>{error}</p>
      </div>
    );
  }
  if (!t) return <div className="flex-1 p-4 sm:p-6"><p className="text-sm" style={MUTED}>Loading…</p></div>;

  const overdue = isOverdue(t, today);
  const src = sourceHref(t);
  const panel = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-4xl">
        <Link to={lastListHref()} className="text-sm hover:opacity-70" style={{ color: 'var(--color-primary)' }}>← Tickets</Link>

        <div className="flex items-start justify-between gap-3 mt-3 mb-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs" style={MUTED}>{ticketNo(t)}</span>
              <TypeTag type={t.type} />
              <StatusBadge status={t.status} />
              {t.dueDate && <span className="text-xs" style={overdue ? { color: '#ef4444', fontWeight: 600 } : MUTED}>{dueText(t, today)}</span>}
            </div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title.trim() !== t.title && save({ title })}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label="Ticket title"
              className="text-lg font-bold w-full bg-transparent outline-none rounded px-1 -mx-1 focus:ring-1" style={{ color: 'var(--color-text)' }} />
            <p className="text-xs mt-1" style={MUTED}>
              Raised by {shortName(t.createdByEmail) || 'someone no longer here'} · {when(t.createdAt)}
              {src && <> · From <Link to={src} className="underline" style={{ color: 'var(--color-primary)' }}>{t.sourceLabel || t.sourceKind.replace('_', ' ')}</Link></>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Tooltip text="Add a task to your own Tasks, linked to this ticket, with its title, due date and priority.">
              <Btn variant="secondary" onClick={makeTask} disabled={busy}>Make a task</Btn>
            </Tooltip>
            <Btn variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Btn>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 flex flex-col gap-5">
            <section className="rounded-xl border p-4" style={panel}>
              <Field label="Description">
                <VoiceInput type="textarea" rows={6} value={desc} onChange={setDesc} label="Description" placeholder="Details, links, steps…"
                  className={FIELD_CLASS} style={{ ...FIELD_STYLE, background: 'var(--color-bg)' }} mic />
              </Field>
              {desc !== (t.description || '') && (
                <div className="flex gap-2 justify-end mt-2">
                  <Btn variant="secondary" onClick={() => setDesc(t.description || '')}>Undo changes</Btn>
                  <Btn onClick={() => save({ description: desc })} disabled={busy}>Save description</Btn>
                </div>
              )}
            </section>

            <section className="rounded-xl border p-4" style={panel}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Activity</h2>
              {t.events.length === 0 && <p className="text-xs mb-3" style={MUTED}>No comments or changes yet.</p>}
              <ol className="flex flex-col gap-3 mb-4">
                {t.events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="flex items-center gap-2 text-xs" style={MUTED}>
                      <span className="font-medium" style={{ color: 'var(--color-text)' }}>{shortName(e.userEmail) || 'Someone'}</span>
                      <span>{when(e.createdAt)}</span>
                      {e.kind === 'comment' && (e.userId === me?.id || me?.isAdmin) && (
                        <button type="button" onClick={() => send('delete', `/comments/${e.id}`)} className="hover:opacity-60" aria-label="Remove this comment">Remove</button>
                      )}
                    </div>
                    {e.kind === 'comment'
                      ? <p className="mt-1 whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{e.body}</p>
                      : <p className="mt-0.5 text-xs italic" style={MUTED}>{e.body}</p>}
                  </li>
                ))}
              </ol>
              <VoiceInput type="textarea" rows={3} value={comment} onChange={setComment} label="Add a comment" placeholder="Add a comment…"
                className={FIELD_CLASS} style={{ ...FIELD_STYLE, background: 'var(--color-bg)' }} mic />
              <div className="flex justify-end mt-2">
                <Btn onClick={addComment} disabled={busy || !comment.trim()}>Comment</Btn>
              </div>
            </section>
          </div>

          <aside className="flex flex-col gap-4">
            <section className="rounded-xl border p-4 flex flex-col gap-3" style={panel}>
              <Field label="Status">
                <Sel value={t.status} onChange={(v) => save({ status: v })} label="Status" disabled={busy}>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Sel>
              </Field>
              <Field label="Assigned to">
                <Sel value={t.assigneeId || ''} onChange={(v) => save({ assigneeId: v ? Number(v) : null })} label="Assigned to" disabled={busy}>
                  <option value="">Nobody</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{shortName(p.email)}</option>)}
                  {t.assigneeId && !people.some((p) => p.id === t.assigneeId) && <option value={t.assigneeId}>{shortName(t.assigneeEmail)}</option>}
                </Sel>
              </Field>
              <Field label="Priority">
                <Sel value={t.priority} onChange={(v) => save({ priority: v })} label="Priority" disabled={busy}>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Sel>
              </Field>
              <Field label="Type">
                <Sel value={t.type} onChange={(v) => save({ type: v })} label="Type" disabled={busy}>{TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Sel>
              </Field>
              <Field label="Due date">
                <input type="date" value={t.dueDate || ''} onChange={(e) => save({ dueDate: e.target.value || null })} aria-label="Due date" disabled={busy} className={FIELD_CLASS} style={FIELD_STYLE} />
              </Field>
              <div className="flex flex-col gap-3">
                <PlanClientPicker what="ticket" clientId={t.clientId} clientProjectId={t.clientProjectId} clientName={t.clientName}
                  clientProjectName={t.clientProjectName} disabled={busy} onChange={(ch) => save(ch)} />
              </div>
            </section>

            {t.tasks.length > 0 && (
              <section className="rounded-xl border p-4" style={panel}>
                <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Tasks made from it</h2>
                <ul className="flex flex-col gap-1 text-sm">
                  {t.tasks.map((k) => (
                    <li key={k.id} className="flex items-center justify-between gap-2">
                      <span style={{ color: 'var(--color-text)', textDecoration: k.status === 'done' ? 'line-through' : 'none' }}>{k.title}</span>
                      {k.userId === me?.id ? <Link to="/tasks" className="text-xs" style={{ color: 'var(--color-primary)' }}>Tasks</Link> : <span className="text-xs" style={MUTED}>someone else's</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal title="Delete this ticket?" danger confirmLabel="Delete"
          message={`${ticketNo(t)} "${t.title}" and its comments move to your recycle bin, where you can restore them for 30 days. Tasks made from it stay in Tasks.`}
          onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
      )}
    </div>
  );
}
