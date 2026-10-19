import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { PRIMARY, Status } from './RestylePanels';

// Two tool panels of the CSS page: History of this session (go back to any point, forward again, or take back just one change) and
// Download a page's CSS (the style files a live page depends on, and a summary of the design settings they set). RestylePage.jsx owns the
// state; these only show it. Plain words only, no CSS jargon.

const MUTED = { color: 'var(--color-muted)' };
const OUTLINE = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const SMALL_BTN = 'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-opacity duration-200 hover:opacity-70 disabled:opacity-50';
const PRIMARY_BTN = 'px-3 py-1.5 rounded-lg text-sm font-semibold transition-opacity duration-200 hover:opacity-80 disabled:opacity-45';

const clock = (at) => { try { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; } };

// What is said to the microphone for an address: "example dot com slash shop".
const spokenAddress = (t) => {
  const symbols = { dot: '.', slash: '/', colon: ':', dash: '-', hyphen: '-', underscore: '_' };
  const joined = String(t || '').replace(/\b(dot|slash|colon|dash|hyphen|underscore)\b/gi, (w) => symbols[w.toLowerCase()]).replace(/\s+/g, '').replace(/\.+$/, '');
  return joined ? joined.toLowerCase() : null;
};

/** A small square button with just an icon: the words are its tooltip and its name for screen readers. */
function IconButton({ icon, label, tip, onClick }) {
  const getIcon = useIcon();
  return (
    <Tooltip text={tip}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="w-7 h-7 inline-flex items-center justify-center rounded-lg border transition-opacity duration-200 hover:opacity-60"
        style={OUTLINE}
      >
        {getIcon(icon, { size: 14 })}
      </button>
    </Tooltip>
  );
}

/** Every change made in this session, with a way back to any point, forward again, or to take back just one. */
export function SessionHistoryPanel({ entries, cursor, onGoTo, onRevert, onUndo, onRedo }) {
  const rows = entries.map((entry, index) => ({ entry, index })).reverse(); // newest first
  // "You are here" sits between the undone entries (above it) and the applied ones (below it).
  const hereAt = rows.findIndex((r) => r.index < cursor);
  const here = (
    <li key="here" className="text-xs font-semibold rounded-lg px-2.5 py-1.5" style={{ background: 'var(--color-primary)', color: '#fff' }}>
      You are here{cursor === 0 && entries.length > 0 ? ': the page as it was loaded' : ''}
    </li>
  );
  return (
    <section className="space-y-3">
      <p className="text-xs" style={MUTED}>Everything you change in this session, newest first. Go back to any point, go forward again, or take back just one change and keep the ones made after it. It starts again when you load another page or reload this one.</p>
      <div className="flex flex-wrap gap-2">
        <button className={SMALL_BTN} style={OUTLINE} disabled={cursor === 0} onClick={onUndo}>Undo one step</button>
        <button className={SMALL_BTN} style={OUTLINE} disabled={cursor >= entries.length} onClick={onRedo}>Redo one step</button>
        <Tooltip text="Go back to the page as it was loaded, before any of your changes. You can come forward again."><button className={SMALL_BTN} style={OUTLINE} disabled={cursor === 0} onClick={() => onGoTo(0)}>Back to the start</button></Tooltip>
      </div>
      {entries.length === 0 && <p className="text-sm" style={MUTED}>No changes yet. Make a change and it is listed here.</p>}
      <ol className="flex flex-col gap-1.5">
        {rows.map(({ entry, index }, rowIndex) => {
          const applied = index < cursor;
          return (
            <React.Fragment key={entry.id}>
              {rowIndex === (hereAt === -1 ? rows.length : hereAt) && here}
              <li className="rounded-lg border px-2.5 py-2 text-xs flex items-start gap-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', opacity: applied ? 1 : 0.55 }}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold break-words" style={{ color: 'var(--color-text)' }}>{entry.label}</p>
                  <p style={MUTED}>{clock(entry.at)} · {entry.changes.length} thing{entry.changes.length === 1 ? '' : 's'}{applied ? '' : ' · undone'}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  {applied ? (
                    <>
                      <IconButton icon="rotate-ccw" label="Go back to before this" tip="Put everything back as it was just before this change. Later changes stay in the list, so you can come forward again." onClick={() => onGoTo(index)} />
                      <IconButton icon="eraser" label="Take back just this" tip="Take back only this change and keep the ones made after it. If a later change touched the same thing, that later one is kept." onClick={() => onRevert(index)} />
                    </>
                  ) : (
                    <IconButton icon="rotate-cw" label="Go forward to here" tip="Go forward to the page as it was just after this change." onClick={() => onGoTo(index + 1)} />
                  )}
                </div>
              </li>
            </React.Fragment>
          );
        })}
        {hereAt === -1 && rows.length > 0 && null}
      </ol>
    </section>
  );
}

