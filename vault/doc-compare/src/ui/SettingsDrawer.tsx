import { useEffect, useRef } from 'react';
import { DEFAULT_SETTINGS, type Settings, type TrivialRules } from '../settings';

const RULES: [keyof TrivialRules, string][] = [
  ['whitespace', 'Whitespace (spaces, tabs, trailing spaces, line wraps)'],
  ['quotes', 'Straight vs curly quotes, dashes vs hyphens, non-breaking spaces'],
  ['unicode', 'Unicode normalisation and zero-width characters'],
  ['lineEndings', 'Line endings'],
];

export function SettingsDrawer({ settings, onChange, onClose }: { settings: Settings; onChange: (s: Settings) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const num = (k: 'similarityThreshold' | 'fileSizeChangePct' | 'wordCountDropPct', v: string) => { const n = Number(v); if (Number.isFinite(n) && n >= 0) onChange({ ...settings, [k]: n }); };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="drawer-head"><h2>Settings</h2><button className="btn ghost" onClick={onClose} aria-label="Close settings" title="Close Settings (Esc). Changes are already applied and remembered in this browser.">✕</button></div>
        <label className="field">Same-document threshold (0–100)
          <input type="number" min={0} max={100} value={settings.similarityThreshold} onChange={(e) => num('similarityThreshold', e.target.value)} title="Below this score you are warned that the two files may not be versions of the same document. 60 by default." />
          <span className="muted">Below this similarity score you're warned the files may not be versions of the same document.</span>
        </label>
        <label className="field">Flag file-size change above (%)
          <input type="number" min={0} value={settings.fileSizeChangePct} onChange={(e) => num('fileSizeChangePct', e.target.value)} title="A file that shrank or grew by more than this is flagged in the metadata. A much smaller file often means skipped content. 20 by default." />
        </label>
        <label className="field">Flag word-count drop above (%)
          <input type="number" min={0} value={settings.wordCountDropPct} onChange={(e) => num('wordCountDropPct', e.target.value)} title="A word count that dropped by more than this is a High severity flag. 5 by default." />
        </label>
        <fieldset>
          <legend>Treat as trivial (hidden, but counted)</legend>
          {RULES.map(([k, label]) => (
            <label key={k} className="inline" title="Ticked: differences of this kind are hidden and only counted. Unticked: they are listed as wording changes."><input type="checkbox" checked={settings.trivial[k]} onChange={(e) => onChange({ ...settings, trivial: { ...settings.trivial, [k]: e.target.checked } })} /> {label}</label>
          ))}
          <label className="inline" title="List the trivial changes in the table too (shown faded)."><input type="checkbox" checked={settings.showTrivial} onChange={(e) => onChange({ ...settings, showTrivial: e.target.checked })} /> Show trivial changes in the table</label>
        </fieldset>
        <button className="btn" onClick={() => onChange(DEFAULT_SETTINGS)} title="Put every setting back to its default.">Reset to defaults</button>
      </div>
    </div>
  );
}
