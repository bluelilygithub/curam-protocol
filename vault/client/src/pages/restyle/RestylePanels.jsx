import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import ContextButton from '../../components/ContextButton';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { BRAND_TARGETS, tokenRef } from './editModel.mjs';
import { FONT_OPTIONS } from './pageHelpers.mjs';

// The tool panels of the CSS page that are not about editing one clicked item (those are in PropertyPanels.jsx): bringing the page in,
// style files, brand colours and fonts, the change list, the accessibility checks, export, saving, history and sharing. Each takes what
// it shows and what to do through props; RestylePage.jsx owns the state. Plain words only, no CSS jargon.

export const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
export const PRIMARY = { background: 'var(--color-primary)', color: '#fff' };
const OUTLINE = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const SMALL_BTN = 'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-opacity duration-200 hover:opacity-70 disabled:opacity-50';
const PRIMARY_BTN = 'px-3 py-1.5 rounded-lg text-sm font-semibold transition-opacity duration-200 hover:opacity-80 disabled:opacity-45';
const MUTED = { color: 'var(--color-muted)' };

const statusColour = (kind) => (kind === 'error' ? '#b3452c' : kind === 'ok' ? '#2f7a3d' : 'var(--color-muted)');
const when = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return ''; } };

export function Status({ status }) {
  if (!status || !status.text) return null;
  return <p className="text-xs mt-2" style={{ color: statusColour(status.kind) }} role="status">{status.text}</p>;
}

function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 mb-2" role="tablist">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className="transition-opacity duration-200 hover:opacity-70"
          style={{
            flex: 1, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem',
            border: '1px solid var(--color-border)',
            background: value === id ? 'var(--color-primary)' : 'var(--color-bg)',
            color: value === id ? '#fff' : 'var(--color-muted)',
          }}
        >{label}</button>
      ))}
    </div>
  );
}

