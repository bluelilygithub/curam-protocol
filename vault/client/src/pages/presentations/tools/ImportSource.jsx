import React, { useEffect, useRef, useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { VoiceInput } from '../../../components/voiceInput/VoiceInput';
import { CARD_STYLE, Notice, ToolHeader, readJson, usePresentations } from '../shared';

const ACCEPT = '.pdf,.doc,.docx,.txt,.md,.markdown,.pptx,.potx,image/*';

export default function ImportSource() {
  const {
    sourceText, setSourceText, imageRefs, setImageRefs, takeIncomingFile, openTool, toast,
  } = usePresentations();
  const [files, setFiles] = useState([]);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const fileRef = useRef(null);

  // A file handed over from another Vault tool arrives here once.
  useEffect(() => {
    const incoming = takeIncomingFile('import');
    if (incoming) {
      setFiles((prev) => [...prev, incoming].slice(0, 10));
      toast('File received from the other tool.', 'success');
    }
  }, [takeIncomingFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (data) => {
    setSourceText(data?.sourceText || '');
    setImageRefs(Array.isArray(data?.imageRefs) ? data.imageRefs : []);
    setWarnings(Array.isArray(data?.warnings) ? data.warnings : []);
    if (data?.warnings?.length) toast('Imported, with warnings — check the notes below.', 'error');
    else toast('Source imported.', 'success');
  };

  const importFiles = async () => {
    if (!files.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      files.forEach((file) => fd.append('files', file));
      const res = await api.postForm('/api/presentations/import', fd);
      apply(await readJson(res, 'Could not import these files.'));
    } catch (err) {
      toast(err.message || 'Could not import these files.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const importUrl = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const res = await api.post('/api/presentations/import/url', { url: url.trim() });
      apply(await readJson(res, 'Could not read that web page.'));
    } catch (err) {
      toast(err.message || 'Could not read that web page.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <ToolHeader id="import" title="Import source" blurb="Up to 10 files at once, or one web page. The extracted text is editable before you use it." />
      <div className="rounded-2xl border p-4 space-y-4" style={CARD_STYLE}>
        <div className="space-y-2">
          <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Files</span>
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip text="Choose PDF, Word, text/Markdown, PowerPoint or image files. Order does not matter here.">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="px-3 py-2 rounded-xl text-xs font-medium border hover:opacity-70 transition-opacity"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {files.length ? 'Add more files' : 'Choose files'}
              </button>
            </Tooltip>
            {files.length > 0 && (
              <Tooltip text="Remove every chosen file.">
                <button type="button" onClick={() => setFiles([])} className="text-xs hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Clear all</button>
              </Tooltip>
            )}
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{files.length}/10 files</span>
          </div>
          <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => {
            const picked = Array.from(e.target.files || []);
            if (picked.length) setFiles((prev) => [...prev, ...picked].slice(0, 10));
            e.target.value = '';
          }} />
          {files.length > 0 && (
            <ul className="space-y-1 rounded-xl border p-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate" style={{ color: 'var(--color-text)' }}>{f.name}</span>
                  <Tooltip text={`Remove ${f.name}.`}>
                    <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="hover:opacity-60" style={{ color: 'var(--color-muted)' }}>Remove</button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
          <Tooltip text="Extract text and image references from the chosen files.">
            <button
              type="button"
              onClick={importFiles}
              disabled={busy || !files.length}
              className="px-4 py-2 rounded-xl text-sm font-medium hover:opacity-80 disabled:opacity-40 transition-opacity"
              style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
            >
              {busy ? 'Importing…' : 'Import files'}
            </button>
          </Tooltip>
        </div>

        <div className="border-t pt-4 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Or import a web page</span>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[16rem] flex-1">
              <Tooltip text="A normal http/https page address. Vault fetches it on the server and keeps only readable text and images.">
                <VoiceInput value={url} onChange={setUrl} label="Web page URL" placeholder="https://example.org/article" />
              </Tooltip>
            </div>
            <Tooltip text="Fetch and extract the page text.">
              <button
                type="button"
                onClick={importUrl}
                disabled={busy || !url.trim()}
                className="px-3 py-2 rounded-xl text-xs font-medium border hover:opacity-70 disabled:opacity-40 transition-opacity"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                Fetch URL
              </button>
            </Tooltip>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="space-y-1">
            {warnings.map((w, i) => <Notice key={`${w}-${i}`} tone="warn">{w}</Notice>)}
          </div>
        )}

        {(sourceText || imageRefs.length > 0) && (
          <div className="space-y-2 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
              Extracted source · {sourceText.length} characters · {imageRefs.length} image{imageRefs.length === 1 ? '' : 's'}
            </span>
            <Tooltip text="Correct anything the extractor misread before you make the deck.">
              <VoiceInput type="textarea" rows={8} value={sourceText} onChange={setSourceText} label="Extracted text" append placeholder="Extracted text appears here." />
            </Tooltip>
            {imageRefs.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {imageRefs.map((ref, i) => (
                  <img key={`${ref}-${i}`} src={ref} alt={`Imported ${i + 1}`} className="h-20 w-24 rounded-lg border object-cover" style={{ borderColor: 'var(--color-border)' }} />
                ))}
              </div>
            )}
            <Tooltip text="Use this text and these pictures as the source for a new deck.">
              <button
                type="button"
                onClick={() => openTool('create')}
                className="px-4 py-2 rounded-xl text-sm font-medium hover:opacity-80 transition-opacity"
                style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
              >
                Continue to Create deck
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </section>
  );
}
