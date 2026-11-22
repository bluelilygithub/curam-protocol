import React, { useEffect, useRef, useState } from 'react';
import api from '../../../utils/apiClient';
import Tooltip from '../../../components/Tooltip';
import { VoiceInput } from '../../../components/voiceInput/VoiceInput';
import PresentationPreview from '../PresentationPreview';
import {
  BUILTIN_THEMES, CARD_STYLE, FIELD_STYLE, Notice, ToolHeader, readJson, usePresentations,
} from '../shared';

const nameOf = (t) => (typeof t === 'string' ? t : (t?.id || t?.themeId || t?.name || 'paper'));

export default function Themes() {
  const {
    deck, themeId, chooseTheme, applyBrand, setApplyBrand, meta, toast,
  } = usePresentations();
  const [catalog, setCatalog] = useState({ builtins: [], themes: [], max: null });
  const [name, setName] = useState('');
  const [background, setBackground] = useState('#ffffff');
  const [textColor, setTextColor] = useState('#1f2937');
  const [accent, setAccent] = useState('#9B5B46');
  const [font, setFont] = useState('');
  const [titleSize, setTitleSize] = useState(40);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const fileRef = useRef(null);

  const refresh = async () => {
    const res = await api.get('/api/presentations/templates');
    const data = await readJson(res, 'Could not load themes.');
    setCatalog({
      builtins: (data.builtins || []).map(nameOf),
      // A saved row carries both a database id (for delete) and the theme id (for use on a deck).
      themes: (data.themes || []).map((r) => ({
        ...r,
        id: r.theme?.id || String(r.id),
        label: r.name || r.theme?.label || 'My theme',
        rowId: r.id,
      })),
      max: data.max,
    });
    return data;
  };
  useEffect(() => { refresh().catch(() => {}); }, []);

  const save = async () => {
    if (!name.trim()) { toast('Give the theme a name first.', 'error'); return; }
    setBusy(true);
    try {
      const res = await api.post('/api/presentations/templates', {
        name: name.trim(),
        theme: {
          label: name.trim(), bg: background, text: textColor, primary: accent,
          muted: textColor, font: font.trim() || 'Arial, sans-serif',
          titleSize: Number(titleSize) || 40, showLogo: false,
        },
      });
      await readJson(res, 'Could not save the theme.');
      setName('');
      await refresh();
      toast('Theme saved.', 'success');
    } catch (err) {
      toast(err.message || 'Could not save the theme.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const importTheme = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.postForm('/api/presentations/templates/import', fd);
      const data = await readJson(res, 'Could not import that theme.');
      const id = nameOf(data.theme);
      if (id) chooseTheme(id);
      setFile(null);
      await refresh();
      toast('PowerPoint theme colours and fonts imported.', 'success');
    } catch (err) {
      toast(err.message || 'Could not import that theme.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    const row = catalog.themes.find((t) => nameOf(t) === id);
    const rowId = row?.rowId || id;
    setBusy(true);
    try {
      await api.delete(`/api/presentations/templates/${encodeURIComponent(rowId)}`);
      if (themeId === id) chooseTheme(BUILTIN_THEMES[0]);
      setConfirmDelete(null);
      await refresh();
      toast('Theme deleted (it stays in the recycle bin for 30 days).', 'success');
    } catch (err) {
      toast(err.message || 'Could not delete the theme.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const builtins = catalog.builtins.length ? catalog.builtins : BUILTIN_THEMES;

  return (
    <section className="space-y-4">
      <ToolHeader id="templates" title="Themes" blurb="The theme sets colours, font and title size. Your Brand Kit can be laid over the top." />
      <div className="grid xl:grid-cols-2 xl:items-start gap-4">
        <div className="rounded-2xl border p-4 space-y-4" style={CARD_STYLE}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Built-in themes</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {builtins.map((id) => (
              <Tooltip key={id} text={`Use the ${id} theme for the current deck.`}>
                <button
                  type="button"
                  onClick={() => chooseTheme(id)}
                  className="rounded-xl border p-2 text-left text-xs hover:opacity-70 transition-opacity"
                  style={{ ...FIELD_STYLE, borderColor: themeId === id ? 'var(--color-primary)' : 'var(--color-border)' }}
                >
                  <span className="block h-3 rounded mb-1.5" style={{ background: 'var(--color-primary)' }} />
                  {id}
                </button>
              </Tooltip>
            ))}
          </div>

          <div className="border-t pt-4 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Saved themes</h3>
            {catalog.themes.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No saved themes yet — make one below.</p>}
            {catalog.themes.map((t) => {
              const id = nameOf(t);
              return (
                <div key={id} className="rounded-xl border p-2 flex flex-wrap items-center gap-2" style={FIELD_STYLE}>
                  <span className="flex-1 min-w-[8rem] text-xs" style={{ color: 'var(--color-text)' }}>{t.label || t.name || id}</span>
                  <Tooltip text="Use this theme for the current deck.">
                    <button type="button" onClick={() => chooseTheme(id)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Use</button>
                  </Tooltip>
                  {confirmDelete === id ? (
                    <>
                      <button type="button" onClick={() => remove(id)} className="text-xs px-2 py-1 rounded-lg" style={{ color: '#991b1b' }}>Delete</button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="text-xs px-2 py-1 rounded-lg" style={{ color: 'var(--color-muted)' }}>Cancel</button>
                    </>
                  ) : (
                    <Tooltip text="Delete this saved theme (it goes to the recycle bin).">
                      <button type="button" onClick={() => setConfirmDelete(id)} className="text-xs px-2 py-1 rounded-lg hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Delete</button>
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>

          <div className="border-t pt-4 space-y-3" style={{ borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Save your own theme</h3>
            <Tooltip text="A short name to find this theme again.">
              <VoiceInput value={name} onChange={setName} label="Theme name" placeholder="e.g. Client blue" />
            </Tooltip>
            <div className="grid grid-cols-3 gap-2">
              {[['Background', background, setBackground], ['Text', textColor, setTextColor], ['Accent', accent, setAccent]].map(([label, value, set]) => (
                <label key={label} className="block space-y-1">
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
                  <Tooltip text={`Choose the ${label.toLowerCase()} colour for this theme.`}>
                    <input type="color" value={value} onChange={(e) => set(e.target.value)} className="w-full h-9 rounded-xl border cursor-pointer" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }} />
                  </Tooltip>
                </label>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Font family</span>
                <Tooltip text="A font name such as Inter or Georgia. It must be available when the deck renders.">
                  <VoiceInput value={font} onChange={setFont} label="Font family" placeholder="e.g. Inter" />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Title size (px)</span>
                <Tooltip text="How large slide titles render in this theme.">
                  <input type="number" min={20} max={96} value={titleSize} onChange={(e) => setTitleSize(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={FIELD_STYLE} />
                </Tooltip>
              </label>
            </div>
            <Tooltip text="Save these colours and fonts as a theme you can reuse.">
              <button type="button" onClick={save} disabled={busy || !name.trim()} className="px-4 py-2 rounded-xl text-sm font-medium hover:opacity-80 disabled:opacity-40 transition-opacity" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>Save theme</button>
            </Tooltip>
          </div>

          <div className="border-t pt-4 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Or import a PowerPoint theme</h3>
            <Tooltip text="A .pptx or .potx file. Only its colours, fonts and layout hints are read — PowerPoint masters are not reproduced.">
              <input ref={fileRef} type="file" accept=".pptx,.potx" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </Tooltip>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text="Choose a .pptx or .potx theme file.">
                <button type="button" onClick={() => fileRef.current?.click()} className="px-3 py-2 rounded-xl text-xs font-medium border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>{file ? 'Change file' : 'Choose theme file'}</button>
              </Tooltip>
              {file && <span className="text-xs truncate max-w-[12rem]" style={{ color: 'var(--color-muted)' }}>{file.name}</span>}
              <Tooltip text="Read colours and fonts from the chosen file and save them as a theme.">
                <button type="button" onClick={importTheme} disabled={busy || !file} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Import</button>
              </Tooltip>
            </div>
          </div>

          <Tooltip text={meta?.brandKit?.available ? `Apply ${meta.brandKit.label || 'your Brand Kit'} over the selected theme.` : 'No saved Brand Kit yet — set one up in Graphics first.'}>
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={applyBrand} onChange={(e) => setApplyBrand(e.target.checked)} />
              Apply Brand Kit over the theme
            </label>
          </Tooltip>
          {applyBrand && !meta?.brandKit?.available && <Notice tone="warn">No saved Brand Kit was found, so this override will have no effect.</Notice>}
        </div>

        <div className="rounded-2xl border p-4 space-y-3" style={CARD_STYLE}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Current deck preview</h3>
          {deck.slides.length ? <PresentationPreview deck={{ ...deck, themeId }} /> : <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Make a deck first to see the themes applied to it.</p>}
        </div>
      </div>
    </section>
  );
}
