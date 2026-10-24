import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import useProjectStore from '../../store/projectStore';
import { TALK_TIPS } from './talkTips.mjs';

/**
 * The end of a conversation: the note it would become (a summary, decisions, to-dos as tick-boxes, then everything that was said), to read, change,
 * file under a project and a client, and keep or leave. Nothing is saved until Save is pressed. `onSave({ title, body, project_id, client_id })`
 * makes the note (the page then opens it, where Make tasks turns the to-dos into tasks).
 */
export default function TalkReviewPanel({ proposal, mobile, saving, onSave, onKeepTalking, onDiscard }) {
  const { projects, fetchProjects } = useProjectStore();
  const [clients, setClients] = useState([]);
  const [title, setTitle] = useState(proposal.title);
  const [body, setBody] = useState(proposal.body);
  const [projectId, setProjectId] = useState('');
  const [clientId, setClientId] = useState('');

  useEffect(() => { fetchProjects?.(); }, [fetchProjects]);
  useEffect(() => {
    api.get('/api/notes/options').then(async (res) => { if (res.ok) setClients((await res.json()).clients || []); }).catch(() => {});
  }, []);

  const field = { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 16, minHeight: mobile ? 48 : 36 };
  const todoCount = (body.match(/^\s*[-*+]\s+\[ \]\s+\S/gm) || []).length;

  return (
    <div className={`fixed inset-0 flex ${mobile ? 'items-end' : 'items-center'} justify-center z-50 ${mobile ? '' : 'p-4'}`} style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div
        className={`${mobile ? 'rounded-t-2xl' : 'rounded-2xl'} w-full ${mobile ? '' : 'max-w-2xl'} shadow-xl flex flex-col`}
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: mobile ? '94dvh' : '86vh', paddingBottom: mobile ? 'env(safe-area-inset-bottom)' : undefined }}
        role="dialog" aria-label="Save this conversation as a note"
      >
        <div className="p-4 pb-2 flex-shrink-0">
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Your conversation as a note</h3>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {proposal.summarised ? 'A summary, then everything that was said. Change anything you like.' : 'The summary could not be made just now, so this is everything that was said. You can still save it.'}
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-obvious px-4 space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Note title" maxLength={200} className="w-full rounded-lg px-3 font-semibold" style={field} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} aria-label="Note text" className="w-full rounded-lg px-3 py-2 text-sm scroll-obvious" style={{ ...field, minHeight: mobile ? 220 : 280, lineHeight: 1.5, resize: 'vertical' }} />
          <div className="flex flex-wrap gap-2">
            <Tooltip text={TALK_TIPS.reviewProject}>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project" className="flex-1 min-w-[10rem] rounded-lg px-2 text-sm" style={field}>
                <option value="">No project</option>
                {(projects || []).filter((p) => !p.archived_at).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Tooltip>
            <Tooltip text={TALK_TIPS.reviewClient}>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client" className="flex-1 min-w-[10rem] rounded-lg px-2 text-sm" style={field}>
                <option value="">No client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Tooltip>
          </div>
          {todoCount > 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{todoCount} to-do{todoCount === 1 ? '' : 's'} in the note. After saving, press Make tasks on the note to turn them into tasks.</p>}
        </div>
        <div className="flex flex-wrap gap-2 p-4 flex-shrink-0">
          <Tooltip text={TALK_TIPS.reviewSave}>
            <button type="button" disabled={saving || !body.trim()} onClick={() => onSave({ title: title.trim() || proposal.title, body, project_id: projectId ? Number(projectId) : null, client_id: clientId ? Number(clientId) : null })} className="flex-1 px-4 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity duration-200 disabled:opacity-50" style={{ minHeight: mobile ? 48 : 38, background: 'var(--color-primary)', color: '#fff' }}>{saving ? 'Saving…' : 'Save as a note'}</button>
          </Tooltip>
          <Tooltip text={TALK_TIPS.reviewKeepTalking}>
            <button type="button" disabled={saving} onClick={onKeepTalking} className="px-4 rounded-lg text-sm hover:opacity-70 transition-opacity duration-200" style={{ minHeight: mobile ? 48 : 38, border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>Keep talking</button>
          </Tooltip>
          <Tooltip text={TALK_TIPS.reviewDiscard}>
            <button type="button" disabled={saving} onClick={onDiscard} className="px-4 rounded-lg text-sm hover:opacity-70 transition-opacity duration-200" style={{ minHeight: mobile ? 48 : 38, color: 'var(--color-muted)' }}>Do not save</button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
