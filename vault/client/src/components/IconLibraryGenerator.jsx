import React, { useRef, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import api from '../utils/apiClient';
import ProcessingModal from './ProcessingModal';

const pascalCase = (name) => String(name || '')
  .split(/[-_\s]+/)
  .filter(Boolean)
  .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  .join('');

const STROKE_OPTIONS = [['super-thin', 'Super thin'], ['thin', 'Thin'], ['regular', 'Regular'], ['bold', 'Bold']];
const FILL_OPTIONS = [['outlined', 'Outlined'], ['filled', 'Filled'], ['duotone', 'Duotone']];
const CORNER_OPTIONS = [['sharp', 'Sharp'], ['slightly-rounded', 'Slightly rounded'], ['fully-rounded', 'Fully rounded']];
const DETAIL_OPTIONS = [['simple', 'Simple'], ['medium', 'Medium'], ['detailed', 'Detailed']];

const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };

function LucideRef({ name }) {
  const Cmp = LucideIcons[pascalCase(name)];
  if (!Cmp) return null;
  return <Cmp size={24} strokeWidth={2} />;
}

function downloadSvgFile(name, svg) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function IconLibraryGenerator({ getIcon }) {
  const [subject, setSubject] = useState('');
  const [refsLoading, setRefsLoading] = useState(false);
  const [refs, setRefs] = useState(null); // { lucide:[], fontawesome:[] }
  const [selectedRefs, setSelectedRefs] = useState(() => new Set());
  const [refsError, setRefsError] = useState('');

  const [count, setCount] = useState(10);
  const [color, setColor] = useState('#2563eb');
  const [strokeWeight, setStrokeWeight] = useState('regular');
  const [fillStyle, setFillStyle] = useState('outlined');
  const [corners, setCorners] = useState('slightly-rounded');
  const [detail, setDetail] = useState('medium');

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [generated, setGenerated] = useState([]); // [{uid, name, svg}]
  const [selectedIcons, setSelectedIcons] = useState(() => new Set());

  const [addMore, setAddMore] = useState(false);
  const [moreCount, setMoreCount] = useState(6);
  const [feedback, setFeedback] = useState('');
  const [moreBusy, setMoreBusy] = useState(false);

  const uidRef = useRef(0);
  const withUid = (icon) => ({ ...icon, uid: `i${uidRef.current++}` });

  const spin = (icon) => (getIcon ? getIcon(icon, { size: 15, className: 'animate-spin' }) : null);
  const ic = (icon) => (getIcon ? getIcon(icon, { size: 15 }) : null);

  const findReferences = async () => {
    const s = subject.trim();
    if (!s) return;
    setRefsLoading(true);
    setRefsError('');
    setRefs(null);
    setSelectedRefs(new Set());
    try {
      const res = await api.post('/api/graphics/icon-references', { subject: s });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not fetch references');
      setRefs({ lucide: data.lucide || [], fontawesome: data.fontawesome || [] });
    } catch (err) {
      setRefsError(err.message || 'Could not fetch references');
    } finally {
      setRefsLoading(false);
    }
  };

  const toggleRef = (key) => {
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const generate = async () => {
    if (!selectedRefs.size) return;
    setGenerating(true);
    setGenError('');
    setSelectedIcons(new Set());
    try {
      const references = [...selectedRefs].map((k) => {
        const [src, name] = k.split(':');
        return `${name} (${src === 'fa' ? 'Font Awesome' : 'Lucide'})`;
      });
      const res = await api.post('/api/graphics/icon-generate', {
        subject: subject.trim(), references, count: Number(count), color, strokeWeight, fillStyle, corners, detail,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setGenerated((data.icons || []).map(withUid));
    } catch (err) {
      setGenError(err.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  // Generate additional icons that match the current set (optionally guided by feedback).
  const generateMore = async () => {
    if (!addMore) return;
    if (!selectedRefs.size && !generated.length) return;
    setMoreBusy(true);
    setGenError('');
    try {
      const references = [...selectedRefs].map((k) => {
        const [src, name] = k.split(':');
        return `${name} (${src === 'fa' ? 'Font Awesome' : 'Lucide'})`;
      });
      const res = await api.post('/api/graphics/icon-generate', {
        subject: subject.trim(),
        references,
        count: Number(moreCount),
        color, strokeWeight, fillStyle, corners, detail,
        existing: generated.map((g) => g.name),
        feedback: feedback.trim(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setGenerated((prev) => [...prev, ...(data.icons || []).map(withUid)]);
      setFeedback('');
    } catch (err) {
      setGenError(err.message || 'Generation failed');
    } finally {
      setMoreBusy(false);
    }
  };

  const toggleIcon = (uid) => {
    setSelectedIcons((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const removeIcon = (uid) => {
    setGenerated((prev) => prev.filter((g) => g.uid !== uid));
    setSelectedIcons((prev) => {
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
  };

  const downloadSelected = () => {
    const list = generated.filter((g) => selectedIcons.has(g.uid));
    (list.length ? list : generated).forEach((icon, idx) => {
      setTimeout(() => downloadSvgFile(icon.name, icon.svg), idx * 150);
    });
  };

  const downloadAll = () => {
    generated.forEach((icon, idx) => setTimeout(() => downloadSvgFile(icon.name, icon.svg), idx * 150));
  };

  const refTile = (src, name) => {
    const key = `${src}:${name}`;
    const active = selectedRefs.has(key);
    return (
      <button
        key={key}
        type="button"
        onClick={() => toggleRef(key)}
        className="flex flex-col items-center justify-center gap-1 rounded-xl border p-2 hover:opacity-80"
        style={{
          borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
          background: active ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)' : 'var(--color-bg)',
          color: 'var(--color-text)',
          minWidth: 76,
        }}
        title={`${name} · ${src === 'fa' ? 'Font Awesome' : 'Lucide'}`}
      >
        <span className="h-7 flex items-center justify-center" style={{ color: active ? 'var(--color-primary)' : 'var(--color-text)' }}>
          {src === 'lucide' ? <LucideRef name={name} /> : <i className={`fa-solid fa-${name}`} style={{ fontSize: 20 }} />}
        </span>
        <span className="text-[10px] truncate max-w-[68px]" style={{ color: 'var(--color-muted)' }}>{name}</span>
        <span className="text-[8px] uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{src === 'fa' ? 'FA' : 'Lucide'}</span>
      </button>
    );
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>AI icon library</h2>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Powered by Claude · generates SVG</span>
      </div>

      {/* Step 1 — subject + references */}
      <div className="rounded-2xl border p-4 mb-4 space-y-3" style={card}>
        <label className="block text-xs font-medium" style={{ color: 'var(--color-muted)' }}>1 · Subject</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') findReferences(); }}
            placeholder="e.g. finance, healthcare, social media"
            className="grow px-3 py-2 rounded-xl border text-sm"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <button
            type="button"
            onClick={findReferences}
            disabled={refsLoading || !subject.trim()}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
            style={{ background: 'var(--color-primary)' }}
          >
            {refsLoading ? spin('loader') : ic('search')}
            {refsLoading ? 'Finding…' : 'Find references'}
          </button>
        </div>
        {refsError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{refsError}</div>}
        {refs && (
          <div className="space-y-2">
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Pick one or more reference styles ({selectedRefs.size} selected):</p>
            <div className="flex flex-wrap gap-2">
              {refs.lucide.map((n) => refTile('lucide', n))}
              {refs.fontawesome.map((n) => refTile('fa', n))}
            </div>
            {!refs.lucide.length && !refs.fontawesome.length && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No references found — try a different subject.</p>
            )}
          </div>
        )}
      </div>

      {/* Step 2 — generation controls */}
      {selectedRefs.size > 0 && (
        <div className="rounded-2xl border p-4 mb-4 space-y-4" style={card}>
          <label className="block text-xs font-medium" style={{ color: 'var(--color-muted)' }}>2 · Style</label>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Count: {count}</label>
              <input type="range" min="5" max="20" value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Colour</label>
              <div className="flex items-center gap-2">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} />
                <input type="text" value={color} onChange={(e) => setColor(e.target.value)} className="w-24 px-2 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Stroke weight</label>
              <select value={strokeWeight} onChange={(e) => setStrokeWeight(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                {STROKE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Fill style</label>
              <select value={fillStyle} onChange={(e) => setFillStyle(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                {FILL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Corners</label>
              <select value={corners} onChange={(e) => setCorners(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                {CORNER_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Detail level</label>
              <select value={detail} onChange={(e) => setDetail(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                {DETAIL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          {genError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{genError}</div>}
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
            style={{ background: 'var(--color-primary)' }}
          >
            {generating ? spin('loader') : ic('sparkles')}
            {generating ? 'Generating…' : `Generate ${count} icons`}
          </button>
        </div>
      )}

      {/* Step 3 — generated grid */}
      {generated.length > 0 && (
        <div className="rounded-2xl border p-4 space-y-4" style={card}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
              3 · {generated.length} icons · {selectedIcons.size} selected
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={downloadSelected} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>
                Download selected
              </button>
              <button type="button" onClick={downloadAll} className="text-xs px-3 py-1.5 rounded-lg text-white hover:opacity-90" style={{ background: 'var(--color-primary)' }}>
                Download all
              </button>
            </div>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Click an icon to select it; hover and hit × to remove ones you don't want.</p>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
            {generated.map((icon) => {
              const active = selectedIcons.has(icon.uid);
              return (
                <div
                  key={icon.uid}
                  className="group relative flex flex-col items-center gap-2 rounded-xl border p-3 cursor-pointer hover:opacity-95"
                  onClick={() => toggleIcon(icon.uid)}
                  style={{
                    borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                    background: active ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)' : 'var(--color-bg)',
                  }}
                  title={icon.name}
                >
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeIcon(icon.uid); }}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full text-xs leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 hover:scale-110 transition"
                    style={{ background: '#fee2e2', color: '#991b1b' }}
                    title="Remove this icon"
                    aria-label={`Remove ${icon.name}`}
                  >
                    ×
                  </button>
                  <span className="icon-svg-box" style={{ width: 56, height: 56 }} dangerouslySetInnerHTML={{ __html: icon.svg }} />
                  <span className="text-[10px] truncate max-w-[84px]" style={{ color: 'var(--color-muted)' }}>{icon.name}</span>
                </div>
              );
            })}
          </div>

          {/* Refine / add more */}
          <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <label className="block text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Want more? Remove what doesn't fit, then ask for additions in the same style.</label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={2}
              placeholder="What's missing or what should change? e.g. add a 'mobile payment' and a 'savings' icon; make them a touch more rounded (optional)"
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={addMore} onChange={(e) => setAddMore(e.target.checked)} />
                <span className="text-xs" style={{ color: 'var(--color-text)' }}>Generate additional icons</span>
              </label>
              {addMore && (
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>How many:</span>
                  <input type="number" min="1" max="20" value={moreCount} onChange={(e) => setMoreCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="w-16 px-2 py-1.5 rounded-lg border text-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </div>
              )}
              <button
                type="button"
                onClick={generateMore}
                disabled={moreBusy || !addMore}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
                style={{ background: 'var(--color-primary)' }}
                title={addMore ? '' : 'Tick "Generate additional icons" first'}
              >
                {moreBusy ? spin('loader') : ic('plus')}
                {moreBusy ? 'Generating…' : feedback.trim() ? 'Refine & add' : 'Generate more like these'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ProcessingModal
        open={refsLoading || generating || moreBusy}
        title={refsLoading ? 'Finding reference icons…' : moreBusy ? 'Generating more icons…' : 'Generating icons…'}
        message="Claude is designing your SVGs — this can take a few moments."
      />
    </section>
  );
}
