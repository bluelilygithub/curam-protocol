import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as opentype from 'opentype.js';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { findUncoveredChars } from './coverageCheck';
import { DEFAULT_FILL, DEFAULT_SHADOW, buildCssSnippet, buildPreviewStyle } from './effectsCss';
import { buildOutlinedSvg } from './svgExport';

const PREVIEW_DEFAULT_TEXT = 'Handgloves';

function slugify(name) {
  return (name || 'custom-font').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function dataUrlToArrayBuffer(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * @param {object} [props.pendingExport] - { formats: {ttf?,woff2?,otf?: dataUrl}, report } from
 *   FontExportTrigger's server-side "Customize → Export" flow. When set, loads that result
 *   automatically — the manual drag-in below still works independently as a fallback/advanced path.
 * @param {() => void} [props.onPendingExportConsumed] - clears the parent's pendingExport state once loaded.
 */
export default function FontEffectsPanel({ pendingExport, onPendingExportConsumed }) {
  const getIcon = useIcon();
  const fontInputRef = useRef(null);
  const reportInputRef = useRef(null);
  const imageInputRef = useRef(null);

  const [fontBuffer, setFontBuffer] = useState(null);
  const [familyName, setFamilyName] = useState('');
  const [loadError, setLoadError] = useState('');
  const [fontReady, setFontReady] = useState(false);
  const [loadedVia, setLoadedVia] = useState(''); // 'manual' | 'export' — shown in the UI so it's clear which source is live

  const [coverageReport, setCoverageReport] = useState(null);
  const [reportError, setReportError] = useState('');

  const [previewText, setPreviewText] = useState(PREVIEW_DEFAULT_TEXT);
  const [fill, setFill] = useState(DEFAULT_FILL);
  const [shadows, setShadows] = useState([]);
  const [uncoveredChars, setUncoveredChars] = useState([]);
  const [copied, setCopied] = useState(false);
  const [parsedFont, setParsedFont] = useState(null); // the same opentype.js Font used for coverage checking — reused for SVG export, never re-parsed separately
  const [svgMarkup, setSvgMarkup] = useState('');
  const [svgError, setSvgError] = useState('');
  const [downloadBuffers, setDownloadBuffers] = useState({}); // { ttf?, woff2?, otf?: ArrayBuffer } — actual font file bytes, kept so they can be saved (nothing is persisted server-side)

  // Load the real exported font via FontFace + @font-face — never opentype.js/canvas rendering here.
  const loadFontFromBuffer = useCallback(async (buffer, fallbackName, via) => {
    setLoadError('');
    setFontReady(false);
    try {
      setFontBuffer(buffer);

      // Read the real renamed family name straight from the exported
      // font's own name table (metadata inspection, not rendering).
      const parsed = opentype.parse(buffer.slice(0));
      setParsedFont(parsed); // same parsed object reused by coverage check AND SVG export — one source of truth
      const family = parsed.names?.fontFamily?.en || fallbackName;
      setFamilyName(family);

      const fontFace = new FontFace(family, buffer);
      await fontFace.load();
      document.fonts.add(fontFace);
      setFontReady(true);
      setLoadedVia(via);
      setSvgMarkup('');
      setSvgError('');
    } catch (err) {
      const sig = new Uint8Array(buffer.slice(0, 4));
      const isWoff2 = sig[0] === 0x77 && sig[1] === 0x4f && sig[2] === 0x46 && sig[3] === 0x32; // 'wOF2'
      setLoadError(
        isWoff2
          ? 'This app can’t read .woff2 directly for preview (opentype.js has no WOFF2 decompressor). Use the .ttf or .otf from the same export instead — or use Customize → Export, which picks .ttf automatically.'
          : `Could not load this font file: ${err.message}`
      );
      setFontReady(false);
    }
  }, []);

  const handleFontFile = useCallback(async (file) => {
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const ext = (file.name.match(/\.(ttf|otf|woff2)$/i)?.[1] || 'ttf').toLowerCase();
    setDownloadBuffers({ [ext]: buffer }); // only the one file dropped — the others (if any) were never sent to the browser on this path
    await loadFontFromBuffer(buffer, file.name.replace(/\.[^.]+$/, ''), 'manual');
  }, [loadFontFromBuffer]);

  // Automatic path: FontExportTrigger's server round-trip handed us a
  // finished export directly — no drag-and-drop needed.
  useEffect(() => {
    if (!pendingExport) return;
    // opentype.js can't decode WOFF2 (no Brotli decompressor built in) — prefer
    // .ttf/.otf for in-app parsing/preview/SVG export; woff2 is still the file
    // named in the generated CSS snippet for production hosting, unaffected.
    const dataUrl = pendingExport.formats.ttf || pendingExport.formats.otf || pendingExport.formats.woff2;
    if (!dataUrl) return;
    (async () => {
      // Keep every format the export produced — this is the ONLY chance to
      // save them; nothing is persisted server-side (see the header note).
      const buffers = {};
      for (const [fmt, url] of Object.entries(pendingExport.formats)) {
        buffers[fmt] = dataUrlToArrayBuffer(url);
      }
      setDownloadBuffers(buffers);
      await loadFontFromBuffer(dataUrlToArrayBuffer(dataUrl), 'exported-font', 'export');
      setCoverageReport(pendingExport.report);
      setReportError('');
      onPendingExportConsumed?.();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingExport]);

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
    if (!parsedFont) {
      setUncoveredChars([]);
      return;
    }
    setUncoveredChars(findUncoveredChars(parsedFont, coverageReport, previewText));
  }, [parsedFont, coverageReport, previewText]);

  // Invalidate a previously-generated SVG once its inputs change, rather than leaving a stale export on screen.
  useEffect(() => {
    setSvgMarkup('');
  }, [previewText, fill, shadows, parsedFont]);

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

  const generateSvg = () => {
    setSvgError('');
    if (uncoveredChars.length > 0) return; // belt-and-suspenders — button is already disabled in this state
    if (!parsedFont) {
      setSvgError('Font not loaded yet.');
      return;
    }
    try {
      const svg = buildOutlinedSvg(parsedFont, previewText || PREVIEW_DEFAULT_TEXT, 120, fill, shadows);
      setSvgMarkup(svg);
    } catch (err) {
      setSvgError(`Could not generate SVG: ${err.message}`);
      setSvgMarkup('');
    }
  };

  const downloadSvg = () => {
    if (!svgMarkup) return;
    const blob = new Blob([svgMarkup], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(familyName)}-outlined.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const FORMAT_MIME = { ttf: 'font/ttf', otf: 'font/otf', woff2: 'font/woff2' };

  const downloadFontFile = (fmt) => {
    const buffer = downloadBuffers[fmt];
    if (!buffer) return;
    const blob = new Blob([buffer], { type: FORMAT_MIME[fmt] || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(familyName)}.${fmt}`;
    a.click();
    URL.revokeObjectURL(url);
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

        {fontReady && Object.keys(downloadBuffers).length > 0 && (
          <div className="rounded-lg p-3 flex flex-wrap items-center gap-2" style={{ background: 'rgba(204,120,92,0.08)', border: '1px solid var(--color-primary)' }} data-tour="fonts-effects-download">
            <Tooltip text="Nothing here is saved on the server — this is your only chance to keep these files. Download now, before you navigate away or close this tab.">
              <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Download your font:</span>
            </Tooltip>
            {['ttf', 'woff2', 'otf'].filter((fmt) => downloadBuffers[fmt]).map((fmt) => (
              <Tooltip key={fmt} text={`Save the .${fmt} file to your computer.`}>
                <button
                  onClick={() => downloadFontFile(fmt)}
                  className="text-xs px-3 py-1 rounded uppercase hover:opacity-70 transition-all duration-200"
                  style={{ background: 'var(--color-primary)', color: '#fff' }}
                >
                  .{fmt}
                </button>
              </Tooltip>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-tour="fonts-effects-loader">
          <div className="rounded-lg p-4 flex items-center gap-3" style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}>
            {getIcon('type', { size: 18 })}
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate" style={{ color: 'var(--color-text)' }}>
                {fontReady ? familyName : 'Load your exported .woff2/.ttf/.otf'}
                {fontReady && loadedVia === 'export' && (
                  <span className="text-xs ml-2" style={{ color: 'var(--color-primary)' }}>(from Customize → Export)</span>
                )}
              </p>
              {loadError && <p className="text-xs" style={{ color: '#ef4444' }}>{loadError}</p>}
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Manual drag-in — advanced/fallback path if you ran the Python pipeline yourself.
              </p>
            </div>
            <input ref={fontInputRef} type="file" accept=".woff2,.ttf,.otf" className="hidden" onChange={(e) => handleFontFile(e.target.files?.[0])} />
            <Tooltip text="Manual fallback: use this only if you ran the Python export pipeline yourself, outside the app. Pick .ttf or .otf — this app's preview parser can't read .woff2.">
              <button onClick={() => fontInputRef.current?.click()} className="text-sm px-3 py-1.5 rounded hover:opacity-70 transition-all duration-200" style={{ background: 'var(--color-primary)', color: '#fff' }}>
                Choose file
              </button>
            </Tooltip>
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
            <Tooltip text="Only needed with the manual file path above — Customize → Export already attaches this automatically. Lets the coverage check below know which glyphs were skipped/failed during export.">
              <button onClick={() => reportInputRef.current?.click()} className="text-sm px-3 py-1.5 rounded hover:opacity-70 transition-all duration-200" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                Choose file
              </button>
            </Tooltip>
          </div>
        </div>

        <div>
          <Tooltip text="Whatever you type here drives the live preview below, the CSS snippet's example, and the outlined SVG export — change it any time.">
            <input
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              placeholder="Preview text…"
              className="w-full rounded px-3 py-2 text-sm"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            />
          </Tooltip>
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
          data-tour="fonts-effects-preview"
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
          <div data-tour="fonts-effects-css">
            <div className="flex items-center justify-between mb-1">
              <Tooltip text="Includes the @font-face rule (pointing at your real renamed family) plus the fill/shadow CSS from the panel on the right — ready to paste into a web project.">
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>CSS snippet</span>
              </Tooltip>
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

        {fontReady && (
          <div data-tour="fonts-print-handoff">
            <div className="flex items-center justify-between mb-1">
              <Tooltip text="Flattens the current text + effects to vector paths — no font installation needed by whoever opens the file. Complementary to the real font file, not a replacement: for editable text in a layout (e.g. InDesign before final flatten), install and use the actual .otf/.ttf instead.">
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Print handoff — Outlined SVG</span>
              </Tooltip>
              <button
                onClick={generateSvg}
                disabled={uncoveredChars.length > 0}
                className="text-xs px-2 py-1 rounded hover:opacity-70 transition-all duration-200 disabled:opacity-40"
                style={{ background: 'var(--color-primary)', color: '#fff' }}
              >
                Export Outlined SVG
              </button>
            </div>
            <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
              For a print vendor or Illustrator/InDesign import — glyph outlines as flattened vector paths, color/
              shadow/image-fill baked in. Complementary to the real font file above; use the actual font when you
              still need editable text.
            </p>
            {uncoveredChars.length > 0 && (
              <p className="text-xs" style={{ color: '#ef4444' }}>
                Fix the character coverage issue above before exporting — an outlined SVG can't fall back for a
                missing glyph either.
              </p>
            )}
            {svgError && <p className="text-xs" style={{ color: '#ef4444' }}>{svgError}</p>}
            {svgMarkup && (
              <div>
                <div
                  className="rounded p-4 flex items-center justify-center overflow-hidden"
                  style={{ background: '#fff', border: '1px solid var(--color-border)', minHeight: 100 }}
                  dangerouslySetInnerHTML={{ __html: svgMarkup }}
                />
                <div className="flex gap-2 mt-2">
                  <Tooltip text="Saves the flattened outline SVG to your computer — ready to send to a print vendor or open in Illustrator/InDesign.">
                    <button onClick={downloadSvg} className="text-xs px-2 py-1 rounded hover:opacity-70 transition-all duration-200" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                      Download .svg
                    </button>
                  </Tooltip>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="w-80 flex-shrink-0 overflow-y-auto p-5 space-y-5" style={{ background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}>
        <div data-tour="fonts-effects-fill">
          <Tooltip text="How the letterforms are colored — a flat color, a gradient (via CSS background-clip: text), or an image/texture clipped to the text shape.">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Fill</span>
          </Tooltip>
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
            <Tooltip text="Pick a flat fill color for the text.">
              <input type="color" value={fill.solidColor} onChange={(e) => setFill((f) => ({ ...f, solidColor: e.target.value }))} className="w-full h-9 rounded" />
            </Tooltip>
          )}

          {fill.mode === 'gradient' && (
            <div className="space-y-2">
              {fill.gradientStops.map((stop, i) => (
                <Tooltip key={i} text={`Gradient stop ${i + 1}: color + its position along the gradient (0-100%).`}>
                  <div className="flex items-center gap-2">
                    <input type="color" value={stop.color} onChange={(e) => updateGradientStop(i, { color: e.target.value })} className="w-9 h-9 rounded" />
                    <input
                      type="range" min={0} max={100} value={stop.position}
                      onChange={(e) => updateGradientStop(i, { position: Number(e.target.value) })}
                      className="flex-1"
                    />
                  </div>
                </Tooltip>
              ))}
              <Tooltip text="Direction of the gradient across the text, in degrees (CSS linear-gradient convention: 0° = bottom to top).">
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Angle</span>
                  <input type="range" min={0} max={360} value={fill.gradientAngle} onChange={(e) => setFill((f) => ({ ...f, gradientAngle: Number(e.target.value) }))} className="flex-1" />
                  <span className="text-xs w-10 text-right" style={{ color: 'var(--color-muted)' }}>{fill.gradientAngle}°</span>
                </div>
              </Tooltip>
            </div>
          )}

          {fill.mode === 'image' && (
            <div>
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImageFile(e.target.files?.[0])} />
              <Tooltip text="Upload any image or texture — it's clipped to fill the text shape (CSS background-clip: text), like the fill were a photo or pattern.">
                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="w-full text-sm px-3 py-2 rounded hover:opacity-70 transition-all duration-200"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                >
                  {fill.imageDataUrl ? 'Change image' : 'Choose image/texture'}
                </button>
              </Tooltip>
              {fill.imageDataUrl && (
                <img src={fill.imageDataUrl} alt="fill texture" className="w-full h-16 object-cover rounded mt-2" />
              )}
            </div>
          )}
        </div>

        <div data-tour="fonts-effects-shadows">
          <div className="flex items-center justify-between">
            <Tooltip text="Layer multiple shadows for depth — e.g. a tight dark shadow plus a soft wide one.">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Shadows</span>
            </Tooltip>
            <Tooltip text="Adds a new shadow layer with default offset/blur/color — edit its values below, or remove it with the trash icon.">
              <button onClick={addShadow} className="text-xs hover:opacity-70 transition-all duration-200" style={{ color: 'var(--color-primary)' }}>
                + Add layer
              </button>
            </Tooltip>
          </div>

          <div className="space-y-3 mt-2">
            {shadows.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No shadow layers.</p>}
            {shadows.map((shadow, i) => (
              <div key={i} className="rounded p-2 space-y-1.5" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Layer {i + 1}</span>
                  <Tooltip text="Remove this shadow layer.">
                    <button onClick={() => removeShadow(i)} className="hover:opacity-70 transition-all duration-200" style={{ color: 'var(--color-muted)' }}>
                      {getIcon('trash', { size: 12 })}
                    </button>
                  </Tooltip>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Tooltip text="Horizontal shadow offset in pixels — positive moves right.">
                    <label className="flex flex-col gap-0.5" style={{ color: 'var(--color-muted)' }}>
                      X
                      <input type="number" value={shadow.offsetX} onChange={(e) => updateShadow(i, { offsetX: Number(e.target.value) })} className="rounded px-1.5 py-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                    </label>
                  </Tooltip>
                  <Tooltip text="Vertical shadow offset in pixels — positive moves down.">
                    <label className="flex flex-col gap-0.5" style={{ color: 'var(--color-muted)' }}>
                      Y
                      <input type="number" value={shadow.offsetY} onChange={(e) => updateShadow(i, { offsetY: Number(e.target.value) })} className="rounded px-1.5 py-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                    </label>
                  </Tooltip>
                  <Tooltip text="Blur radius in pixels — 0 is a hard-edged shadow, higher softens it.">
                    <label className="flex flex-col gap-0.5" style={{ color: 'var(--color-muted)' }}>
                      Blur
                      <input type="number" min={0} value={shadow.blur} onChange={(e) => updateShadow(i, { blur: Number(e.target.value) })} className="rounded px-1.5 py-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                    </label>
                  </Tooltip>
                  <Tooltip text="Any valid CSS color — hex (#000), rgba() for transparency, or a named color.">
                    <label className="flex flex-col gap-0.5" style={{ color: 'var(--color-muted)' }}>
                      Color
                      <input type="text" value={shadow.color} onChange={(e) => updateShadow(i, { color: e.target.value })} className="rounded px-1.5 py-1" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                    </label>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
