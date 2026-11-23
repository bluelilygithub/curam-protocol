import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { setToolHandoff } from '../../utils/toolHandoff.mjs';

// Shared deck model, context and small UI pieces for the six Presentations tools. All colours come from DESIGN.md tokens.
// Same ids and order as server/services/presentations/layouts.js (the geometry for the preview and every export).
export const LAYOUTS = ['title', 'section', 'bullets', 'agenda', 'two-column', 'comparison', 'three-column', 'stats', 'quote', 'timeline', 'picture', 'full-picture', 'closing'];
export const COLUMN_LAYOUTS = { comparison: 2, 'three-column': 3, stats: 4 };
// Same ids as server/services/presentations/schema.js TRANSITIONS.
export const TRANSITIONS = [
  { id: 'none', label: 'None', tip: 'Cut straight to the next slide.' },
  { id: 'fade', label: 'Fade', tip: 'The next slide fades in over the last one.' },
  { id: 'push', label: 'Push', tip: 'The next slide pushes the last one off to the side.' },
  { id: 'wipe', label: 'Wipe', tip: 'The next slide is uncovered from left to right.' },
  { id: 'zoom', label: 'Zoom', tip: 'The next slide grows into place.' },
];
export const ASPECTS = ['16:9', '4:3', '1:1'];
export const BUILTIN_THEMES = ['paper', 'ink', 'warm', 'ocean', 'forest', 'mono'];
export const SHAPE_KINDS = ['rect', 'ellipse', 'triangle', 'line'];
export const SHAPE_COLOURS = ['bg', 'text', 'primary', 'muted'];
export const CHART_TYPES = ['bar', 'line', 'pie'];
// Mirrors the server's composition hints. The client keeps them through edits; the server writes them in the design pass.
export const IMAGE_ROLES = ['hero', 'supporting', 'background', 'spotlight'];
export const IMAGE_SIDES = ['left', 'right', 'top', 'bottom', 'full'];
export const IMAGE_FITS = ['contain', 'cover'];
export const FOCAL_POINTS = ['center', 'left', 'right', 'top', 'bottom'];
export const DENSITIES = ['calm', 'balanced', 'dense'];
export const EMPHASES = ['title', 'image', 'content', 'balanced'];
export const VARIANTS = ['standard', 'editorial', 'feature', 'quote-led'];
const pickHint = (list, value, fallback) => (list.includes(value) ? value : fallback);

const PRESENTATION_ASSET = /^\/api\/presentations\/assets\/\d+\/[A-Za-z0-9._-]+(?:\?.*)?$/;

