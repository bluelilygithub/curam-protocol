import { useRef, useState } from 'react';

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const typeOf = (name: string) => (/\.([^.]+)$/.exec(name)?.[1] ?? '?').toUpperCase();
const TYPES = 'PDF, Word (.docx), web page (.html), Markdown (.md) or plain text (.txt)';
export const FETCH_PRIVACY = "Only this address is sent, to Vault's server, which downloads the page. Your files and drafts stay in this browser.";

/** A file box. With `onFetch` (inside Vault only) it also takes a web address: the page is fetched and used as this box's file. */
export function DropZone({ label, hint, file, onFile, onFetch }: { label: string; hint: string; file?: File; onFile: (f: File | undefined) => void; onFetch?: (url: string) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [fetchError, setFetchError] = useState<string>();
  const fetchIt = async () => {
    if (!onFetch || !url.trim() || busy) return;
    setBusy(true); setFetchError(undefined);
    try { await onFetch(url); setUrl(''); } catch (e) { setFetchError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div
      className={`drop${over ? ' over' : ''}${file ? ' has-file' : ''}`}
      title={`${label}: ${hint} Drop a ${TYPES} file here. Both files must be the same type, except that a web page and a Word file can be compared.`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
    >
      <h2>{label}</h2>
      {file ? (
        <div className="file-info">
          <span className="file-name">{file.name}</span>
          <span className="muted">{typeOf(file.name)} · {fmtSize(file.size)}</span>
        </div>
      ) : (
        <p className="muted">Drop a PDF, DOCX, web page (HTML), Markdown or text file here</p>
      )}
      <div className="row">
        <button className="btn" onClick={() => input.current?.click()} title={file ? `Pick a different ${label.toLowerCase()} file. The current results are cleared.` : `Pick the ${label.toLowerCase()} file from your computer (${TYPES}). It is read here, never uploaded.`}>{file ? 'Replace…' : 'Choose file…'}</button>
        {file && <button className="btn ghost" onClick={() => onFile(undefined)} aria-label={`Remove ${label} file`} title={`Remove this file. The current results are cleared.`}>Remove</button>}
      </div>
      {onFetch && (
        <div className="fetch-page" data-guide="fetch-page">
          <label className="field">Or fetch a web page
            <span className="row">
              <input type="url" inputMode="url" value={url} placeholder="https://example.com/page" disabled={busy}
                onChange={(e) => { setUrl(e.target.value); setFetchError(undefined); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void fetchIt(); } }}
                title={`The address of a public web page. ${FETCH_PRIVACY}`} />
              <button className="btn" disabled={!url.trim() || busy} onClick={() => void fetchIt()}
                title={`Fetch the page and use its main content as the ${label.toLowerCase()}. ${FETCH_PRIVACY}`}>{busy ? 'Fetching…' : 'Fetch'}</button>
            </span>
          </label>
          <p className="muted small">{FETCH_PRIVACY} For a page behind a login, or one built with JavaScript, save it from your browser (File &gt; Save Page As) and choose that file instead.</p>
          {fetchError && <p className="text-removed small" role="alert">{fetchError}</p>}
        </div>
      )}
      <input ref={input} type="file" hidden accept=".pdf,.docx,.html,.htm,.md,.markdown,.txt,.text" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </div>
  );
}
