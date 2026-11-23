import React, { useEffect, useState } from 'react';
import api from '../../../utils/apiClient';
import { getModelShortName } from '../../../utils/models';
import Tooltip from '../../../components/Tooltip';
import { VoiceInput } from '../../../components/voiceInput/VoiceInput';
import { useIcon } from '../../../providers/IconProvider';
import { parseLines } from '../lines.mjs';
import {
  ASPECTS, BUILTIN_THEMES, BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, CARD, CARD_STYLE, FIELD_STYLE, LAYOUTS, LAYOUT_LABELS, PRIMARY_STYLE, ROW, SECONDARY_STYLE, SELECT,
  Notice, PresentationImage, ToolHeader, readJson, themeOptions, usePresentations,
} from '../shared';

const TONES = ['', 'Plain and direct', 'Warm and friendly', 'Formal', 'Playful', 'Calm and considered'];
const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};

function fitOutline(raw, count) {
  const list = Array.isArray(raw?.slides) ? raw.slides.slice(0, count) : [];
  while (list.length < count) {
    list.push({ layout: 'bullets', title: `Slide ${list.length + 1}`, bullets: [], body: '', imageRef: '', imagePrompt: '', notes: '' });
  }
  return {
    ...(raw || {}),
    nSlides: count,
    slides: list.map((s, i) => ({
      ...s,
      layout: LAYOUTS.includes(s.layout) ? s.layout : (i === 0 ? 'title' : 'bullets'),
      title: s.title || `Slide ${i + 1}`,
      bullets: Array.isArray(s.bullets) ? s.bullets : [],
    })),
  };
}