function DropBox({ onFiles, accept, multiple, children }) {
  const [over, setOver] = useState(false);
  const inputRef = React.useRef(null);
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
      className="rounded-xl border-2 border-dashed p-5 text-center text-sm cursor-pointer transition-all duration-200"
      style={{ borderColor: over ? 'var(--color-primary)' : 'var(--color-border)', color: 'var(--color-muted)' }}
    >
      {children}
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

/** Your page: a live page by its address, an uploaded file, or pasted HTML. */
export function PagePanel({ onFile, onPaste, onAddress, status, busy, renderAvailable, sourceUrl }) {
  const [tab, setTab] = useState('address');
  const [url, setUrl] = useState('');
  const [render, setRender] = useState(false);
  const [paste, setPaste] = useState('');
  return (
    <section>
      <Tabs tabs={[['address', 'Web address'], ['file', 'Upload a file'], ['paste', 'Paste it in']]} value={tab} onChange={setTab} />
      {tab === 'address' && (
        <div className="space-y-2">
          <Tooltip text="The address of a public page, such as https://www.example.com/. The page and its style files are loaded for you. You can say it with the microphone.">
            <div>
              <VoiceInput
                value={url}
                onChange={setUrl}
                parse={(t) => {
                  const joined = String(t || '').replace(/\b(dot|slash|colon|dash|hyphen|underscore)\b/gi, (w) => ({ dot: '.', slash: '/', colon: ':', dash: '-', hyphen: '-', underscore: '_' }[w.toLowerCase()])).replace(/\s+/g, '').replace(/\.+$/, '');
                  return joined ? joined.toLowerCase() : null;
                }}
                placeholder="https://www.example.com/"
                label="Address of the page"
                onKeyDown={(e) => { if (e.key === 'Enter' && url.trim() && !busy) onAddress(url, render); }}
              />
            </div>
          </Tooltip>
          <Tooltip text={renderAvailable ? 'Tick this if the page comes up empty or half-built. It is opened in a real browser first so its scripts can build it. Slower, and limited to 8 an hour.' : 'Not set up on this server.'}>
            <label className="flex items-start gap-2 text-xs" style={{ color: renderAvailable ? 'var(--color-text)' : 'var(--color-muted)' }}>
              <input type="checkbox" className="mt-0.5" checked={render} disabled={!renderAvailable} onChange={(e) => setRender(e.target.checked)} />
              <span>This page builds itself with JavaScript (loads slower)</span>
            </label>
          </Tooltip>
          <Tooltip text="Fetch the page, its style files and its pictures, and build the preview.">
            <button type="button" className={PRIMARY_BTN} style={PRIMARY} disabled={!url.trim() || busy} onClick={() => onAddress(url, render)}>{busy ? 'Loading the page…' : 'Load this page'}</button>
          </Tooltip>
          {sourceUrl && <p className="text-xs break-all" style={MUTED}>Loaded from {sourceUrl}</p>}
          <p className="text-xs" style={MUTED}>Pages behind a sign-in cannot be loaded. Save the page from your browser and upload it instead.</p>
        </div>
      )}
      {tab === 'file' && (
        <DropBox accept=".html,.htm" onFiles={(files) => files[0] && onFile(files[0])}>
          <p>Drop your .html file here, or click to choose one</p>
        </DropBox>
      )}
      {tab === 'paste' && (
        <div>
          <textarea className="w-full text-sm rounded-xl border p-2 mb-2" style={{ ...FIELD, minHeight: 110 }} aria-label="Your page's HTML" placeholder="Paste your page's HTML here..." value={paste} onChange={(e) => setPaste(e.target.value)} />
          <button className={SMALL_BTN} style={OUTLINE} disabled={!paste.trim()} onClick={() => onPaste(paste)}>Use this HTML</button>
        </div>
      )}
      <Status status={status} />
    </section>
  );
}

/** Style files: add, order, remove, build. */
export function StylesPanel({ entries, onAddFiles, onAddPaste, onMove, onRemove, htmlLoaded, onBuild, status, flags }) {
  const getIcon = useIcon();
  const [tab, setTab] = useState('file');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  return (
    <section>
      <p className="text-xs mb-2" style={MUTED}>A live page brings its own. Add more if you like. Files lower in the list win if two disagree. All optional.</p>
      <Tabs tabs={[['file', 'Upload files'], ['paste', 'Paste a snippet']]} value={tab} onChange={setTab} />
      {tab === 'file' ? (
        <DropBox accept=".css" multiple onFiles={onAddFiles}><p>Drop one or more .css files here, or click to choose</p></DropBox>
      ) : (
        <div>
          <div className="mb-1.5">
            <VoiceInput value={name} onChange={setName} placeholder="Give it a name, e.g. 'Homepage styles'" label="Name for the pasted styles" />
          </div>
          <textarea className="w-full text-sm rounded-xl border p-2 mb-2" style={{ ...FIELD, minHeight: 110 }} aria-label="Style snippet" placeholder="Paste a style snippet here..." value={text} onChange={(e) => setText(e.target.value)} />
          <button className={SMALL_BTN} style={OUTLINE} disabled={!text.trim()} onClick={() => { onAddPaste(name, text); setName(''); setText(''); }}>Add this snippet</button>
        </div>
      )}

      <ul className="flex flex-col gap-1.5 my-3">
        {entries.map((entry, i) => (
          <li key={entry.id} className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
            <span className="flex-1 truncate" style={{ color: 'var(--color-text)' }}>{entry.filename}</span>
            <Tooltip text="Move earlier (lower priority)"><button className="hover:opacity-60" aria-label="Move earlier" disabled={i === 0} onClick={() => onMove(i, -1)} style={{ ...MUTED, opacity: i === 0 ? 0.3 : 1 }}>{getIcon('chevron-up', { size: 14 })}</button></Tooltip>
            <Tooltip text="Move later (higher priority)"><button className="hover:opacity-60" aria-label="Move later" disabled={i === entries.length - 1} onClick={() => onMove(i, 1)} style={{ ...MUTED, opacity: i === entries.length - 1 ? 0.3 : 1 }}>{getIcon('chevron-down', { size: 14 })}</button></Tooltip>
            <Tooltip text="Remove this file"><button className="hover:opacity-60" aria-label="Remove" onClick={() => onRemove(entry.id)} style={MUTED}>{getIcon('x', { size: 14 })}</button></Tooltip>
          </li>
        ))}
      </ul>

      <Tooltip text={htmlLoaded ? 'Put the page and style files together in a live preview you can click to change.' : 'Add your page first (the Your page tool).'}>
        <button className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity duration-200 hover:opacity-80 disabled:opacity-45" style={PRIMARY} disabled={!htmlLoaded} onClick={onBuild}>Build the preview</button>
      </Tooltip>
      {!htmlLoaded && <p className="text-xs mt-1.5" style={MUTED}>Add your page first to enable this.</p>}
      <Status status={status} />

      {flags.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Things worth a look</h3>
          <ul className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
            {flags.map((flag, i) => (
              <li key={i} className="text-xs rounded-md p-1.5 pl-2" style={{ background: '#fdf3ea', borderLeft: '3px solid #d99a3f', color: '#5a4322' }}>{flag}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Brand colours and fonts, and applying them across the page. */
export function BrandPanel({ tokens, detectedFonts, onAdd, onUpdate, onRemove, onDetect, onApply, previewBuilt }) {
  const getIcon = useIcon();
  const [tokenId, setTokenId] = useState('');
  const [targetId, setTargetId] = useState('');
  const chosen = tokens.find((t) => t.id === tokenId) || tokens[0];
  const targets = BRAND_TARGETS.filter((t) => chosen && t.kind === chosen.kind);
  const target = targets.find((t) => t.id === targetId) || targets[0];
  const fontChoices = [...FONT_OPTIONS.filter((f) => f.value), ...detectedFonts.filter((f) => !FONT_OPTIONS.some((o) => o.value === f.value)).map((f) => ({ value: f.value, label: f.label }))];
  return (
    <section className="space-y-4">
      <p className="text-xs" style={MUTED}>Set your colours and fonts once. Use them on any change (they appear as quick picks), or apply one across the whole page below. Change one here later and everything using it follows.</p>
      <div className="space-y-2">
        {tokens.length === 0 && <p className="text-xs" style={MUTED}>No brand colours or fonts yet.</p>}
        {tokens.map((t) => (
          <div key={t.id} className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <VoiceInput value={t.name} onChange={(v) => onUpdate(t.id, { name: v })} placeholder={t.kind === 'color' ? 'Colour name' : 'Font name'} label={`Name of this brand ${t.kind}`} />
            </div>
            {t.kind === 'color' ? (
              <Tooltip text="The colour. Everything using it changes with it."><input type="color" aria-label={`${t.name} colour`} value={t.value} onChange={(e) => onUpdate(t.id, { value: e.target.value })} style={{ width: 40, height: 34, border: '1px solid var(--color-border)', borderRadius: 6, flexShrink: 0 }} /></Tooltip>
            ) : (
              <Tooltip text="The font.">
                <select aria-label={`${t.name} font`} className="rounded-lg border p-1.5 text-xs" style={{ ...FIELD, maxWidth: 110 }} value={t.value} onChange={(e) => onUpdate(t.id, { value: e.target.value })}>
                  {!fontChoices.some((f) => f.value === t.value) && <option value={t.value}>{t.value}</option>}
                  {fontChoices.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </Tooltip>
            )}
            <Tooltip text="Remove it, and take back any change that used it."><button aria-label={`Remove ${t.name}`} className="hover:opacity-60" style={MUTED} onClick={() => onRemove(t.id)}>{getIcon('x', { size: 14 })}</button></Tooltip>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          <button className={SMALL_BTN} style={OUTLINE} onClick={() => onAdd('color')}>Add a colour</button>
          <button className={SMALL_BTN} style={OUTLINE} onClick={() => onAdd('font')}>Add a font</button>
          <Tooltip text="Add the colours this page already uses as brand colours, to adjust in one place."><button className={SMALL_BTN} style={OUTLINE} onClick={onDetect}>Find the page's colours</button></Tooltip>
        </div>
      </div>

      {chosen && (
        <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Use it across the page</h3>
          <label className="flex flex-col gap-1 text-xs" style={MUTED}>
            Use
            <select className="rounded-lg border p-1.5" style={FIELD} value={chosen.id} onChange={(e) => { setTokenId(e.target.value); setTargetId(''); }}>
              {tokens.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.kind === 'color' ? 'colour' : 'font'})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs" style={MUTED}>
            For
            <select className="rounded-lg border p-1.5" style={FIELD} value={target ? target.id : ''} onChange={(e) => setTargetId(e.target.value)}>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <ContextButton reason={!previewBuilt ? 'Build the preview first.' : (!target ? 'Choose where to use it first.' : '')} tip="Make this change everywhere it applies on the page. It shows in Changes so far and can be undone." className={PRIMARY_BTN} style={PRIMARY} onClick={() => onApply(chosen, target)}>Apply to the page</ContextButton>
          {!previewBuilt && <p className="text-xs" style={MUTED}>Build the preview first to apply it.</p>}
          <p className="text-xs" style={MUTED}>Written as {tokenRef(chosen)}, so changing “{chosen.name}” above changes it everywhere.</p>
        </div>
      )}
    </section>
  );
}

/** Every change made so far. */
export function ChangesPanel({ rows, tokens, onRemove, onClear, onUndo, canUndo, reasons = {} }) {
  const getIcon = useIcon();
  const [confirm, setConfirm] = useState(false);
  const show = (value) => {
    const t = tokens.find((x) => value === tokenRef(x));
    return t ? `brand ${t.kind === 'color' ? 'colour' : 'font'} “${t.name}”` : value;
  };
  if (!rows.length) return <p className="text-sm" style={MUTED}>No changes yet. Click something in the preview and change it, and it is listed here with what it was before.</p>;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold flex-1" style={{ color: 'var(--color-text)' }}>{rows.length} change{rows.length === 1 ? '' : 's'}</p>
        <ContextButton reason={!canUndo ? reasons.undo : ''} tip="Take back your last change." className={SMALL_BTN} style={OUTLINE} onClick={onUndo}>Undo last</ContextButton>
        {confirm ? (
          <span className="text-xs" style={{ color: 'var(--color-text)' }}>Clear all? <button className="font-semibold hover:opacity-70" style={{ color: '#b3452c' }} onClick={() => { onClear(); setConfirm(false); }}>Yes</button> / <button className="hover:opacity-70" onClick={() => setConfirm(false)}>No</button></span>
        ) : (
          <button className={SMALL_BTN} style={OUTLINE} onClick={() => setConfirm(true)}>Clear all</button>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold break-words" style={{ color: 'var(--color-text)' }}>{r.where}{r.when ? <span className="font-normal" style={MUTED}> · {r.when}</span> : null}</p>
              <p className="break-words" style={{ color: 'var(--color-text)' }}>{r.what}: {r.was ? <><span style={MUTED}>{r.was}</span> → </> : null}<strong>{show(r.value)}</strong></p>
            </div>
            <Tooltip text="Take this change back."><button aria-label="Take this change back" className="hover:opacity-60" style={MUTED} onClick={() => onRemove(r)}>{getIcon('x', { size: 14 })}</button></Tooltip>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Accessibility checks for the whole page. */
export function ChecksPanel({ result, onRun, onPick, showingOriginal }) {
  const kindLabel = { contrast: 'Hard to read', alt: 'No description', small: 'Very small' };
  const counts = result ? result.issues.reduce((m, i) => ({ ...m, [i.kind]: (m[i.kind] || 0) + 1 }), {}) : {};
  return (
    <section className="space-y-3">
      <p className="text-xs" style={MUTED}>Looks at every piece of text and every picture on the page for the three most common problems: text that is hard to read against its background, pictures with no description for screen readers, and tiny text.</p>
      <Tooltip text="Check the page as it looks right now in the preview.">
        <button className={PRIMARY_BTN} style={PRIMARY} onClick={onRun}>{result ? 'Check again' : 'Check the page'}</button>
      </Tooltip>
      {showingOriginal && <p className="text-xs" style={{ color: '#b45309' }}>The preview is showing the original, so this checks the original.</p>}
      {result && (
        <>
          <p className="text-sm" style={{ color: result.issues.length ? '#b45309' : '#2f7a3d' }}>
            {result.issues.length === 0
              ? `Nothing found in ${result.checked} pieces of text.`
              : `${result.issues.length} thing${result.issues.length === 1 ? '' : 's'} to look at: ${Object.entries(counts).map(([k, n]) => `${n} ${kindLabel[k].toLowerCase()}`).join(', ')}.`}
          </p>
          <ul className="flex flex-col gap-1.5 max-h-96 overflow-y-auto">
            {result.issues.map((issue, i) => (
              <li key={i}>
                <Tooltip text="Select this in the preview and scroll to it, so you can fix it.">
                  <button type="button" onClick={() => onPick(issue)} className="w-full text-left text-xs rounded-lg border p-2 transition-opacity duration-200 hover:opacity-70" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <strong style={{ color: '#b45309' }}>{kindLabel[issue.kind]}</strong> — {issue.message}
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Export: the CSS, the page, a report. */
export function ExportPanel({ css, important, onImportant, onCopyCss, onDownloadCss, onDownloadPage, onDownloadReport, changeCount, reasons = {} }) {
  return (
    <section className="space-y-3">
      <p className="text-xs" style={MUTED}>The CSS below is every change, written as ordinary styles. Paste it where your site takes extra styles: WordPress (Appearance, Customize, Additional CSS), or the custom CSS box in Shopify, Squarespace and most site builders.</p>
      <Tooltip text="Adds !important so these styles win over the page's own. Leave it on unless your site already puts yours last.">
        <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
          <input type="checkbox" className="mt-0.5" checked={important} onChange={(e) => onImportant(e.target.checked)} />
          <span>Make these styles win over the page's own</span>
        </label>
      </Tooltip>
      {changeCount === 0 && !css ? (
        <p className="text-sm" style={MUTED}>No changes yet, so there is no CSS to take away.</p>
      ) : (
        <pre className="text-xs rounded-lg border p-2 overflow-auto max-h-64" style={{ ...FIELD, whiteSpace: 'pre-wrap' }} aria-label="The CSS">{css}</pre>
      )}
      <div className="flex flex-wrap gap-2">
        <ContextButton reason={!css ? reasons.css : ''} tip="Copy the CSS to the clipboard." className={PRIMARY_BTN} style={PRIMARY} onClick={onCopyCss}>Copy the CSS</ContextButton>
        <ContextButton reason={!css ? reasons.css : ''} tip="Save the CSS as a .css file." className={SMALL_BTN} style={OUTLINE} onClick={onDownloadCss}>Download .css</ContextButton>
        <Tooltip text="Save the whole page, with your changes built in, as one .html file."><button className={SMALL_BTN} style={OUTLINE} onClick={onDownloadPage}>Download the page</button></Tooltip>
        <ContextButton reason={!changeCount ? reasons.report : ''} tip="A plain-text list of every change and where it was made, to give a developer." className={SMALL_BTN} style={OUTLINE} onClick={onDownloadReport}>Download a report</ContextButton>
      </div>
    </section>
  );
}

/** Save, update and open pages. */
export function SavedPanel({ projects, active, nameInput, onName, saving, previewBuilt, onSaveNew, onUpdate, onOpen, onDelete, loadingId }) {
  const getIcon = useIcon();
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const unchangedName = active && nameInput.trim() === active.name;
  return (
    <section className="space-y-3">
      <div className="space-y-2">
        <Tooltip text="A name to find this page by later. You can say it with the microphone.">
          <div>
            <VoiceInput value={nameInput} onChange={onName} placeholder="Name this page…" label="Name for this page" />
          </div>
        </Tooltip>
        <div className="flex flex-wrap gap-2">
          {active && (
            <Tooltip text={`Replace "${active.name}" with the page as it is now. The old version goes into Page history.`}>
              <button className={PRIMARY_BTN} style={PRIMARY} disabled={!previewBuilt || saving} onClick={onUpdate}>{saving ? 'Saving…' : `Update “${active.name}”`}</button>
            </Tooltip>
          )}
          <ContextButton
            reason={!previewBuilt ? 'Build the preview first, then save.' : saving ? 'Saving…' : !nameInput.trim() ? 'Give the page a name first.' : unchangedName ? 'Change the name to save a separate copy.' : ''}
            tip="Keep the page as it looks now, with all your changes, as a new saved page."
            className={active ? SMALL_BTN : PRIMARY_BTN} style={active ? OUTLINE : PRIMARY} onClick={onSaveNew}
          >{saving && !active ? 'Saving…' : (active ? 'Save as a new page' : 'Save this page')}</ContextButton>
        </div>
        {active && unchangedName && <p className="text-xs" style={MUTED}>Change the name to save a separate copy.</p>}
      </div>
      {projects.length === 0 ? (
        <p className="text-xs" style={MUTED}>Nothing saved yet. Build a preview, then save it here.</p>
      ) : (
        <ul className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm border-b last:border-b-0" style={{ borderColor: 'var(--color-border)', background: active && active.id === p.id ? 'var(--color-surface)' : 'var(--color-bg)' }}>
              <Tooltip text="Open this page with all your saved changes.">
                <button className="flex-1 text-left truncate transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-text)' }} disabled={loadingId === p.id} onClick={() => onOpen(p.id)}>
                  {loadingId === p.id ? 'Loading…' : p.name}{p.shared ? <span className="text-xs" style={MUTED}> · shared</span> : null}
                </button>
              </Tooltip>
              {confirmDeleteId === p.id ? (
                <span className="text-xs" style={{ color: 'var(--color-text)' }}>Delete? <button className="font-semibold hover:opacity-70" style={{ color: '#b3452c' }} onClick={() => { setConfirmDeleteId(null); onDelete(p); }}>Yes</button> / <button className="hover:opacity-70" onClick={() => setConfirmDeleteId(null)}>No</button></span>
              ) : (
                <Tooltip text="Delete this saved page."><button className="hover:opacity-60" aria-label={`Delete ${p.name}`} style={MUTED} onClick={() => setConfirmDeleteId(p.id)}>{getIcon('x', { size: 14 })}</button></Tooltip>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Earlier versions of the open saved page. */
export function HistoryPanel({ active, versions, loading, onOpen, openingId }) {
  const [confirmId, setConfirmId] = useState(null);
  if (!active) return <p className="text-sm" style={MUTED}>Open or save a page first (My saved pages). Each time you update it, the old version is kept here.</p>;
  return (
    <section className="space-y-3">
      <p className="text-xs" style={MUTED}>Earlier versions of “{active.name}”. The newest 20 are kept. Opening one puts it in the editor; press Update in My saved pages to make it the saved page again.</p>
      {loading && <p className="text-xs" style={MUTED}>Loading the history…</p>}
      {!loading && versions.length === 0 && <p className="text-sm" style={MUTED}>No earlier versions yet. They appear when you update this page.</p>}
      <ul className="flex flex-col gap-1.5">
        {versions.map((v) => (
          <li key={v.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
            <span className="flex-1 min-w-0" style={{ color: 'var(--color-text)' }}>{when(v.createdAt)}<span className="block" style={MUTED}>{v.name}</span></span>
            {confirmId === v.id ? (
              <span style={{ color: 'var(--color-text)' }}>Replace what is in the editor? <button className="font-semibold hover:opacity-70" style={{ color: '#b3452c' }} onClick={() => { setConfirmId(null); onOpen(v); }}>Yes</button> / <button className="hover:opacity-70" onClick={() => setConfirmId(null)}>No</button></span>
            ) : (
              <button className={SMALL_BTN} style={OUTLINE} disabled={openingId === v.id} onClick={() => setConfirmId(v.id)}>{openingId === v.id ? 'Opening…' : 'Open'}</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The public preview link. */
export function SharePanel({ active, link, busy, onShare, onUnshare, onCopy }) {
  if (!active) return <p className="text-sm" style={MUTED}>Save the page first (My saved pages), then you can make a link to it.</p>;
  return (
    <section className="space-y-3">
      <p className="text-xs" style={MUTED}>A link anyone can open, without a Vault login, to see “{active.name}” with your changes. They can switch between your version and the original. It is read-only, nothing on it can run, and search engines are asked not to list it.</p>
      {link ? (
        <>
          <input readOnly value={link} aria-label="Preview link" className="w-full text-xs rounded-lg border p-2" style={FIELD} onFocus={(e) => e.target.select()} />
          <div className="flex flex-wrap gap-2">
            <button className={PRIMARY_BTN} style={PRIMARY} onClick={onCopy}>Copy the link</button>
            <Tooltip text="The link stops working at once."><button className={SMALL_BTN} style={OUTLINE} disabled={busy} onClick={onUnshare}>Stop sharing</button></Tooltip>
          </div>
          <p className="text-xs" style={MUTED}>The link shows the page as it was last saved. After more changes, press Update in My saved pages.</p>
        </>
      ) : (
        <Tooltip text="Make a link to the saved page. You can turn it off at any time.">
          <button className={PRIMARY_BTN} style={PRIMARY} disabled={busy} onClick={onShare}>{busy ? 'Making the link…' : 'Make a preview link'}</button>
        </Tooltip>
      )}
    </section>
  );
}
