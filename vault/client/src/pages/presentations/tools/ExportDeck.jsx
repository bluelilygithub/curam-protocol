import React, { useCallback, useEffect, useState } from 'react';
import api from '../../../utils/apiClient';
import EmptyState from '../../../components/EmptyState';
import Tooltip from '../../../components/Tooltip';
import { takeToolHandoff } from '../../../utils/toolHandoff.mjs';
import {
  BTN_PRIMARY, BTN_SECONDARY, CARD, CARD_STYLE, FIELD_STYLE, PRIMARY_STYLE, SECONDARY_STYLE,
  Notice, ToolHeader, readDeckFile, readJson, usePresentations,
} from '../shared';

const FORMATS = [
  { id: 'pptx', label: 'PowerPoint (PPTX)', desc: 'Text stays editable as text boxes, with speaker notes.', ext: 'pptx' },
  { id: 'pdf', label: 'PDF', desc: 'Fixed layout for sharing and printing, with notes pages.', ext: 'pdf' },
  { id: 'html', label: 'HTML preview', desc: 'One self-contained file with slides and notes pages.', ext: 'html' },
  { id: 'png', label: 'PNGs (one per slide)', desc: 'A zip of slide images plus notes.txt.', ext: 'zip' },
];

const when = (value) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
};

export default function ExportDeck() {
  const {
    deck, setDeck, savedDeckId, applyBrand, setApplyBrand, meta, exportFile, startJob, openTool, toast, present,
  } = usePresentations();
  const [format, setFormat] = useState('pptx');
  const [busy, setBusy] = useState(false);
  const [downloads, setDownloads] = useState([]);

  const loadDownloads = useCallback(async () => {
    if (!savedDeckId) { setDownloads([]); return; }
    const res = await api.get(`/api/presentations/decks/${encodeURIComponent(savedDeckId)}/exports`);
    const data = await readJson(res, 'Could not load previous exports.');
    setDownloads(Array.isArray(data.exports) ? data.exports : []);
  }, [savedDeckId]);

  useEffect(() => {
    loadDownloads().catch(() => {});
  }, [loadDownloads, exportFile]);

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
      // New exports have a durable DB-backed URL; older jobs still use the in-memory job link.
      await api.download(
        exportFile.url || `/api/presentations/export/${encodeURIComponent(exportFile.jobId)}/file/${encodeURIComponent(exportFile.format || format)}`,
        exportFile.fileName || `${deck.title || 'presentation'}.${ext}`,
      );
    } catch (err) {
      toast(err.message || 'Could not download the export.', 'error');
    }
  };

  return (
    <section className="space-y-4">
      <ToolHeader id="export" title="Export" />

      {deck.slides.length === 0 ? (
        <div className={CARD} style={CARD_STYLE}>
          <EmptyState
            icon="download"
            title="No deck to export yet"
            body="Make a deck in Create deck, or open a saved one from My decks, then come back to download it."
            action={(
              <div className="flex flex-wrap justify-center gap-2">
                <Tooltip text="Write a brief and make a first deck.">
                  <button type="button" onClick={() => openTool('create')} className={BTN_PRIMARY} style={PRIMARY_STYLE}>Create a deck</button>
                </Tooltip>
                <Tooltip text="Open a deck you saved before.">
                  <button type="button" onClick={() => openTool('decks')} className={BTN_SECONDARY} style={SECONDARY_STYLE}>My decks</button>
                </Tooltip>
              </div>
            )}
          />
        </div>
      ) : (
        <div className={CARD} style={CARD_STYLE}>
          <div className="grid sm:grid-cols-2 gap-2">
            {FORMATS.map((f) => (
              <Tooltip key={f.id} text={`Export as ${f.label}: ${f.desc}`}>
                <button
                  type="button"
                  onClick={() => setFormat(f.id)}
                  disabled={busy}
                  aria-pressed={format === f.id}
                  className="w-full rounded-xl border p-4 text-left text-xs transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                  style={{ ...FIELD_STYLE, borderColor: format === f.id ? 'var(--color-primary)' : 'var(--color-border)', borderWidth: format === f.id ? 2 : 1 }}
                >
                  <span className="block text-sm font-medium" style={{ color: format === f.id ? 'var(--color-primary)' : 'var(--color-text)' }}>{f.label}</span>
                  <span className="block mt-1" style={{ color: 'var(--color-muted)' }}>{f.desc}</span>
                </button>
              </Tooltip>
            ))}
          </div>

          <Tooltip text={meta?.brandKit?.available ? 'Lay your Brand Kit colours and logo over the chosen theme in the export.' : 'No saved Brand Kit yet. Set one up in Graphics first.'}>
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
                className={BTN_PRIMARY}
                style={PRIMARY_STYLE}
              >
                {busy ? 'Starting export…' : 'Export deck'}
              </button>
            </Tooltip>
            {exportFile?.jobId && (
              <Tooltip text={`Download the finished ${exportFile.format || format} file.`}>
                <button type="button" onClick={download} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>
                  Download {String(exportFile.format || format).toUpperCase()}
                </button>
              </Tooltip>
            )}
            <Tooltip text="Play the deck full screen in Vault instead of downloading it. Transitions play here; the PPTX keeps plain slide changes.">
              <button type="button" onClick={() => present(0)} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>Present</button>
            </Tooltip>
            <Tooltip text="Go back and change the slides before exporting.">
              <button type="button" onClick={() => openTool('slides')} className="text-xs underline transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>Edit slides</button>
            </Tooltip>
          </div>

          <div className="border-t pt-4 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Previous exports for this deck</p>
              <button type="button" onClick={() => loadDownloads().catch(() => {})} className="text-xs underline transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>Refresh list</button>
            </div>
            {!savedDeckId ? (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Save the deck in the slide editor to keep a re-downloadable list here.</p>
            ) : downloads.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No exports yet. Finished files remain available here after the job expires.</p>
            ) : (
              <ul className="space-y-1">
                {downloads.map((file) => (
                  <li key={file.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs" style={FIELD_STYLE}>
                    <span className="flex-1 min-w-[9rem]" style={{ color: 'var(--color-text)' }}>
                      {file.format.toUpperCase()} · {Math.max(1, Math.round(file.bytes / 1024))} KB · {when(file.createdAt)}
                    </span>
                    <Tooltip text="Download this saved export again.">
                      <button type="button" onClick={() => api.download(`/api/presentations/exports/${encodeURIComponent(file.id)}/file`, file.fileName).catch((err) => toast(err.message || 'Could not download that export.', 'error'))} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>
                        {file.fileName}
                      </button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
