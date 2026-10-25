import { useIcon } from '../../../providers/IconProvider';
import React, { useEffect, useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { readFileAsDataUrl, useProcessingWhile, CostNote } from '../shared';

const MAX_FILES = 10;
const ALT_MAX = 125; // the length screen readers and SEO guides recommend; matches the server

const escapeAttr = (t) => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const extOf = (name, dataUrl) => (name?.match(/\.([a-z0-9]{2,5})$/i)?.[1] || dataUrl.match(/^data:image\/([a-z0-9]+)/i)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');

export default function AltTextTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();

  const [items, setItems] = useState([]); // { id, name, ext, dataUrl, status: idle|working|done|error, alt, filename, decorative, error }
  const [context, setContext] = useState('');
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState('');
  // Who would receive the pictures (from the workspace's Settings), so the notice can name them before anything is sent.
  const [provider, setProvider] = useState(undefined); // undefined = checking, null = no model that can look at pictures
  useEffect(() => {
    let off = false;
    api.get('/api/graphics/describe/info')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!off) setProvider(d ? (d.available ? d.provider : null) : undefined); })
      .catch(() => { if (!off) setProvider(undefined); });
    return () => { off = true; };
  }, []);

  const patch = (id, p) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/')).slice(0, MAX_FILES - items.length);
    const added = [];
    for (const f of files) {
      try {
        const dataUrl = await readFileAsDataUrl(f); // eslint-disable-line no-await-in-loop
        added.push({ id: `a${Date.now()}${Math.random().toString(36).slice(2, 6)}`, name: f.name, ext: extOf(f.name, dataUrl), dataUrl, status: 'idle', alt: '', filename: '', decorative: false, error: '' });
      } catch { /* an unreadable file is simply skipped */ }
    }
    setItems((prev) => [...prev, ...added].slice(0, MAX_FILES));
  };

  const pending = items.filter((it) => it.status === 'idle' || it.status === 'error');

  // One picture at a time: the server allows two AI jobs at once per person, and a failure on one should not stop the others.
  const suggestAll = async () => {
    if (!pending.length) return;
    setRunning(true);
    for (const it of pending) {
      patch(it.id, { status: 'working', error: '' });
      try {
        const res = await api.post('/api/graphics/describe', { imageDataUrl: it.dataUrl, context }); // eslint-disable-line no-await-in-loop
        const data = await res.json(); // eslint-disable-line no-await-in-loop
        if (!res.ok) throw new Error(data.error || 'Could not describe this picture');
        patch(it.id, { status: 'done', alt: data.alt || '', filename: data.filename || '', decorative: Boolean(data.decorative) });
      } catch (err) {
        patch(it.id, { status: 'error', error: err.message || 'Could not describe this picture' });
      }
    }
    setRunning(false);
  };

  const copy = async (key, text) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1500); } catch { /* clipboard blocked */ }
  };

  const fileName = (it) => `${it.filename || 'image'}.${it.ext}`;
  const imgTag = (it) => `<img src="${escapeAttr(fileName(it))}" alt="${escapeAttr(it.decorative ? '' : it.alt)}">`;
  const download = (it) => {
    const a = document.createElement('a');
    a.href = it.dataUrl;
    a.download = fileName(it);
    a.click();
  };
  const downloadAll = () => items.filter((it) => it.status === 'done').forEach((it, i) => setTimeout(() => download(it), i * 150));
  const copyAllTable = () => copy('all', ['file\talt text', ...items.filter((it) => it.status === 'done').map((it) => `${fileName(it)}\t${it.decorative ? '' : it.alt}`)].join('\n'));

  useProcessingWhile(running ? 'Describing pictures…' : null);

  const inputStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
  const linkBtn = 'text-xs hover:opacity-60';

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Alt text &amp; names</h2>
            <button type="button" onClick={() => setHelpTool('alttext')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Uses AI · counts towards your daily limit</span>
        </div>

        <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Alt text is the short description a screen reader speaks and search engines read. This suggests it, and a file name that says what the picture shows. Always read and edit the suggestions before you use them.
          </p>
          <p className="text-xs rounded-lg px-3 py-2" style={{ color: 'var(--color-muted)', background: 'var(--color-bg)' }}>
            {provider === null
              ? <>No AI model that can look at pictures is set up for this workspace yet, so Suggest will not work. Ask your admin to add a Claude or Gemini model in Settings.</>
              : <>Nothing is sent until you press <strong>Suggest</strong>. Then a reduced copy of each picture (not the original file) is sent on through Vault to <strong>{provider || 'the AI service'}</strong>. That is outside this browser, unlike most Graphics tools.</>}
          </p>

          <div className="space-y-2">
            <label className="block text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Pictures (up to {MAX_FILES})</label>
            <Tooltip text="Choose the pictures you want alt text and file names for."><input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
              className="block w-full text-xs"
              style={{ color: 'var(--color-text)' }}
            /></Tooltip>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Where will they be used? (optional)</label>
            <Tooltip text="A few words about the page, for example 'kitchen renovation gallery'. It helps the suggestions fit, but the picture is what is described."><input
              type="text"
              value={context}
              maxLength={300}
              onChange={(e) => setContext(e.target.value)}
              placeholder="e.g. kitchen renovation gallery on a builder's website"
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={inputStyle}
            /></Tooltip>
          </div>

          <CostNote tool="describe" runs={Math.max(1, pending.length)} refreshKey={running} />
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip text="Ask the AI to suggest alt text and a file name for each picture that does not have one yet."><button
              type="button"
              onClick={suggestAll}
              disabled={running || !pending.length || provider === null}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: 'var(--color-primary)' }}
            >
              {running ? getIcon('loader', { size: 15, className: 'animate-spin' }) : getIcon('sparkles', { size: 15 })}
              {running ? 'Describing…' : `Suggest for ${pending.length || 'these'} picture${pending.length === 1 ? '' : 's'}`}
            </button></Tooltip>
            {items.some((it) => it.status === 'done') && (
              <>
                <Tooltip text="Download every picture that has a name, saved under its new file name."><button type="button" onClick={downloadAll} className="px-3 py-2 rounded-xl text-sm border hover:opacity-80" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Download all renamed</button></Tooltip>
                <Tooltip text="Copy a two-column list (file name, alt text) you can paste into a spreadsheet."><button type="button" onClick={copyAllTable} className="px-3 py-2 rounded-xl text-sm border hover:opacity-80" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>{copied === 'all' ? 'Copied ✓' : 'Copy as list'}</button></Tooltip>
              </>
            )}
            {items.length > 0 && !running && (
              <Tooltip text="Remove all the pictures from this tool."><button type="button" onClick={() => setItems([])} className={linkBtn} style={{ color: '#ef4444' }}>Clear</button></Tooltip>
            )}
          </div>
        </div>

        {items.length > 0 && (
          <ul className="mt-4 space-y-3">
            {items.map((it) => (
              <li key={it.id} className="flex gap-3 rounded-2xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <img src={it.dataUrl} alt="" className="w-24 h-24 object-cover rounded-lg border flex-none" style={{ borderColor: 'var(--color-border)' }} />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs truncate flex-1" style={{ color: 'var(--color-muted)' }}>{it.name}</p>
                    {it.status === 'working' && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Describing…</span>}
                    <Tooltip text="Remove this picture."><button type="button" onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))} disabled={running} className={`${linkBtn} disabled:opacity-40`} style={{ color: '#ef4444' }}>Remove</button></Tooltip>
                  </div>
                  {it.status === 'error' && <p className="text-xs px-2 py-1 rounded-lg" style={{ color: '#991b1b', background: '#fee2e2' }}>{it.error}</p>}
                  {it.status === 'done' && (
                    <>
                      {it.decorative && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>The AI thinks this is decoration only, so it should have empty alt text (alt=""). Untick below if it matters to the page.</p>}
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Alt text</label>
                          <span className="text-[11px]" style={{ color: it.alt.length > ALT_MAX ? '#f59e0b' : 'var(--color-muted)' }}>{it.alt.length}/{ALT_MAX}</span>
                        </div>
                        <Tooltip text="The description for screen readers and search engines. Edit it until it is right; about 125 characters or fewer reads best."><textarea
                          value={it.decorative ? '' : it.alt}
                          disabled={it.decorative}
                          rows={2}
                          onChange={(e) => patch(it.id, { alt: e.target.value })}
                          className="w-full px-2 py-1.5 rounded-lg border text-sm"
                          style={inputStyle}
                        /></Tooltip>
                        <label className="mt-1 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                          <Tooltip text="Tick if the picture is only decoration, so a screen reader skips it."><input type="checkbox" checked={it.decorative} onChange={(e) => patch(it.id, { decorative: e.target.checked })} /></Tooltip>
                          Decoration only (empty alt text)
                        </label>
                      </div>
                      <div>
                        <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>File name</label>
                        <div className="flex items-center gap-1">
                          <Tooltip text="Lowercase words with hyphens read best for search engines and links. Letters, numbers and hyphens only."><input
                            type="text"
                            value={it.filename}
                            onChange={(e) => patch(it.id, { filename: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60) })}
                            className="flex-1 px-2 py-1.5 rounded-lg border text-sm"
                            style={inputStyle}
                          /></Tooltip>
                          <span className="text-sm" style={{ color: 'var(--color-muted)' }}>.{it.ext}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Tooltip text="Copy the alt text."><button type="button" onClick={() => copy(`${it.id}-alt`, it.decorative ? '' : it.alt)} className={linkBtn} style={{ color: 'var(--color-primary)' }}>{copied === `${it.id}-alt` ? 'Copied ✓' : 'Copy alt'}</button></Tooltip>
                        <Tooltip text="Copy the new file name."><button type="button" onClick={() => copy(`${it.id}-name`, fileName(it))} className={linkBtn} style={{ color: 'var(--color-primary)' }}>{copied === `${it.id}-name` ? 'Copied ✓' : 'Copy file name'}</button></Tooltip>
                        <Tooltip text="Copy a ready-made <img> tag with the new file name and the alt text filled in."><button type="button" onClick={() => copy(`${it.id}-tag`, imgTag(it))} className={linkBtn} style={{ color: 'var(--color-primary)' }}>{copied === `${it.id}-tag` ? 'Copied ✓' : 'Copy <img> tag'}</button></Tooltip>
                        <Tooltip text="Save this picture to your device under its new file name."><button type="button" onClick={() => download(it)} className={linkBtn} style={{ color: 'var(--color-primary)' }}>Download renamed</button></Tooltip>
                      </div>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