const SECTION_LIMIT = 10;

function SettingsSection({ title, items, children }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, SECTION_LIMIT);
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{title} <span className="font-normal" style={MUTED}>({items.length})</span></h4>
      <ul className="flex flex-col gap-0.5">
        {shown.map((item, i) => <li key={i} className="text-xs flex items-center gap-2 min-w-0" style={{ color: 'var(--color-text)' }}>{children(item)}</li>)}
      </ul>
      {items.length > SECTION_LIMIT && (
        <button className="text-xs hover:opacity-70" style={{ color: 'var(--color-primary)' }} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${items.length}`}</button>
      )}
    </div>
  );
}

const Count = ({ n }) => <span className="shrink-0" style={MUTED}>×{n}</span>;

/** Fetch a live page and take away the style files it depends on, plus a summary of the design settings they set. */
export function ScrapePanel({
  result, busy, status, renderAvailable, onScrape, onUseInEditor, onAddBrand, onCopyFile, onDownloadFile, onDownloadZip, onDownloadCombined,
  onDownloadReport, onDownloadJson, sizeLabel, sourceLabel,
}) {
  const [url, setUrl] = useState('');
  const [render, setRender] = useState(false);
  const s = result && result.summary;
  return (
    <section className="space-y-3">
      <p className="text-xs" style={MUTED}>Type the address of a live page and get the style files it depends on (the ones it links, the ones those import, and the styles written inside it) to download, and a summary of the colours, fonts, sizes and other settings they set. Nothing is changed or saved.</p>
      <Tooltip text="The address of a public page, such as https://www.example.com/. You can say it with the microphone.">
        <div>
          <VoiceInput
            value={url}
            onChange={setUrl}
            parse={spokenAddress}
            placeholder="https://www.example.com/"
            label="Address of the page to read"
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim() && !busy) onScrape(url, render); }}
          />
        </div>
      </Tooltip>
      <Tooltip text={renderAvailable ? 'Tick this if the page builds itself with JavaScript, or its styles are added by script. It is opened in a real browser first. Slower, and limited to 8 an hour.' : 'Not set up on this server.'}>
        <label className="flex items-start gap-2 text-xs" style={{ color: renderAvailable ? 'var(--color-text)' : 'var(--color-muted)' }}>
          <input type="checkbox" className="mt-0.5" checked={render} disabled={!renderAvailable} onChange={(e) => setRender(e.target.checked)} />
          <span>This page builds itself with JavaScript (loads slower)</span>
        </label>
      </Tooltip>
      <Tooltip text="Fetch the page and its style files.">
        <button className={PRIMARY_BTN} style={PRIMARY} disabled={!url.trim() || busy} onClick={() => onScrape(url, render)}>{busy ? 'Fetching the CSS…' : 'Fetch the CSS'}</button>
      </Tooltip>
      <Status status={status} />

      {result && (
        <div className="space-y-4">
          <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <p className="text-sm font-semibold break-words" style={{ color: 'var(--color-text)' }}>{result.title || result.finalUrl}</p>
            <p className="text-xs" style={MUTED}>{s.stats.files} style file{s.stats.files === 1 ? '' : 's'} · {sizeLabel(s.stats.bytes)} · {s.stats.rules} rules · {s.stats.declarations} settings{s.stats.unreadable ? ` · ${s.stats.unreadable} could not be read` : ''}</p>
            <div className="flex flex-wrap gap-2">
              <Tooltip text="Every style file, plus the settings report, in one .zip."><button className={PRIMARY_BTN} style={PRIMARY} disabled={!result.files.length} onClick={onDownloadZip}>Download all (.zip)</button></Tooltip>
              <Tooltip text="Every file joined into one .css file, in the order the page applies them, each under a comment saying where it came from."><button className={SMALL_BTN} style={OUTLINE} disabled={!result.files.length} onClick={onDownloadCombined}>One combined .css</button></Tooltip>
              <Tooltip text="A plain report of the colours, fonts, sizes, spacing, variables and breakpoints the page sets."><button className={SMALL_BTN} style={OUTLINE} onClick={onDownloadReport}>Settings report (.md)</button></Tooltip>
              <Tooltip text="The same settings as data, for a script or a spreadsheet."><button className={SMALL_BTN} style={OUTLINE} onClick={onDownloadJson}>Settings (.json)</button></Tooltip>
            </div>
            <div className="flex flex-wrap gap-2">
              <Tooltip text="Load this page into the editor, with these style files, so you can restyle it."><button className={SMALL_BTN} style={OUTLINE} onClick={() => onUseInEditor(result.url, result.rendered)}>Restyle this page</button></Tooltip>
              <Tooltip text="Add the page's most-used colours as brand colours, to use in the editor."><button className={SMALL_BTN} style={OUTLINE} disabled={!s.colors.length} onClick={onAddBrand}>Use its colours as brand colours</button></Tooltip>
            </div>
          </div>

          {result.flags.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {result.flags.map((flag, i) => <li key={i} className="text-xs rounded-md p-1.5 pl-2" style={{ background: '#fdf3ea', borderLeft: '3px solid #d99a3f', color: '#5a4322' }}>{flag}</li>)}
            </ul>
          )}

          <div className="space-y-1">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Style files</h3>
            {result.files.length === 0 && <p className="text-xs" style={MUTED}>None found.</p>}
            <ul className="flex flex-col gap-1.5">
              {result.files.map((f, i) => (
                <li key={`${f.filename}-${i}`} className="rounded-lg border px-2.5 py-2 text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                  <p className="font-semibold break-words" style={{ color: 'var(--color-text)' }}>{f.filename}</p>
                  <p style={MUTED}>{sourceLabel(f.source)}{f.importedBy ? ` (${f.importedBy})` : ''}{f.media ? ` · for ${f.media}` : ''} · {sizeLabel(f.bytes)}</p>
                  {f.url && <p className="break-all" style={MUTED}>{f.url}</p>}
                  <div className="flex gap-2 mt-1.5">
                    <button className={SMALL_BTN} style={OUTLINE} onClick={() => onCopyFile(f)}>Copy</button>
                    <button className={SMALL_BTN} style={OUTLINE} onClick={() => onDownloadFile(f, i)}>Download .css</button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Design settings</h3>
            <SettingsSection title="Colours" items={s.colors}>{(c) => (<><span className="shrink-0 w-4 h-4 rounded border" style={{ background: c.value, borderColor: 'var(--color-border)' }} /><code className="break-all">{c.value}</code><Count n={c.count} /></>)}</SettingsSection>
            <SettingsSection title="Fonts" items={s.fontFamilies}>{(f) => (<><code className="break-words min-w-0">{f.value}</code><Count n={f.count} /></>)}</SettingsSection>
            <SettingsSection title="Font files" items={s.fontFaces}>{(f) => <span className="min-w-0 break-words">{f.family}{f.weight ? ` ${f.weight}` : ''}{f.sources[0] ? ` · ${f.sources[0]}` : ''}</span>}</SettingsSection>
            <SettingsSection title="Text sizes" items={s.fontSizes}>{(v) => (<><code>{v.value}</code><Count n={v.count} /></>)}</SettingsSection>
            <SettingsSection title="Font weights" items={s.fontWeights}>{(v) => (<><code>{v.value}</code><Count n={v.count} /></>)}</SettingsSection>
            <SettingsSection title="Line spacing" items={s.lineHeights}>{(v) => (<><code>{v.value}</code><Count n={v.count} /></>)}</SettingsSection>
            <SettingsSection title="Spacing" items={s.spacing}>{(v) => (<><code>{v.value}</code><Count n={v.count} /></>)}</SettingsSection>
            <SettingsSection title="Rounded corners" items={s.radii}>{(v) => (<><code>{v.value}</code><Count n={v.count} /></>)}</SettingsSection>
            <SettingsSection title="Shadows" items={s.shadows}>{(v) => (<><code className="break-words min-w-0">{v.value}</code><Count n={v.count} /></>)}</SettingsSection>
            <SettingsSection title="Variables" items={s.variables}>{(v) => (<><code className="break-all">{v.name}</code><span className="min-w-0 break-all" style={MUTED}>{v.value}</span><Count n={v.uses} /></>)}</SettingsSection>
            <SettingsSection title="Screen-size breakpoints" items={s.breakpoints}>{(v) => (<><code>{v.value}</code><Count n={v.count} /></>)}</SettingsSection>
            <SettingsSection title="Animations" items={s.keyframes}>{(v) => <code>{v.value}</code>}</SettingsSection>
          </div>
        </div>
      )}
    </section>
  );
}
