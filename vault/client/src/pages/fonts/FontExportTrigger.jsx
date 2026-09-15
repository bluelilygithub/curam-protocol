import React, { useState } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import useProcessingStore from '../../store/processingStore';
import FontPicker from './FontPicker';

const RANGE_OPTIONS = [
  { id: 'basic-latin', label: 'Basic Latin (A-Z, a-z, 0-9, punctuation)' },
  { id: 'latin-1-supplement', label: 'Latin-1 Supplement (á, é, ñ, ü, ç…)' },
  { id: 'latin-extended-a', label: 'Latin Extended-A' },
];

const FORMAT_OPTIONS = ['ttf', 'woff2', 'otf'];

/**
 * The "Customize → Export" trigger: sends Phase 2/3's transform+kerning
 * recipe plus OFL rename/subset choices to the Node route
 * (POST /api/fonts/customize-export), which shells out to the unmodified
 * Phase 1-4 Python pipeline and returns the real exported files —
 * closing the gap that used to require running that pipeline by hand.
 */
export default function FontExportTrigger({ transforms, kerning, fontFileBuffer, onExported }) {
  const startProcessing = useProcessingStore((s) => s.startProcessing);
  const stopProcessing = useProcessingStore((s) => s.stopProcessing);

  const [useGoogleFont, setUseGoogleFont] = useState(!fontFileBuffer);
  const [googleFontFamily, setGoogleFontFamily] = useState('');
  const [newFamilyName, setNewFamilyName] = useState('');
  const [copyrightText, setCopyrightText] = useState('');
  const [trademarkText, setTrademarkText] = useState('');
  const [rangeIds, setRangeIds] = useState(['basic-latin', 'latin-1-supplement']);
  const [formats, setFormats] = useState(['ttf', 'woff2', 'otf']);
  const [error, setError] = useState('');

  const toggleRange = (id) => {
    setRangeIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  };
  const toggleFormat = (fmt) => {
    setFormats((prev) => (prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt]));
  };

  const canExport = newFamilyName.trim() && rangeIds.length && formats.length
    && (useGoogleFont ? googleFontFamily.trim() : !!fontFileBuffer);

  const runExport = async () => {
    setError('');
    startProcessing('Exporting your customized font…', 'Running the fontTools pipeline server-side — this can take a few seconds.');
    try {
      const body = {
        recipe: { transforms, kerning },
        rename: { familyName: newFamilyName.trim(), copyright: copyrightText || undefined, trademark: trademarkText || undefined },
        rangeIds,
        formats,
      };
      if (useGoogleFont) {
        body.family = googleFontFamily.trim();
      } else {
        const bytes = new Uint8Array(fontFileBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        body.fontDataUrl = `data:font/ttf;base64,${btoa(binary)}`;
      }

      const res = await api.post('/api/fonts/customize-export', body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Export failed.');

      onExported(data.formats, data.report);
    } catch (err) {
      setError(err.message || 'Export failed.');
    } finally {
      stopProcessing();
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Source font</span>
        <div className="flex gap-1 mt-1 mb-2">
          <button
            onClick={() => setUseGoogleFont(false)}
            disabled={!fontFileBuffer}
            className="flex-1 text-xs px-2 py-1.5 rounded hover:opacity-70 transition-all duration-200 disabled:opacity-40"
            style={{ background: !useGoogleFont ? 'var(--color-primary)' : 'transparent', color: !useGoogleFont ? '#fff' : 'var(--color-text)', border: '1px solid var(--color-border)' }}
          >
            Loaded file
          </button>
          <button
            onClick={() => setUseGoogleFont(true)}
            className="flex-1 text-xs px-2 py-1.5 rounded hover:opacity-70 transition-all duration-200"
            style={{ background: useGoogleFont ? 'var(--color-primary)' : 'transparent', color: useGoogleFont ? '#fff' : 'var(--color-text)', border: '1px solid var(--color-border)' }}
          >
            Google Font name
          </button>
        </div>
        {useGoogleFont ? (
          <FontPicker value={googleFontFamily} onChange={setGoogleFontFamily} />
        ) : (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {fontFileBuffer ? 'Using the font file loaded in Structural Preview.' : 'Load a font file in Structural Preview first, or type a Google Font name above.'}
          </p>
        )}
      </div>

      <div>
        <Tooltip text="OFL's Reserved Font Name clause requires a genuinely different name — export is blocked server-side if this matches the original.">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>New family name (required)</span>
        </Tooltip>
        <input
          value={newFamilyName}
          onChange={(e) => setNewFamilyName(e.target.value)}
          placeholder="e.g. My Custom Serif"
          className="w-full rounded px-2 py-1.5 text-sm mt-1"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
        />
      </div>

      <details>
        <summary className="text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>Copyright / Trademark (optional — sensible defaults if left blank)</summary>
        <div className="space-y-2 mt-2">
          <input value={copyrightText} onChange={(e) => setCopyrightText(e.target.value)} placeholder="Copyright line…" className="w-full rounded px-2 py-1.5 text-xs" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
          <input value={trademarkText} onChange={(e) => setTrademarkText(e.target.value)} placeholder="Trademark line…" className="w-full rounded px-2 py-1.5 text-xs" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
        </div>
      </details>

      <div>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Character set</span>
        <div className="space-y-1 mt-1">
          {RANGE_OPTIONS.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={rangeIds.includes(r.id)} onChange={() => toggleRange(r.id)} />
              {r.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Formats</span>
        <div className="flex gap-3 mt-1">
          {FORMAT_OPTIONS.map((fmt) => (
            <label key={fmt} className="flex items-center gap-1.5 text-xs uppercase cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={formats.includes(fmt)} onChange={() => toggleFormat(fmt)} />
              {fmt}
            </label>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-xs rounded p-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444', color: '#ef4444' }}>
          {error}
        </p>
      )}

      <button
        onClick={runExport}
        disabled={!canExport}
        className="w-full text-sm px-3 py-2 rounded hover:opacity-70 transition-all duration-200 disabled:opacity-40"
        style={{ background: 'var(--color-primary)', color: '#fff' }}
      >
        Customize → Export
      </button>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        Runs the Phase 1-4 fontTools pipeline server-side and loads the result straight into Effects &amp; Export —
        no manual file handling needed. Prefer to run the Python pipeline yourself? Effects &amp; Export still
        accepts a manually dropped .woff2/.ttf/.otf and coverage report.
      </p>
    </div>
  );
}