/** Review and edit the slide-by-slide plan before spending a second model call on the full deck. */
function OutlineEditor({ outline, setOutline }) {
  const getIcon = useIcon();
  const [open, setOpen] = useState({});
  const setField = (key, value) => setOutline((prev) => ({ ...prev, [key]: value }));
  const setSlide = (i, patch) => setOutline((prev) => fitOutline({ ...prev, slides: prev.slides.map((s, j) => (j === i ? { ...s, ...patch } : s)) }, prev.nSlides));
  const count = outline.nSlides || outline.slides.length;

  return (
    <div className={`${ROW} space-y-3`} style={FIELD_STYLE}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Review the outline</p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{count} slides. Edit any heading or point before the deck is written.</p>
        </div>
        <Tooltip text="Keep the outline and make the deck from exactly these slides.">
          <button type="button" onClick={() => setOutline(null)} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>Discard outline</button>
        </Tooltip>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <VoiceInput value={outline.title || ''} onChange={(v) => setField('title', v)} label="Outline title" placeholder="Deck title" />
        <VoiceInput value={outline.subtitle || ''} onChange={(v) => setField('subtitle', v)} label="Outline subtitle" placeholder="Subtitle (optional)" />
      </div>
      <div className={`${ROW} max-h-[30rem] overflow-y-auto space-y-2`} style={{ background: 'var(--color-bg)' }}>
        {outline.slides.map((slide, i) => (
          <div key={i} className="rounded-xl border p-3 space-y-2" style={CARD_STYLE}>
            <button type="button" onClick={() => setOpen((v) => ({ ...v, [i]: !v[i] }))} className="w-full flex items-center gap-2 text-left" aria-label={`Edit slide ${i + 1}`}>
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
              <span className="flex-1 text-sm" style={{ color: 'var(--color-text)' }}>{slide.title || `Slide ${i + 1}`}</span>
              {getIcon(open[i] ? 'chevron-up' : 'chevron-down', { size: 14 })}
            </button>
            {open[i] && (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Layout</span>
                    <select value={slide.layout} onChange={(e) => setSlide(i, { layout: e.target.value })} className={SELECT} style={FIELD_STYLE}>
                      {LAYOUTS.map((layout) => <option key={layout} value={layout}>{LAYOUT_LABELS[layout] || layout}</option>)}
                    </select>
                  </label>
                  <VoiceInput value={slide.title || ''} onChange={(v) => setSlide(i, { title: v })} label={`Heading for slide ${i + 1}`} placeholder="Heading" />
                </div>
                <VoiceInput type="textarea" rows={2} value={(slide.bullets || []).join('\n')} onChange={(v) => setSlide(i, { bullets: parseLines(v) })} label={`Points for slide ${i + 1}`} append placeholder={'One point per line'} />
                <VoiceInput type="textarea" rows={2} value={slide.body || ''} onChange={(v) => setSlide(i, { body: v })} label={`Body for slide ${i + 1}`} append placeholder="Supporting paragraph (optional)" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <VoiceInput value={slide.imagePrompt || ''} onChange={(v) => setSlide(i, { imagePrompt: v })} label={`Picture idea for slide ${i + 1}`} placeholder="Placeholder picture idea (optional)" />
                  <VoiceInput type="textarea" rows={2} value={slide.notes || ''} onChange={(v) => setSlide(i, { notes: v })} label={`Notes for slide ${i + 1}`} append placeholder="Presenter notes (optional)" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CreateDeck() {
  const {
    deck, setDeck, sourceText, setSourceText, imageRefs, setImageRefs, themeId, chooseTheme, chooseDesign, applyBrand, setApplyBrand,
    meta, startJob, openTool, toast, defaultModel,
  } = usePresentations();
  const [brief, setBrief] = useState('');
  const [themes, setThemes] = useState(() => themeOptions(BUILTIN_THEMES));
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [audience, setAudience] = useState(deck.audience || '');
  const [tone, setTone] = useState(deck.tone || '');
  const [duration, setDuration] = useState(deck.duration || 12);
  const [nSlides, setNSlides] = useState(deck.nSlides || 10);
  const [placeholders, setPlaceholders] = useState(true);
  const [placeholderCount, setPlaceholderCount] = useState(3);
  const [outline, setOutline] = useState(null);

  useEffect(() => {
    api.get('/api/presentations/templates')
      .then((r) => readJson(r, 'Could not load themes.'))
      .then((d) => setThemes([...themeOptions(d.builtins?.length ? d.builtins : BUILTIN_THEMES), ...themeOptions(d.themes || [])]))
      .catch(() => {});
  }, []);

  const noBrandKit = applyBrand && !meta?.brandKit?.available;
  const controls = { audience, tone, duration, nSlides };

  const payload = (extra = {}) => ({
    brief, sourceText, imageRefs, themeId,
    designId: deck.designId || 'clean',
    aspect: deck.aspect || '16:9',
    applyBrand,
    ...controls,
    placeholders,
    placeholderCount,
    ...extra,
  });

  const makeDeck = async (useOutline) => {
    if (!brief.trim() && !sourceText.trim() && !useOutline) {
      toast('Write a brief or import some source text first.', 'error');
      return;
    }
    if (noBrandKit) return;
    setBusy(true);
    try {
      await startJob('create', '/api/presentations/create', payload(useOutline ? { outline } : {}));
      if (useOutline) setDeck((prev) => ({ ...prev, ...controls, outline: outline?.slides || [] }));
      openTool('slides');
    } catch (err) {
      if (err.message !== 'Cancelled') toast(err.message || 'Could not make the deck.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const planOutline = async () => {
    if (!brief.trim() && !sourceText.trim()) {
      toast('Write a brief or import some source text first.', 'error');
      return;
    }
    setPlanning(true);
    try {
      const res = await api.post('/api/presentations/outline', payload());
      const data = await readJson(res, 'Could not plan the outline.');
      setOutline(fitOutline(data.outline, nSlides));
      toast('Outline ready — edit it before making the deck.', 'success');
    } catch (err) {
      toast(err.message || 'Could not plan the outline.', 'error');
    } finally {
      setPlanning(false);
    }
  };

  const changeCount = (value) => {
    const next = clamp(value, 6, 20, 10);
    setNSlides(next);
    if (outline) setOutline((prev) => fitOutline(prev, next));
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
                  <PresentationImage key={`${ref}-${i}`} src={ref} alt={`Source ${i + 1}`} className="h-16 w-20 rounded-lg border object-cover" style={{ borderColor: 'var(--color-border)' }} />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Audience</span>
            <Tooltip text="Who is in the room? The outline and notes are written for them.">
              <VoiceInput value={audience} onChange={setAudience} label="Audience" placeholder="e.g. client leadership" />
            </Tooltip>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Tone</span>
            <Tooltip text="How the deck should sound. Leave blank for a natural, plain style.">
              <select value={tone} onChange={(e) => setTone(e.target.value)} className={SELECT} style={FIELD_STYLE}>
                {TONES.map((t) => <option key={t} value={t}>{t || 'Default'}</option>)}
              </select>
            </Tooltip>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Talk length · {duration} min</span>
            <Tooltip text="A rough speaking time. It guides how much the model writes on each slide.">
              <input type="range" min="1" max="180" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full" aria-label="Talk length in minutes" />
            </Tooltip>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Slides · {nSlides}</span>
            <Tooltip text="From 6 to 20 slides. You can add or remove slides later in the editor.">
              <input type="range" min="6" max="20" value={nSlides} onChange={(e) => changeCount(e.target.value)} className="w-full" aria-label="Number of slides" />
            </Tooltip>
          </label>
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
          <div className="flex flex-col gap-2 justify-end">
            <Tooltip text="Override the theme with the colours, font and logo from your Graphics Brand Kit.">
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={applyBrand} onChange={(e) => setApplyBrand(e.target.checked)} disabled={!meta?.brandKit?.available} />
                Apply Brand Kit
              </label>
            </Tooltip>
            <Tooltip text="Add a few small, low-cost AI pictures as placeholders. The deck still builds if image generation is unavailable.">
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={placeholders} onChange={(e) => setPlaceholders(e.target.checked)} />
                Placeholder pictures
              </label>
            </Tooltip>
            {placeholders && (
              <select value={placeholderCount} onChange={(e) => setPlaceholderCount(Number(e.target.value))} className={SELECT} style={FIELD_STYLE} aria-label="Number of placeholder pictures">
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} picture{n === 1 ? '' : 's'}</option>)}
              </select>
            )}
          </div>
        </div>

        {noBrandKit && (
          <Notice tone="warn">There is no saved Brand Kit yet, so this job cannot apply one. Add one in Graphics first, or leave the box unticked.</Notice>
        )}

        {defaultModel && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            The outline and slides are written with the workspace default model, {getModelShortName(defaultModel)} (set by an admin in Settings).
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Tooltip text="Plan the slides first so you can edit the outline before writing the deck.">
            <button type="button" onClick={planOutline} disabled={planning || busy || noBrandKit || (!brief.trim() && !sourceText.trim())} className={BTN_SECONDARY} style={SECONDARY_STYLE}>
              {planning ? 'Planning…' : 'Review outline first'}
            </button>
          </Tooltip>
          {outline ? (
            <Tooltip text="Use the edited outline below and write the full deck.">
              <button type="button" onClick={() => makeDeck(true)} disabled={busy || noBrandKit} className={BTN_PRIMARY} style={PRIMARY_STYLE}>
                {busy ? 'Starting…' : 'Make deck from outline'}
              </button>
            </Tooltip>
          ) : (
            <Tooltip text="Start the build in the background. You can cancel it, and edit the deck as soon as it is ready.">
              <button type="button" onClick={() => makeDeck(false)} disabled={busy || noBrandKit || (!brief.trim() && !sourceText.trim())} className={BTN_PRIMARY} style={PRIMARY_STYLE}>
                {busy ? 'Starting…' : 'Make deck'}
              </button>
            </Tooltip>
          )}
          <Tooltip text="Bring in text and pictures from files or a web page first, then come back here.">
            <button type="button" onClick={() => openTool('import')} className="text-xs underline transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>
              Need text or pictures first? Import source
            </button>
          </Tooltip>
        </div>

        {outline && <OutlineEditor outline={outline} setOutline={setOutline} />}
      </div>
    </section>
  );
}
