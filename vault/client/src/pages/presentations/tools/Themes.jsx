import React, { useEffect, useRef, useState } from 'react';
import api from '../../../utils/apiClient';
import EmptyState from '../../../components/EmptyState';
import Tooltip from '../../../components/Tooltip';
import { VoiceInput } from '../../../components/voiceInput/VoiceInput';
import PresentationPreview from '../PresentationPreview';
import DesignGallery from '../DesignGallery';
import {
  BUILTIN_THEMES, BTN_PRIMARY, BTN_SECONDARY, CARD, CARD_STYLE, FIELD_STYLE, PRIMARY_STYLE, SECONDARY_STYLE,
  InlineDelete, Notice, ToolHeader, readJson, themeOptions, usePresentations,
} from '../shared';

/** A small picture of a theme: its background, a title bar in its text colour and an accent stripe. */
function Swatch({ theme }) {
  if (!theme.bg) return <span className="block h-8 rounded-md mb-1.5" style={{ background: 'var(--color-border)' }} aria-hidden="true" />;
  return (
    <span className="block h-8 rounded-md mb-1.5 border p-1.5 space-y-1" style={{ background: theme.bg, borderColor: 'var(--color-border)' }} aria-hidden="true">
      <span className="block h-1.5 w-2/3 rounded-sm" style={{ background: theme.text }} />
      <span className="block h-1.5 w-1/3 rounded-sm" style={{ background: theme.primary }} />
    </span>
  );
}

