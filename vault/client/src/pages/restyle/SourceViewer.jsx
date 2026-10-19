import React, { useMemo } from 'react';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { sourceLines, MAX_SHOWN_LINES } from './sourceView.mjs';

// The "HTML source" tool: the page's source laid out so it can be read, as it was fetched, as it is in the editor, with your changes
// built in, and the CSS. It fills the space where the preview normally is (the preview stays loaded behind it). Plain words only.

const MUTED = { color: 'var(--color-muted)' };
const OUTLINE = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const SMALL_BTN = 'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-opacity duration-200 hover:opacity-70 disabled:opacity-50';

/**
 * @param {{views: Array<{id:string,label:string,tip:string,available:boolean}>, active:string, onActive:Function, text:string, note?:string,
 *   query:string, onQuery:Function, wrap:boolean, onWrap:Function, onCopy:Function, onDownload:Function, downloadLabel:string, empty?:string}} props
 */
export default function SourceViewer({ views, active, onActive, text, note, query, onQuery, wrap, onWrap, onCopy, onDownload, downloadLabel, empty }) {
  const view = views.find((v) => v.id === active) || views[0];
  const { rows, total, matches, truncated } = useMemo(() => sourceLines(text, { query }), [text, query]);
  const bytes = text ? text.length : 0;
  const segment = (on, first, last) => ({
    padding: '5px 12px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid var(--color-border)',
    background: on ? 'var(--color-primary)' : 'var(--color-bg)', color: on ? '#fff' : 'var(--color-text)',
    borderRadius: first ? '8px 0 0 8px' : last ? '0 8px 8px 0' : 0,
  });
  return (
    <section className="flex-1 min-w-0 flex flex-col gap-2" aria-label="HTML source">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap" role="group" aria-label="Which source">
          {views.map((v, i) => (
            <Tooltip key={v.id} text={v.available ? v.tip : `${v.tip} Not available yet.`}>
              <button type="button" disabled={!v.available} aria-pressed={view.id === v.id} onClick={() => onActive(v.id)} className="transition-opacity duration-200 hover:opacity-70 disabled:opacity-40" style={segment(view.id === v.id, i === 0, i === views.length - 1)}>{v.label}</button>
            </Tooltip>
          ))}
        </div>
        <div className="w-56">
          <Tooltip text="Show only the lines that contain these words. The line numbers stay as in the whole source. You can say it with the microphone.">
            <div><VoiceInput value={query} onChange={onQuery} placeholder="Show only lines containing…" label="Filter the source" className="!py-1.5 !text-xs !rounded-lg" /></div>
          </Tooltip>
        </div>
        <Tooltip text="Wrap long lines so you do not have to scroll sideways.">
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text)' }}>
            <input type="checkbox" checked={wrap} onChange={(e) => onWrap(e.target.checked)} /> Wrap lines
          </label>
        </Tooltip>
        <div className="flex gap-2 ml-auto">
          <button className={SMALL_BTN} style={OUTLINE} disabled={!text} onClick={onCopy}>Copy</button>
          <button className={SMALL_BTN} style={OUTLINE} disabled={!text} onClick={onDownload}>{downloadLabel}</button>
        </div>
      </div>

      <p className="text-xs" style={MUTED}>
        {view.tip} {text ? `${total.toLocaleString()} lines, ${bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`}${query.trim() ? `; ${matches.toLocaleString()} match${matches === 1 ? '' : 'es'}` : ''}.` : ''}
      </p>
      {note && <p className="text-xs rounded-lg border px-3 py-2" style={{ background: '#fffbeb', borderColor: '#fde68a', color: '#b45309' }} role="status">{note}</p>}

      <div className="rounded-xl border overflow-auto flex-1" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', maxHeight: 'calc(100dvh - 17rem)', minHeight: 240 }}>
        {!text ? (
          <p className="p-4 text-sm" style={MUTED}>{empty || 'Nothing to show yet.'}</p>
        ) : (
          <pre className="m-0 py-2 text-xs leading-5" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', color: 'var(--color-text)' }} data-source-view={view.id}>
            {rows.map((r) => (
              <div key={r.number} className="flex">
                <span className="select-none shrink-0 text-right pr-3 pl-2" style={{ width: 56, color: 'var(--color-muted)' }}>{r.number}</span>
                <code className={wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'} style={{ fontFamily: 'inherit' }}>{r.text}</code>
              </div>
            ))}
            {!rows.length && <div className="px-3" style={MUTED}>No line contains “{query}”.</div>}
          </pre>
        )}
      </div>
      {truncated && <p className="text-xs" style={MUTED}>Showing the first {MAX_SHOWN_LINES.toLocaleString()} of {matches.toLocaleString()} lines. Use the filter to find the part you want, or download the whole source.</p>}
    </section>
  );
}
