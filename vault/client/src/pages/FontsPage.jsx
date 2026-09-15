import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as opentype from 'opentype.js';
import { useIcon } from '../providers/IconProvider';
import Tooltip from '../components/Tooltip';
import FontProofingText from './fonts/FontProofingText';
import FontTransformControls, { DEFAULT_TRANSFORMS } from './fonts/FontTransformControls';
import FontKerningPanel, { DEFAULT_KERNING } from './fonts/FontKerningPanel';
import FontPresetsPanel from './fonts/FontPresetsPanel';
import { PROOFING_PRESETS, DEFAULT_PROOFING_TEXT } from './fonts/proofingPresets';
import { drawProof, drawAffectedPairHighlights } from './fonts/fontCanvasRenderer';
import { loadPresets, savePreset, deletePreset } from './fonts/fontPresetsStorage';

const TABS = [
  { id: 'transforms', label: 'Transforms' },
  { id: 'kerning', label: 'Kerning' },
  { id: 'presets', label: 'Stylesheets' },
];

export default function FontsPage() {
  const getIcon = useIcon();
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  const [font, setFont] = useState(null);
  const [fontMeta, setFontMeta] = useState(null); // { family, isVariable, axes }
  const [loadError, setLoadError] = useState('');

  const [activePresetId, setActivePresetId] = useState(PROOFING_PRESETS[0].id);
  const [customText, setCustomText] = useState(DEFAULT_PROOFING_TEXT);
  const [fontSize, setFontSize] = useState(72);

  const [transforms, setTransforms] = useState(DEFAULT_TRANSFORMS);
  const [kerning, setKerning] = useState(DEFAULT_KERNING);
  const [activeTab, setActiveTab] = useState('transforms');
  const [presets, setPresets] = useState(() => loadPresets());
  const [affectedPairs, setAffectedPairs] = useState([]);

  const proofingText = activePresetId === 'custom'
    ? customText
    : (PROOFING_PRESETS.find((p) => p.id === activePresetId)?.text || DEFAULT_PROOFING_TEXT);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setLoadError('');
    try {
      const buffer = await file.arrayBuffer();
      const parsed = opentype.parse(buffer);
      setFont(parsed);
      const isVariable = !!(parsed.tables && parsed.tables.fvar);
      setFontMeta({
        family: parsed.names?.fontFamily?.en || file.name.replace(/\.[^.]+$/, ''),
        isVariable,
        axes: isVariable ? parsed.tables.fvar.axes.map((a) => ({
          tag: a.tag,
          name: a.name?.en || a.tag,
          min: a.minValue,
          default: a.defaultValue,
          max: a.maxValue,
        })) : [],
      });
    } catch (err) {
      setLoadError(`Could not load this font file: ${err.message}`);
      setFont(null);
      setFontMeta(null);
    }
  }, []);

  const onFileInputChange = (e) => handleFile(e.target.files?.[0]);
  const onDrop = (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0]);
  };

  // Re-render canvas whenever font, text, size, or any control changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!font) {
      setAffectedPairs([]);
      return;
    }

    const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#F5F5F0';
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim() || '#1A1A1A';
    ctx.fillStyle = bg || '#F5F5F0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const padding = 24;
    const baselineY = padding + fontSize;

    try {
      const result = drawProof(ctx, font, proofingText, padding, baselineY, fontSize, {
        transforms,
        kerning,
        color: textColor || '#1A1A1A',
      });
      drawAffectedPairHighlights(ctx, result.affectedPairs, result.baselineY, fontSize);
      setAffectedPairs(result.affectedPairs);
    } catch (err) {
      setLoadError(`Render error: ${err.message}`);
    }
  }, [font, proofingText, fontSize, transforms, kerning]);

  const handleSavePreset = (name) => {
    const next = savePreset(name, { transforms, kerning });
    setPresets(next);
  };
  const handleApplyPreset = (preset) => {
    setTransforms(preset.transforms);
    setKerning(preset.kerning);
  };
  const handleDeletePreset = (id) => {
    setPresets(deletePreset(id));
  };

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <div className="flex-1 flex flex-col overflow-y-auto p-6 gap-5">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Font Customizer</h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Live in-browser preview — nothing here is sent to a server. Export (a later phase) will freeze these
            settings into a real, OFL-compliant font file via the Phase 1 backend.
          </p>
        </div>

        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="rounded-lg p-4 flex items-center gap-3"
          style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}
        >
          {getIcon('type', { size: 20 })}
          <div className="flex-1">
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              {fontMeta ? fontMeta.family : 'Drop a .ttf/.otf/.woff file, or choose one'}
            </p>
            {fontMeta && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {fontMeta.isVariable
                  ? `Variable font — axes: ${fontMeta.axes.map((a) => a.tag).join(', ')}. Load the Phase 1 backend's frozen static output for editing; this preview renders the file as-is.`
                  : 'Static font.'}
              </p>
            )}
            {loadError && <p className="text-xs" style={{ color: '#ef4444' }}>{loadError}</p>}
          </div>
          <input ref={fileInputRef} type="file" accept=".ttf,.otf,.woff" onChange={onFileInputChange} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-sm px-3 py-1.5 rounded hover:opacity-70 transition-all duration-200"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            Choose file
          </button>
        </div>

        <FontProofingText
          activePresetId={activePresetId}
          customText={customText}
          onSelectPreset={setActivePresetId}
          onCustomTextChange={setCustomText}
        />

        <div className="flex items-center gap-3">
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Preview size</span>
          <input type="range" min={24} max={160} step={2} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-40" />
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{fontSize}px</span>
        </div>

        <div className="rounded-lg overflow-x-auto" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <canvas ref={canvasRef} width={900} height={220} className="block" />
        </div>

        {affectedPairs.length > 0 && (
          <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Kerning-adjusted pairs in this text: {affectedPairs.map((p) => `${p.leftChar}${p.rightChar}`).join(', ')}
          </div>
        )}
      </div>

      <div className="w-80 flex-shrink-0 overflow-y-auto p-5" style={{ background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}>
        <div className="flex gap-1 mb-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 text-sm px-2 py-1.5 rounded hover:opacity-70 transition-all duration-200"
              style={{
                background: activeTab === tab.id ? 'var(--color-primary)' : 'transparent',
                color: activeTab === tab.id ? '#fff' : 'var(--color-text)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'transforms' && <FontTransformControls transforms={transforms} onChange={setTransforms} />}
        {activeTab === 'kerning' && <FontKerningPanel kerning={kerning} onChange={setKerning} />}
        {activeTab === 'presets' && (
          <FontPresetsPanel presets={presets} onSave={handleSavePreset} onApply={handleApplyPreset} onDelete={handleDeletePreset} />
        )}
      </div>
    </div>
  );
}