export default function Themes() {
  const {
    deck, themeId, chooseTheme, chooseDesign, applyBrand, setApplyBrand, meta, toast,
  } = usePresentations();
  const [catalog, setCatalog] = useState({ builtins: themeOptions(BUILTIN_THEMES), themes: [], max: null });
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
      builtins: themeOptions(data.builtins?.length ? data.builtins : BUILTIN_THEMES),
      themes: themeOptions(data.themes || []),
      max: data.max,
    });
    return data;
  };
  useEffect(() => { refresh().catch((err) => toast(err.message || 'Could not load themes.', 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      const [imported] = themeOptions([data.theme].filter(Boolean));
      if (imported) chooseTheme(imported.id);
      setFile(null);
      await refresh();
      toast('PowerPoint theme colours and fonts imported.', 'success');
    } catch (err) {
      toast(err.message || 'Could not import that theme.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (theme) => {
    setBusy(true);
    try {
      await readJson(await api.delete(`/api/presentations/templates/${encodeURIComponent(theme.rowId || theme.id)}`), 'Could not delete the theme.');
      if (themeId === theme.id) chooseTheme(BUILTIN_THEMES[0]);
      setConfirmDelete(null);
      await refresh();
      toast('Theme deleted (it stays in the recycle bin for 30 days).', 'success');
    } catch (err) {
      toast(err.message || 'Could not delete the theme.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // The gallery draws its samples in the colours of the theme in use, so design and colours can be judged together.
  const current = [...catalog.builtins, ...catalog.themes].find((t) => t.id === themeId) || catalog.builtins[0] || {};
  const colours = {
    bg: current.bg || '#ffffff', text: current.text || '#1f2937', primary: current.primary || '#9B5B46', muted: current.muted || '#6b7280',
  };

  return (
    <section className="space-y-4">
      <ToolHeader id="templates" title="Themes" />
      <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-4">
        <div className="space-y-4">
          <div className={CARD} style={CARD_STYLE}>
            <div className="space-y-1">
              <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Design</h3>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>How every slide is laid out and decorated: bands, panels, frames and accents. Works with any colour theme below.</p>
            </div>
            {meta?.designs?.length
              ? <DesignGallery designs={meta.designs} designId={deck.designId || 'clean'} colours={colours} onPick={chooseDesign} />
              : <p className="text-sm" style={{ color: 'var(--color-muted)' }}>The designs could not be loaded. Refresh the page to try again.</p>}
          </div>

          <div className={CARD} style={CARD_STYLE}>
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Colour themes</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {catalog.builtins.map((t) => (
                <Tooltip key={t.id} text={`Use the ${t.label} theme for the current deck.`}>
                  <button
                    type="button"
                    onClick={() => chooseTheme(t.id)}
                    aria-pressed={themeId === t.id}
                    className="w-full rounded-xl border p-2 text-left text-xs transition-opacity duration-200 hover:opacity-70"
                    style={{ ...FIELD_STYLE, borderColor: themeId === t.id ? 'var(--color-primary)' : 'var(--color-border)', borderWidth: themeId === t.id ? 2 : 1 }}
                  >
                    <Swatch theme={t} />
                    {t.label}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>

          <div className={CARD} style={CARD_STYLE}>
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Saved themes{catalog.max == null ? '' : ` (${catalog.themes.length} of ${catalog.max})`}</h3>
            {catalog.themes.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No saved themes yet. Make one below, or import one from PowerPoint.</p>
            ) : (
              <div className="space-y-2">
                {catalog.themes.map((t) => (
                  <div key={t.rowId || t.id} className="rounded-xl border p-3 flex flex-wrap items-center gap-2" style={{ ...FIELD_STYLE, borderColor: themeId === t.id ? 'var(--color-primary)' : 'var(--color-border)' }}>
                    <span className="w-10 shrink-0"><Swatch theme={t} /></span>
                    <span className="flex-1 min-w-[8rem] text-sm" style={{ color: 'var(--color-text)' }}>{t.label}</span>
                    <Tooltip text="Use this theme for the current deck.">
                      <button type="button" onClick={() => chooseTheme(t.id)} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>Use</button>
                    </Tooltip>
                    <InlineDelete
                      pending={confirmDelete === t.id}
                      onAsk={() => setConfirmDelete(t.id)}
                      onConfirm={() => remove(t)}
                      onCancel={() => setConfirmDelete(null)}
                      what={`the ${t.label} theme`}
                      disabled={busy}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={CARD} style={CARD_STYLE}>
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Save your own theme</h3>
            <Tooltip text="A short name to find this theme again.">
              <VoiceInput value={name} onChange={setName} label="Theme name" placeholder="e.g. Client blue" />
            </Tooltip>
            <div className="grid grid-cols-3 gap-2">
              {[['Background', background, setBackground], ['Text', textColor, setTextColor], ['Accent', accent, setAccent]].map(([label, value, set]) => (
                <label key={label} className="block space-y-1">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</span>
                  <Tooltip text={`Choose the ${label.toLowerCase()} colour for this theme.`}>
                    <input type="color" value={value} onChange={(e) => set(e.target.value)} aria-label={`${label} colour`} className="w-full h-10 rounded-xl border cursor-pointer" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }} />
                  </Tooltip>
                </label>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Font family</span>
                <Tooltip text="A font name such as Inter or Georgia. It must be available when the deck renders.">
                  <VoiceInput value={font} onChange={setFont} label="Font family" placeholder="e.g. Inter" />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Title size (px)</span>
                <Tooltip text="How large slide titles render in this theme, from 20 to 96.">
                  <input type="number" min={20} max={96} value={titleSize} onChange={(e) => setTitleSize(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border text-sm focus:border-[var(--color-primary)]" style={FIELD_STYLE} />
                </Tooltip>
              </label>
            </div>
            <Tooltip text="Save these colours and fonts as a theme you can reuse.">
              <button type="button" onClick={save} disabled={busy || !name.trim()} className={BTN_PRIMARY} style={PRIMARY_STYLE}>Save theme</button>
            </Tooltip>

            <div className="border-t pt-4 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Or import a PowerPoint theme</h3>
              <input ref={fileRef} type="file" accept=".pptx,.potx" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip text="Choose a .pptx or .potx file. Only its colours and fonts are read; PowerPoint masters are not reproduced.">
                  <button type="button" onClick={() => fileRef.current?.click()} className={BTN_SECONDARY} style={SECONDARY_STYLE}>{file ? 'Change file' : 'Choose theme file'}</button>
                </Tooltip>
                {file && <span className="text-xs truncate max-w-[12rem]" style={{ color: 'var(--color-muted)' }}>{file.name}</span>}
                <Tooltip text="Read colours and fonts from the chosen file and save them as a theme.">
                  <button type="button" onClick={importTheme} disabled={busy || !file} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>Import</button>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>

        <div className={`${CARD} xl:sticky xl:top-4`} style={CARD_STYLE}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Current deck preview</h3>
            <Tooltip text={meta?.brandKit?.available ? `Apply ${meta.brandKit.label || 'your Brand Kit'} over the selected theme.` : 'No saved Brand Kit yet. Set one up in Graphics first.'}>
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={applyBrand} onChange={(e) => setApplyBrand(e.target.checked)} />
                Apply Brand Kit over the theme
              </label>
            </Tooltip>
          </div>
          {applyBrand && !meta?.brandKit?.available && <Notice tone="warn">No saved Brand Kit was found, so this override will have no effect.</Notice>}
          {deck.slides.length
            ? <PresentationPreview deck={{ ...deck, themeId }} />
            : <EmptyState icon="palette" title="No deck to preview yet" body="Make or open a deck and the theme you pick is shown on it here." />}
        </div>
      </div>
    </section>
  );
}
