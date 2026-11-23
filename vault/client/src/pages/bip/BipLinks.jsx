import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { profileNoteBody, clientFromProfile, profileFacts } from './bipNote.mjs';

/**
 * "Notes & client" on a saved profile. Save to Note makes a new note (optionally under a project, and under the profile's client when it
 * has one) whose text links back here; the notes linking here are listed below it. The profile can be filed under a CRM client, made from
 * the profile or picked from the list; that client's page then lists it under Business profiles. Uses the existing /api/notes,
 * /api/projects and /api/clients routes plus GET /api/bip/profiles/:id/notes and PUT /api/bip/profiles/:id/client.
 */

const noteHref = (id) => `/notes?note=${encodeURIComponent(id)}`;
const dateOf = (v) => (v ? new Date(v).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

async function json(res, fallback) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

export default function BipLinks({ profile, onClientChanged }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [title, setTitle] = useState(() => profileFacts(profile).name);
  const [projects, setProjects] = useState(null); // null = loading
  const [projectId, setProjectId] = useState('');
  const [notes, setNotes] = useState(null);
  const [clients, setClients] = useState(null);
  const [pickClient, setPickClient] = useState('');
  const [busy, setBusy] = useState('');

  const loadNotes = useCallback(() => {
    api.get(`/api/bip/profiles/${profile.id}/notes`).then((r) => json(r, '')).then((d) => setNotes(d.notes || [])).catch(() => setNotes([]));
  }, [profile.id]);

  useEffect(() => { setTitle(profileFacts(profile).name); }, [profile]);
  useEffect(() => { loadNotes(); }, [loadNotes]);
  useEffect(() => {
    api.get('/api/projects').then((r) => (r.ok ? r.json() : [])).then((d) => setProjects(Array.isArray(d) ? d : [])).catch(() => setProjects([]));
  }, []);
  useEffect(() => {
    if (profile.clientId || clients) return;
    api.get('/api/clients').then((r) => (r.ok ? r.json() : [])).then((d) => setClients(Array.isArray(d) ? d : [])).catch(() => setClients([]));
  }, [profile.clientId, clients]);

  const saveNote = async () => {
    setBusy('note');
    try {
      const note = await json(await api.post('/api/notes', {
        title: title.trim() || profileFacts(profile).name,
        body: profileNoteBody(profile),
        project_id: projectId ? Number(projectId) : null,
        client_id: profile.clientId || null,
      }), 'The note could not be saved. Try again.');
      addToast('Saved to Notes, with a link back to this profile.', 'success', undefined, { label: 'Open note', href: noteHref(note.id) });
      loadNotes();
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(''); }
  };

  const linkClient = async (clientId) => {
    const d = await json(await api.put(`/api/bip/profiles/${profile.id}/client`, { clientId }), 'The client could not be linked.');
    onClientChanged(d.clientId, d.clientName);
    return d;
  };

  const createClient = async () => {
    setBusy('client');
    let made = null;
    try {
      made = await json(await api.post('/api/clients', clientFromProfile(profile)), 'The client could not be created.');
      await linkClient(made.id);
      addToast(`Client "${made.name}" created and linked to this profile.`, 'success', undefined, { label: 'Open client', href: `/clients/${made.id}` });
    } catch (err) {
      // the client exists even if linking failed: say so, so it is not created twice
      addToast(made ? `The client "${made.name}" was created, but could not be linked here: ${err.message}` : err.message, 'error');
    } finally { setBusy(''); }
  };

  const linkExisting = async () => {
    if (!pickClient) return;
    setBusy('client');
    try { const d = await linkClient(Number(pickClient)); addToast(`Linked to ${d.clientName}.`, 'success'); setPickClient(''); }
    catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(''); }
  };

  const unlink = async () => {
    if (!window.confirm(`Unlink this profile from ${profile.clientName}? The client and any notes stay as they are.`)) return;
    setBusy('client');
    try { await linkClient(null); setClients(null); addToast('Unlinked from the client.', 'success'); }
    catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(''); }
  };

  const button = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40';
  const field = 'w-full px-3 py-2 rounded-lg border text-sm outline-none';
  const fieldStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
  const muted = { color: 'var(--color-muted)' };
  const link = { color: 'var(--color-primary)' };

  return (
    <section className="rounded-2xl border p-5 grid lg:grid-cols-2 gap-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} data-guide="save" data-tour="bip-save">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>{getIcon('sticky-note', { size: 15 })} Save to Note</h3>
        <p className="text-xs" style={muted}>
          Makes a new note with the key facts and a link back to this profile{profile.clientId ? `, filed under ${profile.clientName}` : ''}. The profile lists every note that links to it.
        </p>
        <div>
          <label className="text-xs" style={muted} htmlFor="bip-note-title">Note title</label>
          <input id="bip-note-title" type="text" className={field} style={fieldStyle} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="text-xs" style={muted} htmlFor="bip-note-project">Project</label>
          <Tooltip text="File the new note under one of your projects, or leave it on its own.">
            <select id="bip-note-project" className={field} style={fieldStyle} value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!projects}>
              <option value="">{projects === null ? 'Loading projects…' : 'No project'}</option>
              {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Tooltip>
        </div>
        <Tooltip text="Create a new note in Notes with this profile's key facts and a link back here.">
          <button type="button" className={button} disabled={!!busy || profile.status !== 'done'} onClick={saveNote} style={{ background: 'var(--color-primary)', color: '#fff' }}>
            {getIcon('sticky-note', { size: 14 })} {busy === 'note' ? 'Saving…' : 'Save as a new note'}
          </button>
        </Tooltip>
        {profile.status !== 'done' && <p className="text-xs" style={muted}>Available once the profile has finished.</p>}
        <div>
          <p className="text-xs mb-1" style={muted}>Notes linking to this profile</p>
          {notes === null && <p className="text-xs" style={muted}>Loading…</p>}
          {notes?.length === 0 && <p className="text-xs" style={muted}>None yet.</p>}
          {notes?.map((n) => (
            <Link key={n.id} to={noteHref(n.id)} className="block text-sm underline truncate" style={link}>
              {n.title} <span className="text-xs no-underline" style={muted}>· {dateOf(n.updatedAt)}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>{getIcon('building', { size: 15 })} Client</h3>
        {profile.clientId ? (
          <>
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              Filed under <Link to={`/clients/${profile.clientId}`} className="underline" style={link}>{profile.clientName}</Link>. That client's page lists this profile under Business profiles, and new notes saved from here are filed under it too.
            </p>
            <Tooltip text="Stop filing this profile under the client. The client and its notes are not changed.">
              <button type="button" className={button} disabled={!!busy} onClick={unlink} style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>Unlink</button>
            </Tooltip>
          </>
        ) : (
          <>
            <p className="text-xs" style={muted}>Make a CRM client from this profile (name, ABN, address, phone and website go into its notes, status Prospect), or file it under one you already have.</p>
            <Tooltip text="Create a new client from this profile and link the two, so each opens the other.">
              <button type="button" className={button} disabled={!!busy || profile.status !== 'done'} onClick={createClient} style={{ background: 'var(--color-primary)', color: '#fff' }}>
                {getIcon('building', { size: 14 })} {busy === 'client' ? 'Working…' : 'Create client from profile'}
              </button>
            </Tooltip>
            <div className="flex gap-2">
              <select aria-label="Existing client" className={field} style={fieldStyle} value={pickClient} onChange={(e) => setPickClient(e.target.value)} disabled={!clients}>
                <option value="">{clients === null ? 'Loading clients…' : 'Or choose an existing client'}</option>
                {(clients || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Tooltip text="File this profile under the chosen client.">
                <button type="button" className={button} disabled={!pickClient || !!busy} onClick={linkExisting} style={{ border: '1px solid var(--color-border)', color: 'var(--color-primary)' }}>
                  {getIcon('link', { size: 14 })} Link
                </button>
              </Tooltip>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
