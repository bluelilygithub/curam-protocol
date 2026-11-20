import { useRef, useState } from 'react';

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const typeOf = (name: string) => (/\.([^.]+)$/.exec(name)?.[1] ?? '?').toUpperCase();
const TYPES = 'PDF, Word (.docx), Markdown (.md) or plain text (.txt)';

export function DropZone({ label, hint, file, onFile }: { label: string; hint: string; file?: File; onFile: (f: File | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`drop${over ? ' over' : ''}${file ? ' has-file' : ''}`}
      title={`${label}: ${hint} Drop a ${TYPES} file here. Both files must be the same type.`}
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
        <p className="muted">Drop a PDF, DOCX, Markdown or text file here</p>
      )}
      <div className="row">
        <button className="btn" onClick={() => input.current?.click()} title={file ? `Pick a different ${label.toLowerCase()} file. The current results are cleared.` : `Pick the ${label.toLowerCase()} file from your computer (${TYPES}). It is read here, never uploaded.`}>{file ? 'Replace…' : 'Choose file…'}</button>
        {file && <button className="btn ghost" onClick={() => onFile(undefined)} aria-label={`Remove ${label} file`} title={`Remove this file. The current results are cleared.`}>Remove</button>}
      </div>
      <input ref={input} type="file" hidden accept=".pdf,.docx,.md,.markdown,.txt,.text" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </div>
  );
}
