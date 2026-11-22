import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { setToolHandoff } from '../../utils/toolHandoff.mjs';

// Shared deck model, context and small UI pieces for the six Presentations tools. All colours come from DESIGN.md tokens.
export const LAYOUTS = ['title', 'bullets', 'two-column', 'picture', 'closing'];
export const ASPECTS = ['16:9', '4:3', '1:1'];
export const BUILTIN_THEMES = ['paper', 'ink', 'warm', 'ocean', 'forest', 'mono'];

export const FIELD_STYLE = {
  background: 'var(--color-bg)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};
export const CARD_STYLE = {
  borderColor: 'var(--color-border)',
  background: 'var(--color-surface)',
};

const text = (v) => (typeof v === 'string' ? v : (v == null ? '' : String(v)));
const capped = (v, n) => text(v).slice(0, n);

export function emptyDeck() {
  return { schemaVersion: 1, title: '', subtitle: '', themeId: 'paper', aspect: '16:9', slides: [] };
}

/** Defensive client-side normalisation of anything that comes back from the API or from a handoff file. */
export function normalizeDeck(raw, maxSlides = 20) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const slides = Array.isArray(src.slides)
    ? src.slides.slice(0, Math.max(1, maxSlides)).map((item, i) => {
      const s = item && typeof item === 'object' ? item : {};
      return {
        id: capped(s.id, 80) || `s${i + 1}`,
        layout: LAYOUTS.includes(s.layout) ? s.layout : 'bullets',
        title: capped(s.title, 160),
        bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => capped(b, 300)).filter(Boolean).slice(0, 8) : [],
        body: capped(s.body, 1200),
        imageRef: capped(s.imageRef, 2000),
        notes: capped(s.notes, 1000),
      };
    })
    : [];
  return {
    schemaVersion: 1,
    title: capped(src.title, 160),
    subtitle: capped(src.subtitle, 240),
    themeId: capped(src.themeId, 80) || 'paper',
    aspect: ASPECTS.includes(src.aspect) ? src.aspect : '16:9',
    slides,
  };
}

/** Use for every apiClient response so error bodies become useful messages. */
export async function readJson(res, fallback = 'Something went wrong.') {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || data?.message || fallback);
  }
  return res.json().catch(() => ({}));
}

const DONE = new Set(['done', 'complete', 'completed', 'succeeded', 'success', 'finished']);
const FAILED = new Set(['failed', 'error', 'errored']);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tracks one background job at a time. `onResult(kind, payload, jobId)` is called for finished jobs too, so Resume
 * can deliver its result even though the original startJob promise has already settled.
 */
export function usePresentationJob(onResult) {
  const [job, setJob] = useState(null);
  const pending = useRef(null);
  const seq = useRef(0);
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => () => { seq.current += 1; }, []);

  const poll = useCallback(async (id) => {
    const mySeq = seq.current;
    for (;;) {
      let data;
      try {
        const res = await api.get(`/api/presentations/jobs/${encodeURIComponent(id)}`);
        data = await readJson(res, 'Could not check the job.');
      } catch (err) {
        if (seq.current === mySeq && pending.current?.id === id) {
          pending.current.reject(err);
          pending.current = null;
        }
        return;
      }
      if (seq.current !== mySeq || pending.current?.id !== id) return;

      const status = String(data.status || '').toLowerCase();
      setJob((prev) => ({
        ...(prev || {}),
        ...data,
        id,
        kind: pending.current?.kind || data.kind || prev?.kind,
        status,
      }));

      if (DONE.has(status)) {
        try {
          const res = await api.get(`/api/presentations/jobs/${encodeURIComponent(id)}/result`);
          const payload = await readJson(res, 'Could not load the finished result.');
          if (seq.current === mySeq) onResultRef.current?.(pending.current?.kind, payload, id);
          pending.current?.resolve?.(payload);
        } catch (err) {
          pending.current?.reject?.(err);
        }
        pending.current = null;
        return;
      }
      if (FAILED.has(status) || status === 'cancelled' || status === 'canceled') {
        const err = new Error(data.error || (status === 'failed' ? 'The job failed.' : 'The job was cancelled.'));
        if (status === 'failed') onResultRef.current?.(pending.current?.kind, { error: err.message }, id);
        pending.current?.reject?.(err);
        pending.current = null;
        return;
      }
      await wait(1200);
    }
  }, []);

  const startJob = useCallback(async (kind, endpoint, body) => {
    const mySeq = ++seq.current;
    pending.current = null;
    setJob({ id: null, kind, status: 'starting', progress: 0, stage: 'Starting…', error: null });
    try {
      const res = await api.post(endpoint, body);
      const data = await readJson(res, 'Could not start the job.');
      const id = data.jobId || data.id;
      if (!id) throw new Error('The server did not return a job id.');
      if (seq.current !== mySeq) return null;
      setJob((prev) => ({ ...(prev || {}), id, status: 'queued', stage: 'Queued…' }));
      return await new Promise((resolve, reject) => {
        pending.current = { id, kind, resolve, reject };
        poll(id).catch(reject);
      });
    } catch (err) {
      if (seq.current === mySeq) setJob((prev) => (prev ? { ...prev, status: 'failed', error: err.message } : null));
      throw err;
    }
  }, [poll]);

  const cancelJob = useCallback(async () => {
    const id = pending.current?.id || job?.id;
    if (!id) return;
    seq.current += 1;
    pending.current?.reject?.(new Error('Cancelled'));
    pending.current = null;
    setJob((prev) => (prev ? { ...prev, status: 'cancelled', stage: 'Cancelled', error: null } : prev));
    try { await api.post(`/api/presentations/jobs/${encodeURIComponent(id)}/cancel`, {}); } catch { /* already stopped */ }
  }, [job?.id]);

  const resumeJob = useCallback(async () => {
    const id = job?.id;
    if (!id) return;
    try {
      const res = await api.post(`/api/presentations/jobs/${encodeURIComponent(id)}/resume`, {});
      const data = await readJson(res, 'Could not resume the job.');
      const newId = data.jobId || id;
      pending.current = { id: newId, kind: job.kind || 'create', resolve: () => {}, reject: () => {} };
      setJob((prev) => ({ ...(prev || {}), id: newId, status: 'queued', stage: 'Resuming…', error: null }));
      poll(newId).catch(() => {});
    } catch (err) {
      setJob((prev) => (prev ? { ...prev, error: err.message } : prev));
    }
  }, [job, poll]);

  const dismissJob = useCallback(() => {
    seq.current += 1;
    pending.current = null;
    setJob(null);
  }, []);

  return { job, startJob, cancelJob, resumeJob, dismissJob };
}