/** An <img> cannot send the Bearer token, so owned presentation assets are fetched and shown from a blob URL. */
export function PresentationImage({ src, alt = '', ...rest }) {
  const owned = PRESENTATION_ASSET.test(String(src || ''));
  const [shown, setShown] = useState(() => (owned ? '' : src || ''));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    let objectUrl = '';
    setFailed(false);
    if (!owned) {
      setShown(src || '');
      return undefined;
    }
    setShown('');
    api.get(src)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Asset failed (${res.status})`);
        const blob = await res.blob();
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setShown(objectUrl);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [owned, src]);

  if (failed) {
    return <span {...rest} role="img" aria-label={`${alt} (unavailable)`} style={{ ...(rest.style || {}), display: 'grid', placeItems: 'center', color: 'var(--color-muted)', fontSize: '11px' }}>Unavailable</span>;
  }
  if (!shown) {
    return <span {...rest} role="img" aria-label={alt} style={{ ...(rest.style || {}), background: 'var(--color-surface)' }} />;
  }
  return <img {...rest} src={shown} alt={alt} />;
}

export const FIELD_STYLE = {
  background: 'var(--color-bg)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};
export const CARD_STYLE = {
  borderColor: 'var(--color-border)',
  background: 'var(--color-surface)',
};
// Class strings from client/DESIGN.md, so every Presentations tool shapes its cards, rows, fields and buttons the same way.
export const CARD = 'rounded-2xl border p-6 space-y-4';
export const ROW = 'rounded-xl border p-4';
export const SELECT = 'w-full px-3 py-2.5 rounded-xl border text-sm';
export const BTN_PRIMARY = 'px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-40';
export const BTN_SECONDARY = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-40';
export const BTN_QUIET = 'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-opacity duration-200 hover:opacity-70 disabled:opacity-40';
export const PRIMARY_STYLE = { background: 'var(--color-primary)', color: 'var(--color-on-primary)' };
export const SECONDARY_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
export const LAYOUT_LABELS = {
  title: 'Title', section: 'Section header', bullets: 'Bullets', agenda: 'Agenda', 'two-column': 'Two column', comparison: 'Comparison',
  'three-column': 'Three columns', stats: 'Big numbers', quote: 'Quote', timeline: 'Timeline', picture: 'Picture', 'full-picture': 'Full picture', closing: 'Closing',
};
// What each layout uses, shown under the layout picker in the slide editor.
export const LAYOUT_HELP = {
  title: 'The opening slide: the title, with the body as a subtitle.',
  section: 'A divider between parts of the talk: the title, with an optional line of body text.',
  bullets: 'A heading and up to six points, with optional body text underneath.',
  agenda: 'A numbered list of what the talk covers: one item per bullet.',
  'two-column': 'A paragraph (body) on the left and points (bullets) on the right.',
  comparison: 'Two options side by side: fill in the two columns below.',
  'three-column': 'Three ideas, steps or features: fill in the three columns below.',
  stats: 'Two to four key numbers: put the number as the column heading and what it measures as its first bullet.',
  quote: 'A quotation: the body is the quote and the title is who said it.',
  timeline: 'Milestones in order, one per bullet, like “2024 — Opened in Brisbane”.',
  picture: 'An image on the left with points or a paragraph on the right.',
  'full-picture': 'One image filling the slide, with the title and a short line on a strip.',
  closing: 'The last slide: thanks, next steps or questions.',
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/**
 * One shape for every theme the pickers show: a built-in id string, a built-in object from GET /templates (id, label, bg, text,
 * primary) or a saved row ({ id: row id, name, theme: { id, ... } }). A saved theme is used on a deck by its theme id and deleted
 * by its row id.
 */
export function themeOptions(list) {
  return (Array.isArray(list) ? list : []).map((t) => {
    if (typeof t === 'string') return { id: t, label: cap(t) };
    const theme = t?.theme && typeof t.theme === 'object' ? t.theme : t;
    const id = String(theme?.id || t?.id || 'paper');
    return {
      id,
      label: t?.name || theme?.label || cap(id),
      bg: theme?.bg, text: theme?.text, primary: theme?.primary, muted: theme?.muted,
      rowId: t?.theme ? t.id : undefined,
    };
  });
}

const text = (v) => (typeof v === 'string' ? v : (v == null ? '' : String(v)));
const capped = (v, n) => text(v).slice(0, n);
const num = (v, fallback, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
// Keep a part-typed colour while someone edits a slide background. The server validates hex colours on save, but
// setDeck() normalises on every keystroke, so rejecting "#f" here made the field look uneditable.
const hex = (v) => {
  const s = text(v);
  return /^#?[0-9a-fA-F]{0,8}$/.test(s) ? s : '';
};
const rich = (v, n = 1200) => text(v).replace(/<\s*\/?\s*(?!b\b|strong\b|i\b|em\b|u\b|br\b)[^>]*>/gi, '').slice(0, n);

function normalizeDesign(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    imageRole: pickHint(IMAGE_ROLES, d.imageRole, 'supporting'),
    imageSide: pickHint(IMAGE_SIDES, d.imageSide, 'right'),
    imageFit: pickHint(IMAGE_FITS, d.imageFit, 'contain'),
    focalPoint: pickHint(FOCAL_POINTS, d.focalPoint, 'center'),
    scrim: num(d.scrim, 0, 0, 0.85),
    density: pickHint(DENSITIES, d.density, 'balanced'),
    emphasis: pickHint(EMPHASES, d.emphasis, 'balanced'),
    variant: pickHint(VARIANTS, d.variant, 'standard'),
    imageAspect: num(d.imageAspect, 0, 0, 8),
    imageWidth: num(d.imageWidth, 0, 0, 20000),
    imageHeight: num(d.imageHeight, 0, 0, 20000),
  };
}

/** Plain text from the small inline-format subset, for previews and labels that must not show tags. */
export function stripRich(value) {
  return text(value)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}

export function newSlide(index = 0) {
  return {
    id: `s${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    layout: index === 0 ? 'title' : 'bullets',
    title: '', bullets: [], body: '', columns: [], imageRef: '', notes: '',
    background: '', imagePrompt: '', design: normalizeDesign({}), images: [], shapes: [], chart: null, table: null, rich: null,
  };
}

export function emptyDeck() {
  return {
    schemaVersion: 2, title: '', subtitle: '', themeId: 'paper', designId: 'clean', transition: 'fade', aspect: '16:9',
    audience: '', tone: '', duration: 12, nSlides: 10, outline: [], slides: [],
  };
}

