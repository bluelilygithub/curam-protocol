import { useState } from 'react';
import { DEFAULT_SETTINGS, loadTemplates, saveTemplates, type HeadingTemplates, type Settings, type TrivialRules } from '../settings';

const RULES: [keyof TrivialRules, string][] = [
  ['whitespace', 'Whitespace (spaces, tabs, trailing spaces, line wraps)'],
  ['quotes', 'Straight vs curly quotes, dashes vs hyphens, non-breaking spaces'],
  ['unicode', 'Unicode normalisation and zero-width characters'],
  ['lineEndings', 'Line endings'],
];

/** The Settings view. Changes apply at once and are remembered in this browser. */
export function SettingsPanel({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const num = (k: 'similarityThreshold' | 'fileSizeChangePct' | 'wordCountDropPct', v: string) => { const n = Number(v); if (Number.isFinite(n) && n >= 0) onChange({ ...settings, [k]: n }); };
  const limit = (k: 'wordLimit' | 'pageLimit', v: string) => { const n = Number(v); onChange({ ...settings, [k]: v && n > 0 ? Math.round(n) : null }); };
  const [headingsText, setHeadingsText] = useState(settings.requiredHeadings.join('\n'));
  const [templates, setTemplates] = useState<HeadingTemplates>(loadTemplates);
  const [templateName, setTemplateName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const applyHeadings = (text: string) => { setHeadingsText(text); onChange({ ...settings, requiredHeadings: text.split('\n').map((l) => l.trim()).filter(Boolean) }); };
  const updateTemplates = (t: HeadingTemplates) => { setTemplates(t); saveTemplates(t); };
  const [glossaryText, setGlossaryText] = useState((settings.glossary ?? []).join('\n'));
  const applyGlossary = (text: string) => { setGlossaryText(text); onChange({ ...settings, glossary: text.split('\n').map((l) => l.trim()).filter(Boolean) }); };
  const loadGlossary = async (f: File | undefined) => { if (f) applyGlossary(await f.text()); };

  return (
    <div className="settings-panel" data-guide="settings-form">
      <h2>Limits</h2>
      <div className="row">
        <label className="field narrow">Word limit
          <input type="number" min={1} step={50} value={settings.wordLimit ?? ''} placeholder="none" onChange={(e) => limit('wordLimit', e.target.value)} title="The submission's word limit. Over it is a red item. Also on the Compare documents screen." />
        </label>
        <label className="field narrow">Page limit
          <input type="number" min={1} value={settings.pageLimit ?? ''} placeholder="none" onChange={(e) => limit('pageLimit', e.target.value)} title="The submission's page limit. Over it is a red item. Uses the page count PDFs and Word files record." />
        </label>
      </div>
      <label className="inline" title="Leave the reference list (References, Bibliography, Sources, Works cited, Endnotes, Notes) out of the word count, as most submissions do."><input type="checkbox" checked={settings.excludeReferences} onChange={(e) => onChange({ ...settings, excludeReferences: e.target.checked })} /> Don't count the reference list</label>
      <label className="inline" title="Count the words in footnotes and endnotes (Word and Markdown; in a PDF, footnotes are found by best effort)."><input type="checkbox" checked={settings.includeFootnotes} onChange={(e) => onChange({ ...settings, includeFootnotes: e.target.checked })} /> Count footnotes and endnotes</label>

      <h2>Required headings</h2>
      <p className="muted small">Leave empty and every heading in your original counts as required (a removed heading is already reported). Or paste the headings this submission must have, one per line, for example an inquiry's terms of reference: a missing one is red, and one out of order is amber. Numbering and small wording differences are allowed.</p>
      <textarea className="headings" rows={6} value={headingsText} onChange={(e) => applyHeadings(e.target.value)} placeholder={'Executive summary\nBackground\nRecommendations'} aria-label="Required headings, one per line" data-guide="required-headings"
        title="One required heading per line. Applies to the next comparison and updates the current one." />
      <div className="row">
        <input className="template-name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name, e.g. Senate inquiry 2026" aria-label="Template name" title="A name to save this list under, so you can use it again." />
        <button className="btn" disabled={!templateName.trim() || !settings.requiredHeadings.length} onClick={() => { updateTemplates({ ...templates, [templateName.trim()]: settings.requiredHeadings }); setTemplateName(''); }} title="Save this list of required headings as a named template in this browser.">Save as template</button>
      </div>
      {Object.keys(templates).length > 0 && (
        <ul className="templates">
          {Object.entries(templates).map(([name, list]) => (
            <li key={name}>
              <span><strong>{name}</strong> <span className="muted small">({list.length} heading{list.length === 1 ? '' : 's'})</span></span>
              <button className="btn" onClick={() => applyHeadings(list.join('\n'))} title={`Use these required headings: ${list.join(', ')}`}>Use</button>
              {confirmDelete === name
                ? <span className="inline">Delete? <button className="btn danger" onClick={() => { const t = { ...templates }; delete t[name]; updateTemplates(t); setConfirmDelete(undefined); }}>Yes</button><button className="btn ghost" onClick={() => setConfirmDelete(undefined)}>No</button></span>
                : <button className="btn ghost" onClick={() => setConfirmDelete(name)} title="Delete this template from this browser.">Delete</button>}
            </li>
          ))}
        </ul>
      )}
      {settings.requiredHeadings.length > 0 && <button className="btn ghost" onClick={() => applyHeadings('')} title="Go back to treating every original heading as required.">Clear the list</button>}

      <h2>Protected terms</h2>
      <p className="muted small">Terms the LLM must keep, one per line (names of programs, legislation, defined terms). If the edited version stops using one, or uses it less than half as often, that is amber. Defined terms, acronyms and phrases your original repeats are found without a list.</p>
      <textarea className="headings" rows={4} value={glossaryText} onChange={(e) => applyGlossary(e.target.value)} placeholder={'Residential Tenancies Act 2010\nTenants Advice Network'} aria-label="Protected terms, one per line" data-guide="glossary"
        title="One term per line. Applies to the next comparison and updates the current one." />
      <div className="row">
        <label className="btn" title="Load a glossary from a plain-text file, one term per line. The file stays on this computer.">Load from a file<input type="file" accept=".txt,text/plain" hidden onChange={(e) => { void loadGlossary(e.target.files?.[0]); e.target.value = ''; }} /></label>
        {glossaryText.trim() && <button className="btn ghost" onClick={() => applyGlossary('')} title="Remove every protected term.">Clear the list</button>}
      </div>

      <h2>Checks</h2>
      <label className="field">Same-document threshold (0–100)
        <input type="number" min={0} max={100} value={settings.similarityThreshold} onChange={(e) => num('similarityThreshold', e.target.value)} title="Below this score you are warned that the two files may not be versions of the same document. 60 by default." />
        <span className="muted">Below this similarity score you're warned the files may not be versions of the same document.</span>
      </label>
      <label className="field">Flag file-size change above (%)
        <input type="number" min={0} value={settings.fileSizeChangePct} onChange={(e) => num('fileSizeChangePct', e.target.value)} title="A file that shrank or grew by more than this is flagged in File details. A much smaller file often means skipped content. 20 by default." />
      </label>
      <label className="field">Flag word-count drop above (%)
        <input type="number" min={0} value={settings.wordCountDropPct} onChange={(e) => num('wordCountDropPct', e.target.value)} title="A word count that dropped by more than this is a red item. 5 by default." />
      </label>
      <fieldset>
        <legend>Treat as trivial (hidden, but counted)</legend>
        {RULES.map(([k, label]) => (
          <label key={k} className="inline" title="Ticked: differences of this kind are hidden and only counted. Unticked: they are listed as wording changes."><input type="checkbox" checked={settings.trivial[k]} onChange={(e) => onChange({ ...settings, trivial: { ...settings.trivial, [k]: e.target.checked } })} /> {label}</label>
        ))}
        <label className="inline" title="List the trivial changes in All changes too (shown faded)."><input type="checkbox" checked={settings.showTrivial} onChange={(e) => onChange({ ...settings, showTrivial: e.target.checked })} /> Show trivial changes in the table</label>
      </fieldset>
      <div className="row"><button className="btn" onClick={() => { onChange(DEFAULT_SETTINGS); setHeadingsText(''); }} title="Put every setting back to its default (saved templates are kept).">Reset to defaults</button></div>
    </div>
  );
}
