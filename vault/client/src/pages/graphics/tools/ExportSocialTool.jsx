import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { useSocialPresets, useProcessingWhile, loadImageInto, downloadDataUrl, formatBytes, ResultPlaceholder } from '../shared';

export default function ExportSocialTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();
  const socialPresets = useSocialPresets();

  const [xsSource, setXsSource] = useState(null);
  const [xsSelected, setXsSelected] = useState([]);
  const [xsStrategies, setXsStrategies] = useState({});
  const [xsBusy, setXsBusy] = useState(false);
  const [xsResult, setXsResult] = useState(null);
  const [xsError, setXsError] = useState('');

  const toggleXsPreset = (id) => {
    setXsSelected(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]));
  };

  const setXsStrategyFor = (id, strategy) => {
    setXsStrategies(prev => ({ ...prev, [id]: strategy }));
  };

  const runExportSocial = async () => {
    if (!xsSource?.imageDataUrl || !xsSelected.length) return;
    setXsBusy(true);
    setXsError('');
    try {
      const options = {};
      xsSelected.forEach(id => { if (xsStrategies[id]) options[id] = { strategy: xsStrategies[id] }; });
      const res = await api.post('/api/graphics/export-social', { imageDataUrl: xsSource.imageDataUrl, presets: xsSelected, options });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Export failed');
      setXsResult(data);
    } catch (err) {
      setXsError(err.message || 'Export failed');
    } finally {
      setXsBusy(false);
    }
  };

  useProcessingWhile(xsBusy ? 'Exporting social sizes…' : null);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Export for social</h2>
            <button type="button" onClick={() => setHelpTool('exportsocial')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
        </div>
        <div className="grid lg:grid-cols-[1fr_420px] gap-6">
          <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
              <Tooltip text="Choose the image to crop into every selected platform size."><input type="file" accept="image/*" onChange={e => { setXsResult(null); setXsError(''); loadImageInto(setXsSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
            </div>
            {xsSource?.imageDataUrl && (
              <div className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <img src={xsSource.imageDataUrl} alt="source" className="max-h-40 mx-auto rounded-lg" />
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Sizes to export</label>
                <Tooltip text="Tick or untick every platform size at once.">
                  <button type="button" onClick={() => setXsSelected(prev => (prev.length === socialPresets.length ? [] : socialPresets.map(p => p.id)))} className="text-xs hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
                    {xsSelected.length === socialPresets.length && socialPresets.length > 0 ? 'Deselect all' : 'Select all'}
                  </button>
                </Tooltip>
              </div>
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {socialPresets.map(p => (
                  <div key={p.id} className="rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <Tooltip text={`Include a ${p.label} crop in the export.`}>
                        <label className="flex items-center gap-2 text-xs cursor-pointer flex-1" style={{ color: 'var(--color-text)' }}>
                          <input type="checkbox" checked={xsSelected.includes(p.id)} onChange={() => toggleXsPreset(p.id)} />
                          {p.label}{p.width && p.height ? <span style={{ color: 'var(--color-muted)' }}> · {p.width}×{p.height}</span> : null}
                        </label>
                      </Tooltip>
                      {xsSelected.includes(p.id) && (
                        <Tooltip text="Which part of the image to keep for this size — different aspect ratios often need a different focus point.">
                          <select
                            value={xsStrategies[p.id] || 'smart'}
                            onChange={e => setXsStrategyFor(p.id, e.target.value)}
                            className="text-xs px-1.5 py-1 rounded-lg border flex-shrink-0"
                            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                          >
                            <option value="smart">Auto (attention)</option>
                            <option value="entropy">Most detail</option>
                            <option value="center">Center</option>
                            <option value="top">Top</option>
                            <option value="bottom">Bottom</option>
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                          </select>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Each size defaults to a smart, content-aware crop — the important part of the image stays in frame. Pick a different focus per size above if the auto crop cuts off something you need. All crops are bundled into one ZIP, and you'll get a preview of every crop before you download.
            </p>
            {xsError && <div className="text-sm px-3 py-2 rounded-xl" style={{ color: '#991b1b', background: '#fee2e2' }}>{xsError}</div>}
            <Tooltip text="Generate a crop for every ticked size and download them as one ZIP."><button type="button" onClick={runExportSocial} disabled={xsBusy || !xsSource?.imageDataUrl || !xsSelected.length} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {xsBusy ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('share-2', { size: 15 })}
              {xsBusy ? 'Exporting…' : 'Export ZIP'}
            </button></Tooltip>
          </div>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Export result</span>
              {xsResult?.zipDataUrl && (
                <Tooltip text="Download the ZIP containing every exported crop."><button onClick={() => downloadDataUrl(xsResult.zipDataUrl, 'social-export.zip')} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}>Download ZIP</button></Tooltip>
              )}
            </div>
            <div className="p-4">
              {xsResult?.zipDataUrl ? (
                <div className="space-y-3">
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{xsResult.count} crops · {formatBytes(xsResult.bytes)} ZIP</p>
                  <div className="grid grid-cols-2 gap-2 max-h-[420px] overflow-y-auto pr-1">
                    {(xsResult.items || []).map(item => (
                      <div key={item.id} className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                        <div className="flex items-center justify-center p-2" style={{ minHeight: 90 }}>
                          <img src={item.imageDataUrl} alt={item.label} className="max-h-24 max-w-full rounded-lg" />
                        </div>
                        <div className="px-2 py-1.5 border-t flex items-center justify-between gap-1" style={{ borderColor: 'var(--color-border)' }}>
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium truncate" style={{ color: 'var(--color-text)' }}>{item.label}</p>
                            <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{item.width}×{item.height}</p>
                          </div>
                          <Tooltip text={`Download just the ${item.label} crop.`}>
                            <button onClick={() => downloadDataUrl(item.imageDataUrl, item.fileName)} className="flex-shrink-0 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>
                              {getIcon('download', { size: 14 })}
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Not happy with a crop? Change its focus on the left and hit Export ZIP again.</p>
                </div>
              ) : (
                <ResultPlaceholder src={xsSource?.imageDataUrl} message="Your exported crops will appear here." />
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