function normalizeOutlineSlide(item, i) {
  const s = item && typeof item === 'object' ? item : {};
  return {
    layout: LAYOUTS.includes(s.layout) ? s.layout : (i === 0 ? 'title' : 'bullets'),
    title: capped(s.title, 160) || `Slide ${i + 1}`,
    bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => capped(b, 300)).filter(Boolean).slice(0, 6) : [],
    body: capped(s.body, 1200),
    columns: Array.isArray(s.columns)
      ? s.columns.slice(0, 4).map((c) => ({ heading: capped(c?.heading, 80), bullets: Array.isArray(c?.bullets) ? c.bullets.map((b) => capped(b, 200)).filter(Boolean).slice(0, 5) : [] }))
      : [],
    imageRef: capped(s.imageRef, 2000),
    imagePrompt: capped(s.imagePrompt, 300),
    notes: capped(s.notes, 1200),
  };
}

function normalizeMediaSlide(s, i) {
  const base = {
    id: capped(s.id, 80) || `s${i + 1}`,
    layout: LAYOUTS.includes(s.layout) ? s.layout : 'bullets',
    title: capped(s.title, 160),
    bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => capped(b, 300)).filter(Boolean).slice(0, 8) : [],
    body: capped(s.body, 1200),
    columns: Array.isArray(s.columns)
      ? s.columns.slice(0, 4).map((c) => ({
        heading: capped(c?.heading, 80),
        bullets: Array.isArray(c?.bullets) ? c.bullets.map((b) => capped(b, 200)).filter(Boolean).slice(0, 5) : [],
      }))
      : [],
    imageRef: capped(s.imageRef, 2000),
    notes: capped(s.notes, 1200),
    background: hex(s.background),
    imagePrompt: capped(s.imagePrompt, 300),
    design: normalizeDesign(s.design),
    images: Array.isArray(s.images) ? s.images.slice(0, 12).map((im, j) => ({
      id: capped(im?.id, 80) || `img${j + 1}`, ref: capped(im?.ref, 2000),
      x: num(im?.x, 55, 0, 100), y: num(im?.y, 20, 0, 100),
      w: num(im?.w, 36, 1, 100), h: num(im?.h, 36, 1, 100),
      fit: ['contain', 'cover'].includes(im?.fit) ? im.fit : 'contain',
    })).filter((im) => im.ref) : [],
    shapes: Array.isArray(s.shapes) ? s.shapes.slice(0, 16).map((sh, j) => ({
      id: capped(sh?.id, 80) || `shape${j + 1}`,
      kind: SHAPE_KINDS.includes(sh?.kind) ? sh.kind : 'rect',
      x: num(sh?.x, 10, 0, 100), y: num(sh?.y, 10, 0, 100),
      w: num(sh?.w, 20, 1, 100), h: num(sh?.h, 12, 1, 100),
      fill: SHAPE_COLOURS.includes(sh?.fill) ? sh.fill : 'primary',
      stroke: SHAPE_COLOURS.includes(sh?.stroke) ? sh.stroke : '',
      strokeWidth: num(sh?.strokeWidth, 1, 0, 8),
      alpha: num(sh?.alpha, 0.15, 0, 1),
      rotation: num(sh?.rotation, 0, -180, 180),
    })) : [],
    chart: null,
    table: null,
    rich: null,
  };
  if (s.chart && typeof s.chart === 'object' && Array.isArray(s.chart.series) && s.chart.series.length) {
    base.chart = {
      type: CHART_TYPES.includes(s.chart.type) ? s.chart.type : 'bar',
      title: capped(s.chart.title, 160),
      labels: Array.isArray(s.chart.labels) ? s.chart.labels.slice(0, 12).map((l) => capped(l, 80)) : [],
      series: s.chart.series.slice(0, 6).map((se, j) => ({
        name: capped(se?.name, 80) || `Series ${j + 1}`,
        values: Array.isArray(se?.values) ? se.values.slice(0, 12).map((v) => num(v, 0, -1000000, 1000000)) : [],
      })).filter((se) => se.values.length),
      x: num(s.chart.x, 8, 0, 100), y: num(s.chart.y, 25, 0, 100),
      w: num(s.chart.w, 84, 10, 100), h: num(s.chart.h, 55, 10, 100),
    };
    if (!base.chart.series.length) base.chart = null;
  }
  if (s.table && typeof s.table === 'object' && Array.isArray(s.table.rows)) {
    base.table = {
      rows: s.table.rows.slice(0, 12).map((row) => (Array.isArray(row) ? row : []).slice(0, 8).map((cell) => capped(cell, 200))),
      header: s.table.header !== false,
      x: num(s.table.x, 8, 0, 100), y: num(s.table.y, 25, 0, 100),
      w: num(s.table.w, 84, 10, 100), h: num(s.table.h, 55, 10, 100),
    };
  }
  const r = s.rich && typeof s.rich === 'object' ? s.rich : null;
  if (r) {
    const clean = {
      title: rich(r.title, 500), body: rich(r.body, 1200),
      bullets: Array.isArray(r.bullets) ? r.bullets.slice(0, 6).map((b) => rich(b, 500)).filter(Boolean) : [],
    };
    if (clean.title || clean.body || clean.bullets.length) base.rich = clean;
  }
  return base;
}

