import React, { useEffect, useState } from 'react';
import api from '../../../utils/apiClient';
import { getModelShortName } from '../../../utils/models';
import Tooltip from '../../../components/Tooltip';
import { VoiceInput } from '../../../components/voiceInput/VoiceInput';
import {
  ASPECTS, BUILTIN_THEMES, CARD_STYLE, FIELD_STYLE, Notice, ToolHeader, readJson, usePresentations,
} from '../shared';

const nameOf = (t) => (typeof t === 'string' ? t : (t?.id || t?.themeId || t?.name || 'paper'));

export default function CreateDeck() {
  const {
    deck, setDeck, sourceText, setSourceText, imageRefs, themeId, chooseTheme, applyBrand, setApplyBrand,
    meta, startJob, openTool, toast, model,
  } = usePresentations();
  const [brief, setBrief] = useState('');
  const [themes, setThemes] = useState(BUILTIN_THEMES);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/presentations/templates')
      .then((r) => readJson(r, 'Could not load themes.'))
      .then((d) => {
        const builtins = (d.builtins || []).map(nameOf);
        const saved = (d.themes || []).map((t) => ({ id: nameOf(t), label: t.name || nameOf(t) }));
        setThemes([...(builtins.length ? builtins : BUILTIN_THEMES), ...saved]);
      })
      .catch(() => {});
  }, []);

  const submit = async () => {
    if (!brief.trim() && !sourceText.trim()) {
      toast('Write a brief or import some source text first.', 'error');
      return;
    }
    if (applyBrand && !meta?.brandKit?.available) return;
    setBusy(true);
    try {
      await startJob('create', '/api/presentations/create', {
        brief,
        sourceText,
        imageRefs,
        themeId,
        aspect: deck.aspect || '16:9',
        applyBrand,
        model,
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
      <ToolHeader id="create" title="Create deck" blurb="A brief in plain words is enough. Add imported text or pictures if you have them." />
      <div className="rounded-2xl border p-4 space-y-4" style={CARD_STYLE}>
        <label className="block space-y-1">
          <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Brief</span>
          <Tooltip text="Describe your audience, the point of the deck and what should be on the slides. The more concrete you are, the better the first draft.">
            <VoiceInput type="textarea" rows={6} value={brief} onChange={setBrief} label="Brief" append placeholder="e.g. A 8-slide update for the client: where we are, what we delivered, what is next, and the decision we need." />
          </Tooltip>
        </label>

        {(sourceText || imageRefs.length > 0) && (
          <div className="rounded-xl border p-3 space-y-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
                Imported source · {sourceText.length} characters · {imageRefs.length} image{imageRefs.length === 1 ? '' : 's'}
              </span>
              <Tooltip text="Forget the imported text and pictures, so the deck is made from the brief alone.">
                <button type="button" onClick={() => { setSourceText(''); setImageRefs([]); }} className="text-xs hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Clear source</button>
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

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Theme</span>
            <Tooltip text="The selected theme sets the colours, font and title size. You can change it later in Themes.">
              <select value={themeId} onChange={(e) => chooseTheme(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm" style={FIELD_STYLE}>
                {themes.map((t) => {
                  const id = nameOf(t);
                  return <option key={id} value={id}>{typeof t === 'string' ? t : (t.label || id)}</option>;
                })}
              </select>
            </Tooltip>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Aspect</span>
            <Tooltip text="Wide 16:9 suits a screen or projector; 4:3 suits older rooms; 1:1 suits social feeds.">
              <select value={deck.aspect || '16:9'} onChange={(e) => setDeck((prev) => ({ ...prev, aspect: e.target.value }))} className="w-full px-3 py-2 rounded-xl border text-sm" style={FIELD_STYLE}>
                {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Tooltip>
          </label>
          <div className="flex items-end">
            <Tooltip text={meta?.brandKit?.available ? `Override the theme with ${meta.brandKit.label || 'your Brand Kit'}.` : 'No Brand Kit is saved yet. Set one up in Graphics before ticking this.'}>
              <label className="flex items-center gap-2 text-xs cursor-pointer pb-2" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={applyBrand} onChange={(e) => setApplyBrand(e.target.checked)} />
                Apply Brand Kit
              </label>
            </Tooltip>
          </div>
        </div>

        {applyBrand && !meta?.brandKit?.available && (
          <Notice tone="warn">There is no saved Brand Kit yet, so this job cannot apply one. Add one in Graphics first, or untick the box.</Notice>
        )}

        {model && (
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
            Slides will be written with {getModelShortName(model)}. The outline still uses the workspace light model.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Tooltip text="Start the build in the background. You can cancel it, and edit the deck as soon as it is ready.">
            <button
              type="button"
              onClick={submit}
              disabled={busy || (!brief.trim() && !sourceText.trim()) || (applyBrand && !meta?.brandKit?.available)}
              className="px-4 py-2 rounded-xl text-sm font-medium hover:opacity-80 disabled:opacity-40 transition-opacity"
              style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}
            >
              {busy ? 'Starting…' : 'Make deck'}
            </button>
          </Tooltip>
          <button type="button" onClick={() => openTool('import')} className="text-xs underline hover:opacity-60" style={{ color: 'var(--color-primary)' }}>
            Need text or pictures first? Import source
          </button>
        </div>
      </div>
    </section>
  );
}
