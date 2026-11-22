import React, { useEffect, useState } from 'react';
import api from '../../../utils/apiClient';
import { getModelShortName } from '../../../utils/models';
import Tooltip from '../../../components/Tooltip';
import { VoiceInput } from '../../../components/voiceInput/VoiceInput';
import {
  ASPECTS, BUILTIN_THEMES, BTN_PRIMARY, BTN_QUIET, CARD, CARD_STYLE, FIELD_STYLE, PRIMARY_STYLE, ROW, SELECT,
  Notice, ToolHeader, readJson, themeOptions, usePresentations,
} from '../shared';

export default function CreateDeck() {
  const {
    deck, setDeck, sourceText, setSourceText, imageRefs, setImageRefs, themeId, chooseTheme, chooseDesign, applyBrand, setApplyBrand,
    meta, startJob, openTool, toast, defaultModel,
  } = usePresentations();
  const [brief, setBrief] = useState('');
  const [themes, setThemes] = useState(() => themeOptions(BUILTIN_THEMES));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/presentations/templates')
      .then((r) => readJson(r, 'Could not load themes.'))
      .then((d) => setThemes([...themeOptions(d.builtins?.length ? d.builtins : BUILTIN_THEMES), ...themeOptions(d.themes || [])]))
      .catch(() => {});
  }, []);

  const noBrandKit = applyBrand && !meta?.brandKit?.available;
  const submit = async () => {
    if (!brief.trim() && !sourceText.trim()) {
      toast('Write a brief or import some source text first.', 'error');
      return;
    }
    if (noBrandKit) return;
    setBusy(true);
    try {
      await startJob('create', '/api/presentations/create', {
        brief,
        sourceText,
        imageRefs,
        themeId,
        designId: deck.designId || 'clean',
        aspect: deck.aspect || '16:9',
        applyBrand,
      });
      openTool('slides');
    } catch (err) {
      if (err.message !== 'Cancelled') toast(err.message || 'Could not make the deck.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <ToolHeader id="create" title="Create deck" />
      <div className={CARD} style={CARD_STYLE}>
        <label className="block space-y-1">
          <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Brief</span>
          <Tooltip text="Describe your audience, the point of the deck and what should be on the slides. The more concrete you are, the better the first draft.">
            <VoiceInput type="textarea" rows={6} value={brief} onChange={setBrief} label="Brief" append placeholder="e.g. An 8-slide update for the client: where we are, what we delivered, what is next, and the decision we need." />
          </Tooltip>
        </label>

        {(sourceText || imageRefs.length > 0) && (
          <div className={`${ROW} space-y-2`} style={FIELD_STYLE}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
                Imported source · {sourceText.length} characters · {imageRefs.length} image{imageRefs.length === 1 ? '' : 's'}
              </span>
              <Tooltip text="Forget the imported text and pictures, so the deck is made from the brief alone.">
                <button type="button" onClick={() => { setSourceText(''); setImageRefs([]); }} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>Clear source</button>
              </Tooltip>
            </div>
            {imageRefs.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {imageRefs.slice(0, 8).map((ref, i) => (
                  <img key={`${ref}-${i}`} src={ref} alt={`Source ${i + 1}`} className="h-16 w-20 rounded-lg border object-cover" style={{ borderColor: 'var(--color-border)' }} />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Design</span>
            <Tooltip text="How the slides are laid out and decorated (bands, panels, frames). See them all, with samples, in Themes.">
              <select value={deck.designId || 'clean'} onChange={(e) => chooseDesign(e.target.value)} className={SELECT} style={FIELD_STYLE}>
                {(meta?.designs?.length ? meta.designs : [{ id: 'clean', label: 'Clean' }]).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </Tooltip>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Colour theme</span>
            <Tooltip text="The selected theme sets the colours, font and title size. You can change it later in Themes.">
              <select value={themeId} onChange={(e) => chooseTheme(e.target.value)} className={SELECT} style={FIELD_STYLE}>
                {themes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Tooltip>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Aspect</span>
            <Tooltip text="Wide 16:9 suits a screen or projector; 4:3 suits older rooms; 1:1 suits social feeds.">
              <select value={deck.aspect || '16:9'} onChange={(e) => setDeck((prev) => ({ ...prev, aspect: e.target.value }))} className={SELECT} style={FIELD_STYLE}>
                {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Tooltip>
          </label>
          <div className="flex items-end">
            <Tooltip text={meta?.brandKit?.available ? `Override the theme with ${meta.brandKit.label || 'your Brand Kit'}.` : 'No Brand Kit is saved yet. Set one up in Graphics before ticking this.'}>
              <label className="flex items-center gap-2 text-xs cursor-pointer pb-3" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={applyBrand} onChange={(e) => setApplyBrand(e.target.checked)} />
                Apply Brand Kit
              </label>
            </Tooltip>
          </div>
        </div>

        {noBrandKit && (
          <Notice tone="warn">There is no saved Brand Kit yet, so this job cannot apply one. Add one in Graphics first, or untick the box.</Notice>
        )}

        {defaultModel && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            The outline and slides are written with the workspace default model, {getModelShortName(defaultModel)} (set by an admin in Settings).
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Tooltip text="Start the build in the background. You can cancel it, and edit the deck as soon as it is ready.">
            <button
              type="button"
              onClick={submit}
              disabled={busy || (!brief.trim() && !sourceText.trim()) || noBrandKit}
              className={BTN_PRIMARY}
              style={PRIMARY_STYLE}
            >
              {busy ? 'Starting…' : 'Make deck'}
            </button>
          </Tooltip>
          <Tooltip text="Bring in text and pictures from files or a web page first, then come back here.">
            <button type="button" onClick={() => openTool('import')} className="text-xs underline transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>
              Need text or pictures first? Import source
            </button>
          </Tooltip>
        </div>
      </div>
    </section>
  );
}
