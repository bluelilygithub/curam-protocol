import React, { useEffect, useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { takeToolHandoff } from '../../../utils/toolHandoff.mjs';
import {
  CARD_STYLE, FIELD_STYLE, Notice, ToolHeader, readDeckFile, usePresentations,
} from '../shared';

const FORMATS = [
  { id: 'pptx', label: 'PowerPoint (PPTX)', desc: 'Text stays editable as text boxes.', ext: 'pptx' },
  { id: 'pdf', label: 'PDF', desc: 'Fixed layout for sharing and printing.', ext: 'pdf' },
  { id: 'html', label: 'HTML preview', desc: 'One self-contained file you can open in a browser.', ext: 'html' },
  { id: 'png', label: 'PNGs (one per slide)', desc: 'A zip of slide images for slideshows and social posts.', ext: 'zip' },
];

export default function ExportDeck() {
  const {
    deck, setDeck, savedDeckId, applyBrand, setApplyBrand, meta, exportFile, startJob, openTool, toast,
  } = usePresentations();
  const [format, setFormat] = useState('pptx');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const file = takeToolHandoff('export');
    if (!file) return;
    readDeckFile(file).then((parsed) => {
      if (parsed) { setDeck(parsed); toast('Deck received from the other tool.', 'success'); }
      else toast('That file was not a deck.', 'error');
    });
  }, [setDeck, toast]);

  const submit = async () => {
    if (!deck.slides.length) { toast('Make a deck before exporting.', 'error'); return; }
    setBusy(true);
    try {
      await startJob('export', '/api/presentations/export', {
        ...(savedDeckId ? { deckId: savedDeckId } : {}),
        deck,
        format,
        applyBrand,
      });
    } catch (err) {
      if (err.message !== 'Cancelled') toast(err.message || 'Could not export the deck.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!exportFile?.jobId) return;
    const ext = FORMATS.find((f) => f.id === (exportFile.format || format))?.ext || 'pptx';
    try {
      await api.download(`/api/presentations/export/${encodeURIComponent(exportFile.jobId)}/file/${encodeURIComponent(exportFile.format || format)}`, `${deck.title || 'presentation'}.${ext}`);
    } catch (err) {
      toast(err.message || 'Could not download the export.', 'error');
    }
  };

  return (
    <section className="space-y-4">
      <ToolHeader id="export" title="Export" blurb="PPTX keeps the words editable; PDF, HTML and PNGs render from the same preview." />

      {deck.slides.length === 0 ? (
        <Notice tone="warn">There is no deck to export yet. Make one in Create deck, or open a saved deck from My decks.</Notice>
      ) : (
        <div className="rounded-2xl border p-4 space-y-4" style={CARD_STYLE}>
          <div className="grid sm:grid-cols-2 gap-2">
            {FORMATS.map((f) => (
              <Tooltip key={f.id} text={f.desc}>
                <button
                  type="button"
                  onClick={() => setFormat(f.id)}
                  disabled={busy}
                  className="rounded-xl border p-3 text-left text-xs hover:opacity-70 transition-opacity disabled:opacity-40"
                  style={{ ...FIELD_STYLE, borderColor: format === f.id ? 'var(--color-primary)' : 'var(--color-border)' }}
                >
                  <span className="block text-sm font-medium" style={{ color: format === f.id ? 'var(--color-primary)' : 'var(--color-text)' }}>{f.label}</span>
                  <span className="block mt-1" style={{ color: 'var(--color-muted)' }}>{f.desc}</span>
                </button>
              </Tooltip>
            ))}
          </div>

          <Tooltip text={meta?.brandKit?.available ? 'Lay your Brand Kit colours and logo over the chosen theme in the export.' : 'No saved Brand Kit yet — set one up in Graphics first.'}>
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={applyBrand} onChange={(e) => setApplyBrand(e.target.checked)} />
              Apply Brand Kit
            </label>
          </Tooltip>
          {applyBrand && !meta?.brandKit?.available && <Notice tone="warn">No saved Brand Kit was found, so this override will have no effect.</Notice>}

          <div className="flex flex-wrap items-center gap-3">
            <Tooltip text="Start the export in the background. The download button appears when it is ready.">
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="px-4 py-2 rounded-xl text-sm font-medium hover:opacity-80 disabled:opacity-40 transition-opacity"
                style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
              >
                {busy ? 'Starting export…' : 'Export deck'}
              </button>
            </Tooltip>
            {exportFile?.jobId && (
              <Tooltip text={`Download the finished ${exportFile.format || format} file.`}>
                <button type="button" onClick={download} className="px-3 py-2 rounded-xl text-xs font-medium border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
                  Download {String(exportFile.format || format).toUpperCase()}
                </button>
              </Tooltip>
            )}
            <Tooltip text="Go back and change the slides before exporting.">
              <button type="button" onClick={() => openTool('slides')} className="text-xs underline hover:opacity-60" style={{ color: 'var(--color-primary)' }}>Edit slides</button>
            </Tooltip>
          </div>
        </div>
      )}
    </section>
  );
}