export const PresentationContext = createContext(null);

export function usePresentations() {
  const ctx = useContext(PresentationContext);
  if (!ctx) throw new Error('Presentations tools must be inside PresentationsPage');
  return ctx;
}

/** Tool heading with the standard (i) help button. */
export function ToolHeader({ id, title, blurb }) {
  const getIcon = useIcon();
  const { setHelpTool } = usePresentations();
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
        <Tooltip text={`How ${title.toLowerCase()} works`}>
          <button
            type="button"
            aria-label={`Help for ${title}`}
            onClick={() => setHelpTool(id)}
            className="hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-muted)', lineHeight: 1 }}
          >
            {getIcon('help-circle', { size: 14 })}
          </button>
        </Tooltip>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{blurb}</p>
    </div>
  );
}

/** Job progress, Cancel / Resume / Dismiss — shown above whichever tool started the job. */
export function JobStatusCard() {
  const { job, cancelJob, resumeJob, dismissJob } = usePresentations();
  const getIcon = useIcon();
  if (!job) return null;
  const busy = !DONE.has(String(job.status || '').toLowerCase()) && !FAILED.has(String(job.status || '').toLowerCase())
    && !['cancelled', 'canceled'].includes(String(job.status || '').toLowerCase());
  const canResume = !busy && !!job.id;
  return (
    <div className="rounded-2xl border p-3 space-y-2" style={CARD_STYLE}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          {job.kind === 'export' ? 'Export' : 'Deck build'}
        </span>
        <span className="text-sm" style={{ color: 'var(--color-text)' }}>{job.stage || job.status || 'Working…'}</span>
        {typeof job.progress === 'number' && (
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{Math.round(job.progress)}%</span>
        )}
        <span className="flex-1" />
        {busy && (
          <Tooltip text="Stop this job. Anything already saved stays saved.">
            <button type="button" onClick={cancelJob} className="text-xs px-2.5 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
              Cancel
            </button>
          </Tooltip>
        )}
        {canResume && (
          <Tooltip text="Pick this job up again where it stopped.">
            <button type="button" onClick={resumeJob} className="text-xs px-2.5 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
              {getIcon('refresh-cw', { size: 12 })} Resume
            </button>
          </Tooltip>
        )}
        <Tooltip text="Hide this job status.">
          <button type="button" onClick={dismissJob} className="text-xs px-2 py-1 rounded-lg hover:opacity-70" style={{ color: 'var(--color-muted)' }}>
            {getIcon('x', { size: 14 })}
          </button>
        </Tooltip>
      </div>
      {job.error && <p className="text-xs" style={{ color: '#991b1b' }}>{job.error}</p>}
    </div>
  );
}

/** Tiny warning used for a missing Brand Kit, empty source and similar cases. */
export function Notice({ tone = 'info', children }) {
  const color = tone === 'error' ? '#991b1b' : tone === 'warn' ? '#b45309' : 'var(--color-muted)';
  const background = tone === 'error' ? '#fff1f2' : tone === 'warn' ? '#fef3c7' : 'var(--color-bg)';
  return (
    <p className="text-xs rounded-xl border px-3 py-2" style={{ color, background, borderColor: 'var(--color-border)' }}>{children}</p>
  );
}

/** Hand a canonical deck to another tool as a JSON file, using Vault's existing one-shot handoff. */
export function DeckHandoff({ deck }) {
  const { openTool, toast } = usePresentations();
  const send = (target) => {
    if (!deck) return;
    const file = new File([JSON.stringify(deck, null, 2)], `${deck.title || 'deck'}.json`, { type: 'application/json' });
    setToolHandoff(target, file);
    openTool(target);
    toast('Deck handed over.', 'success');
  };
  return (
    <Tooltip text="Pass this deck straight into another Presentations tool.">
      <select
        value=""
        onChange={(e) => { if (e.target.value) send(e.target.value); e.target.value = ''; }}
        className="text-xs px-2 py-1.5 rounded-lg border cursor-pointer"
        style={FIELD_STYLE}
        aria-label="Use deck in another tool"
      >
        <option value="">Use in…</option>
        <option value="slides">Slide editor</option>
        <option value="export">Export</option>
      </select>
    </Tooltip>
  );
}

/** Read a JSON deck handed over by another tool (returns null if the file is not a deck). */
export async function readDeckFile(file) {
  if (!file) return null;
  try {
    const parsed = JSON.parse(await file.text());
    return parsed && Array.isArray(parsed.slides) ? normalizeDeck(parsed) : null;
  } catch {
    return null;
  }
}