/** Defensive client-side normalisation of anything that comes back from the API or from a handoff file. */
export function normalizeDeck(raw, maxSlides = 20) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const slides = Array.isArray(src.slides)
    ? src.slides.slice(0, Math.max(1, maxSlides)).map(normalizeMediaSlide)
    : [];
  return {
    schemaVersion: 2,
    title: capped(src.title, 160),
    subtitle: capped(src.subtitle, 240),
    themeId: capped(src.themeId, 80) || 'paper',
    designId: capped(src.designId, 40) || 'clean',
    transition: TRANSITIONS.map((t) => t.id).includes(src.transition) ? src.transition : 'fade',
    aspect: ASPECTS.includes(src.aspect) ? src.aspect : '16:9',
    audience: capped(src.audience, 160),
    tone: capped(src.tone, 80),
    duration: num(src.duration ?? 12, 12, 1, 180),
    nSlides: num(src.nSlides ?? slides.length, slides.length, 1, 20),
    outline: Array.isArray(src.outline) ? src.outline.slice(0, 20).map(normalizeOutlineSlide) : [],
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

/** Tool heading with the standard (?) help button. The line describing the tool is shown by the page (TOOL_BLURBS). */
export function ToolHeader({ id, title }) {
  const getIcon = useIcon();
  const { setHelpTool } = usePresentations();
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
      <Tooltip text={`How ${title} works: what it does and what it cannot do.`}>
        <button
          type="button"
          aria-label={`How ${title} works`}
          onClick={() => setHelpTool(id)}
          className="transition-opacity duration-200 hover:opacity-60"
          style={{ color: 'var(--color-muted)', lineHeight: 1 }}
        >
          {getIcon('help-circle', { size: 14 })}
        </button>
      </Tooltip>
    </div>
  );
}

/** Inline Yes/No for a routine delete (DESIGN.md: high-stakes deletes use ConfirmModal, routine ones confirm in place). */
export function InlineDelete({ pending, onAsk, onConfirm, onCancel, what, disabled }) {
  if (!pending) {
    return (
      <Tooltip text={`Delete ${what}. It goes to the recycle bin for 30 days.`}>
        <button type="button" onClick={onAsk} disabled={disabled} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>Delete</button>
      </Tooltip>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs" style={{ color: 'var(--color-text)' }}>Delete?</span>
      <Tooltip text={`Yes, delete ${what}.`}>
        <button type="button" onClick={onConfirm} disabled={disabled} className={BTN_QUIET} style={{ color: '#991b1b' }}>Yes</button>
      </Tooltip>
      <Tooltip text="No, keep it.">
        <button type="button" onClick={onCancel} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>No</button>
      </Tooltip>
    </span>
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
    <div className={ROW} style={CARD_STYLE} role="status" aria-live="polite">
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
            <button type="button" onClick={cancelJob} className={BTN_SECONDARY} style={SECONDARY_STYLE}>Cancel</button>
          </Tooltip>
        )}
        {canResume && (
          <Tooltip text="Pick this job up again where it stopped.">
            <button type="button" onClick={resumeJob} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>
              {getIcon('refresh-cw', { size: 12 })} Resume
            </button>
          </Tooltip>
        )}
        <Tooltip text="Hide this job status.">
          <button type="button" onClick={dismissJob} aria-label="Hide the job status" className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>
            {getIcon('x', { size: 14 })}
          </button>
        </Tooltip>
      </div>
      {busy && typeof job.progress === 'number' && (
        <div className="h-1.5 mt-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
          <span className="block h-full transition-all duration-200" style={{ width: `${Math.max(4, Math.min(100, job.progress))}%`, background: 'var(--color-primary)' }} />
        </div>
      )}
      {job.error && <p className="text-xs mt-2" style={{ color: '#991b1b' }}>{job.error}</p>}
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
        className="text-xs px-3 py-1.5 rounded-lg border cursor-pointer"
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
