import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as opentype from 'opentype.js';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { findUncoveredChars } from './coverageCheck';
import { DEFAULT_FILL, DEFAULT_SHADOW, buildCssSnippet, buildPreviewStyle } from './effectsCss';

const PREVIEW_DEFAULT_TEXT = 'Handgloves';

function slugify(name) {
  return (name || 'custom-font').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export default function FontEffectsPanel() {
  const getIcon = useIcon();
  const fontInputRef = useRef(null);
  const reportInputRef = useRef(null);
  const imageInputRef = useRef(null);

  const [fontBuffer, setFontBuffer] = useState(null);
  const [familyName, setFamilyName] = useState('');
  const [loadError, setLoadError] = useState('');
  const [fontReady, setFontReady] = useState(false);

  const [coverageReport, setCoverageReport] = useState(null);
  const [reportError, setReportError] = useState('');

  const [previewText, setPreviewText] = useState(PREVIEW_DEFAULT_TEXT);
  const [fill, setFill] = useState(DEFAULT_FILL);
  const [shadows, setShadows] = useState([]);
  const [uncoveredChars, setUncoveredChars] = useState([]);
  const [copied, setCopied] = useState(false);

  // Load the real exported font via FontFace + @font-face — never opentype.js/canvas rendering here.
  const handleFontFile = useCallback(async (file) => {
    if (!file) return;
    setLoadError('');
    setFontReady(false);
    try {
      const buffer = await file.arrayBuffer();
      setFontBuffer(buffer);

      // Read the real renamed family name straight from the exported
      // font's own name table (metadata inspection, not rendering).
      const parsed = opentype.parse(buffer.slice(0));
      const family = parsed.names?.fontFamily?.en || file.name.replace(/\.[^.]+$/, '');
      setFamilyName(family);

      const fontFace = new FontFace(family, buffer);
      await fontFace.load();
      document.fonts.add(fontFace);
      setFontReady(true);
    } catch (err) {
      setLoadError(`Could not load this font file: ${err.message}`);
      setFontReady(false);
    }
  }, []);

  const handleReportFile = useCallback(async (file) => {
    if (!file) return;
    setReportError('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setCoverageReport(parsed);
    } catch (err) {
      setReportError(`Could not read coverage report: ${err.message}`);
      setCoverageReport(null);
    }
  }, []);

  const handleImageFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setFill((f) => ({ ...f, mode: 'image', imageDataUrl: reader.result }));
    reader.readAsDataURL(file);
  }, []);

  // Coverage check re-runs whenever the font, report, or preview text changes.
  useEffect(() => {
    if (!fontBuffer) {
      setUncoveredChars([]);
      return;
    }
    setUncoveredChars(findUncoveredChars(fontBuffer.slice(0), coverageReport, previewText));
  }, [fontBuffer, coverageReport, previewText]);

  const updateShadow = (index, patch) => {
    setShadows((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };
  const addShadow = () => setShadows((prev) => [...prev, { ...DEFAULT_SHADOW }]);
  const removeShadow = (index) => setShadows((prev) => prev.filter((_, i) => i !== index));

  const updateGradientStop = (index, patch) => {
    setFill((f) => ({
      ...f,
      gradientStops: f.gradientStops.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  };

  const woff2Filename = `${slugify(familyName)}.woff2`;
  const cssSnippet = fontReady
    ? buildCssSnippet({ familyName, woff2Filename, fill, shadows })
    : '';

  const copyCss = async () => {
    try {
      await navigator.clipboard.writeText(cssSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (permissions) — snippet is still selectable/visible in the <pre>
    }
  };

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <div className="flex-1 flex flex-col overflow-y-auto p-6 gap-5">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Effects &amp; Export</h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Loads your actual Phase 4 export via a real <code>@font-face</code> — not the Phase 2/3 structural preview.
            Color, shadow, and image-fill here are CSS only; they never touch the font file.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg p-4 flex items-center gap-3" style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}>
            {getIcon('type', { size: 18 })}
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate" style={{ color: 'var(--color-text)' }}>
                {fontReady ? familyName : 'Load your exported .woff2/.ttf/.otf'}
              </p>
              {loadError && <p className="text-xs" style={{ color: '#ef4444' }}>{loadError}</p>}
            </div>
            <input ref={fontInputRef} type="file" accept=".woff2,.ttf,.otf" className="hidden" onChange={(e) => handleFontFile(e.target.files?.[0])} />
            <button onClick={() => fontInputRef.current?.click()} className="text-sm px-3 py-1.5 rounded hover:opacity-70 transition-all duration-200" style={{ background: 'var(--color-primary)', color: '#fff' }}>
              Choose file
            </button>
          </div>

          <div className="rounded-lg p-4 flex items-center gap-3" style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}>
            {getIcon('file-text', { size: 18 })}
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate" style={{ color: 'var(--color-text)' }}>
                {coverageReport ? 'Coverage report loaded' : 'Optional: Phase 4 coverage report (JSON)'}
              </p>
              {reportError && <p className="text-xs" style={{ color: '#ef4444' }}>{reportError}</p>}
            </div>
            <input ref={reportInputRef} type="file" accept=".json" className="hidden" onChange={(e) => handleReportFile(e.target.files?.[0])} />
            <button onClick={() => reportInputRef.current?.click()} className="text-sm px-3 py-1.5 rounded hover:opacity-70 transition-all duration-200" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              Choose file
            </button>
          </div>
        </div>

        <div>
          <input
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder="Preview text…"
            className="w-full rounded px-3 py-2 text-sm"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>

        {uncoveredChars.length > 0 && (
          <div className="rounded-lg p-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444', color: '#ef4444' }}>
            <strong>Character coverage issue:</strong>{' '}
            {uncoveredChars.map((u, i) => (
              <span key={u.char + i}>
                {i > 0 && ', '}
                "{u.char}" {u.reason === 'skipped_at_export' ? `(skipped at export — ${u.detail})` : '(not in this exported font — check your subset ranges)'}
              </span>
            ))}
            . These characters will not render correctly — no silent fallback is shown here on purpose.
          </div>
        )}

        <div
          className="rounded-lg flex items-center justify-center p-10 overflow-hidden"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', minHeight: 160 }}
        >
          {fontReady ? (
            <span style={{ fontSize: 64, lineHeight: 1.2, ...buildPreviewStyle(familyName, fill, shadows) }}>
              {previewText || PREVIEW_DEFAULT_TEXT}
            </span>
          ) : (
            <span className="text-sm" style={{ color: 'var(--color-muted)' }}>Load a font file to preview effects.</span>
          )}
        </div>

        {fontReady && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>CSS snippet</span>
              <button onClick={copyCss} className="text-xs px-2 py-1 rounded hover:opacity-70 transition-all duration-200" style={{ background: 'var(--color-primary)', color: '#fff' }}>
                {copied ? 'Copied!' : 'Copy CSS'}
              </button>
            </div>
            <pre
              className="text-xs rounded p-3 overflow-x-auto whitespace-pre-wrap"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              {cssSnippet}
            </pre>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              Update the <code>src url()</code> to wherever you host <code>{woff2Filename}</code> — this is your exported Phase 4 file, unchanged.
            </p>
          </div>
        )}
      </div>

      <div className="w-80 flex-shrink-0 overflow-y-auto p-5 space-y-5" style={{ background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}>
        <div>
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Fill</span>
          <div className="flex gap-1 mt-2 mb-2">
            {['solid', 'gradient', 'image'].map((mode) => (
              <button
                key={mode}
                onClick={() => setFill((f) => ({ ...f, mode }))}
                className="flex-1 text-xs px-2 py-1.5 rounded capitalize hover:opacity-70 transition-all duration-200"
                style={{ background: fill.mode === mode ? 'var(--color-primary)' : 'transparent', color: fill.mode === mode ? '#fff' : 'var(--color-text)', border: '1px solid var(--color-border)' }}
              >
                {mode}
              </button>
            ))}
          </div>

          {fill.mode === 'solid' && (
            <input type="color" value={fill.solidColor} onChange={(e) => setFill((f) => ({ ...f, solidColor: e.target.value }))} className="w-full h-9 rounded" />
          )}

          {fill.mode === 'gradient' && (
            <div className="space-y-2">
              {fill.gradientStops.map((stop, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="color" value={stop.color} onChange={(e) => updateGradientStop(i, { color: e.target.value })} className="w-9 h-9 rounded" />
                  <input
                    type="range" min={0} max={100} value={stop.position}
                    onChange={(e) => updateGradientStop(i, { position: Number(e.target.value) })}
                    className="flex-1"
                  />
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Angle</span>
                <input type="range" min={0} max={360} value={fill.gradientAngle} onChange={(e) => setFill((f) => ({ ...f, gradientAngle: Number(e.target.value) }))} className="flex-1" />
                <span className="text-xs w-10 text-right" style={{ color: 'var(--color-muted)' }}>{fill.gradientAngle}°</span>
              </div>
            </div>
          )}

          {fill.mode === 'image' && (
            <div>
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageFile(e.target.files?.[0])} />
              <button
                onClick={() => imageInputRef.current?.click()}
                className="w-full text-sm px-3 py-2 rounded hover:opacity-70 transition-all duration-200"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              >
                {fill.imageDataUrl ? 'Change image' : 'Choose image/texture'}
              </button>
              {fill.imageDataUrl && (
                <img src={fill.imageDataUrl} alt="fill texture" className="w-full h-16 object-cover rounded mt-2" />
              )}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Tooltip text="Layer multiple shadows for depth — e.g. a tight dark shadow plus a soft wide one.">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Shadows</span>
            </Tooltip>
            <button onClick={addShadow} className="text-xs hover:opacity-70 transition-all duration-200" style={{ color: 'var(--color-primary)' }}>
              + Add layer
            </button>
          </div>

          <div className="space-y-3 mt-2">
            {shadows.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No shadow layers.</p>}
            {shadows.map((shadow, i) => (
              <div key={i} className="rounded p-2 space-y-1.5" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Layer {i + 1}</span>
                  <button onClick={() => removeShadow(i)} className="hover:opacity-70 transition-all duration-200" style={{ color: 'var(--color-muted)' }}>
                    {getIcon('trash', { size: 12 })}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex flex-col gap-0.5" style={{ color: 'var(--color-muted)' }}>
                    X
                    <input type="number" value={shadow.offsetX} onChange={(e) => updateShadow(i, { offsetX: Number(e.target.value) })} className="rounded px-1.5 py-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                  </label>
                  <label className="flex flex-col gap-0.5" style={{ color: 'var(--color-muted)' }}>
                    Y
                    <input type="number" value={shadow.offsetY} onChange={(e) => updateShadow(i, { offsetY: Number(e.target.value) })} className="rounded px-1.5 py-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                  </label>
                  <label className="flex flex-col gap-0.5" style={{ color: 'var(--color-muted)' }}>
                    Blur
                    <input type="number" min={0} value={shadow.blur} onChange={(e) => updateShadow(i, { blur: Number(e.target.value) })} className="rounded px-1.5 py-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                  </label>
                  <label className="flex flex-col gap-0.5" style={{ color: 'var(--color-muted)' }}>
                    Color
                    <input type="text" value={shadow.color} onChange={(e) => updateShadow(i, { color: e.target.value })} className="rounded px-1.5 py-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
