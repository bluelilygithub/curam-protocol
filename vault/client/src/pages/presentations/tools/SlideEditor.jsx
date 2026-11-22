import React, { useEffect, useRef, useState } from 'react';
import api from '../../../utils/apiClient';
import Dialog from '../../../components/Dialog';
import EmptyState from '../../../components/EmptyState';
import Tooltip from '../../../components/Tooltip';
import { VoiceInput } from '../../../components/voiceInput/VoiceInput';
import { useIcon } from '../../../providers/IconProvider';
import { takeToolHandoff } from '../../../utils/toolHandoff.mjs';
import PresentationPreview from '../PresentationPreview';
import { parseLines, syncDraft } from '../lines.mjs';
import {
  ASPECTS, BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, CARD, CARD_STYLE, CHART_TYPES, COLUMN_LAYOUTS, FIELD_STYLE, LAYOUTS, LAYOUT_HELP, LAYOUT_LABELS, PRIMARY_STYLE, ROW, SECONDARY_STYLE, SELECT, SHAPE_COLOURS, SHAPE_KINDS, TRANSITIONS,
  DeckHandoff, InlineDelete, ToolHeader, newSlide, readDeckFile, readJson, stripRich, usePresentations,
} from '../shared';

/** A one-item-per-line box that keeps what is typed (spaces, new lines) and hands the deck the cleaned list (lines.mjs). */
function LinesField({ lines, onLines, ...props }) {
  const [draft, setDraft] = useState(() => (lines || []).join('\n'));
  const joined = (lines || []).join('\n');
  useEffect(() => { setDraft((d) => syncDraft(d, lines)); }, [joined]); // eslint-disable-line react-hooks/exhaustive-deps
  return <VoiceInput type="textarea" value={draft} onChange={(v) => { setDraft(v); onLines(parseLines(v)); }} append {...props} />;
}

const escapeRich = (value) => stripRich(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
const placeholderHtml = (value, placeholder) => (value || '' ? escapeRich(value) : `<span style="opacity:.55">${escapeRich(placeholder)}</span>`);

/** A tiny bold/italic/underline editor. The deck stores only the five allowed tags; the server sanitises them again. */
function RichField({ value, onChange, label, placeholder, rows = 2 }) {
  const ref = useRef(null);
  const focused = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (el && !focused.current && el.innerHTML !== (value || '')) el.innerHTML = placeholderHtml(value, placeholder);
  }, [value, placeholder]);
  const emit = () => { if (ref.current) onChange(ref.current.innerHTML.replace(/<span style="opacity:.55">.*?<\/span>/g, '')); };
  const command = (cmd, arg) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };
  return (
    <div className="space-y-1">
      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <div className="flex flex-wrap items-center gap-1 rounded-xl border px-2 py-1" style={FIELD_STYLE}>
        {[
          ['bold', 'B'], ['italic', 'I'], ['underline', 'U'], ['insertLineBreak', '↵'],
        ].map(([cmd, glyph]) => (
          <button
            key={cmd}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => command(cmd)}
            aria-label={`${cmd} ${label}`}
            className="w-6 h-6 rounded border text-xs font-semibold"
            style={{ ...FIELD_STYLE, borderColor: 'var(--color-border)' }}
          >{glyph}</button>
        ))}
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Select text, then choose a style.</span>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        onFocus={() => { focused.current = true; if (ref.current && !value) ref.current.innerHTML = ''; }}
        onBlur={() => { focused.current = false; emit(); }}
        onInput={emit}
        className={`w-full rounded-xl border px-3 py-2 text-sm overflow-auto ${rows > 2 ? 'min-h-[5rem]' : ''}`}
        style={FIELD_STYLE}
      />
    </div>
  );
}

/** A thumbnail with its own caption and action buttons, used for generated and attached pictures. */
function PictureTile({ src, label, onPreview, children }) {
  return (
    <div className="w-40 space-y-2 rounded-xl border p-2" style={FIELD_STYLE}>
      <button
        type="button"
        onClick={onPreview}
        aria-label={`Preview ${label}`}
        className="block w-full rounded-lg border overflow-hidden transition-opacity duration-200 hover:opacity-70"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
      >
        <img src={src} alt={label} className="h-24 w-full object-contain" />
      </button>
      <p className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

/** Local drafts keep half-typed numbers and table cells intact until the field loses focus. */
function CommaValuesField({ values, onCommit, label }) {
  const [draft, setDraft] = useState(() => (values || []).join(', '));
  useEffect(() => { setDraft((values || []).join(', ')); }, [values]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="block space-y-1">
      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <VoiceInput
        value={draft}
        onChange={setDraft}
        onBlur={() => onCommit(draft.split(/[\n,]+/).map((v) => Number(v.trim()) || 0).filter((_, i, all) => i < 12))}
        label={label}
        placeholder="3, 7, 11"
      />
    </label>
  );
}

function ChartEditor({ chart, onChange }) {
  const value = chart || { type: 'bar', title: '', labels: [], series: [{ name: 'Series 1', values: [] }], x: 8, y: 25, w: 84, h: 55 };
  const patch = (p) => onChange({ ...value, ...p });
  const setSeries = (i, p) => patch({ series: value.series.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  return (
    <div className={`${ROW} space-y-3`} style={FIELD_STYLE}>
      <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Chart</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Type</span>
          <select value={value.type} onChange={(e) => patch({ type: e.target.value })} className={SELECT} style={FIELD_STYLE}>
            {CHART_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <VoiceInput value={value.title || ''} onChange={(title) => patch({ title })} label="Chart title" placeholder="Chart title (optional)" />
      </div>
      <LinesField rows={2} lines={value.labels || []} onLines={(labels) => patch({ labels })} label="Chart labels (one per line)" placeholder="Q1\nQ2\nQ3" />
      {(value.series || []).map((series, si) => (
        <div key={si} className="grid gap-2 sm:grid-cols-2">
          <VoiceInput value={series.name} onChange={(name) => setSeries(si, { name })} label={`Series ${si + 1} name`} placeholder="Series name" />
          <CommaValuesField values={series.values} onCommit={(values) => setSeries(si, { values })} label={`Series ${si + 1} values`} />
          {value.series.length > 1 && (
            <button type="button" onClick={() => patch({ series: value.series.filter((_, j) => j !== si) })} className={`${BTN_QUIET} w-fit`} style={{ color: 'var(--color-muted)' }}>Remove series {si + 1}</button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => patch({ series: [...value.series, { name: `Series ${value.series.length + 1}`, values: [] }] })} className={BTN_SECONDARY} style={SECONDARY_STYLE}>Add series</button>
        <button type="button" onClick={() => onChange(null)} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>Remove chart</button>
      </div>
    </div>
  );
}

function TableEditor({ table, onChange }) {
  const [draft, setDraft] = useState(() => (table?.rows || []).map((row) => row.join(' | ')).join('\n'));
  useEffect(() => {
    if (table) setDraft((table.rows || []).map((row) => row.join(' | ')).join('\n'));
  }, [table]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!table) {
    return (
      <button type="button" onClick={() => onChange({ rows: [['Heading', 'Value'], ['Row 1', '']], header: true, x: 8, y: 30, w: 84, h: 45 })} className={BTN_SECONDARY} style={SECONDARY_STYLE}>
        Add table
      </button>
    );
  }
  const patch = (p) => onChange({ ...table, ...p });
  return (
    <div className={`${ROW} space-y-3`} style={FIELD_STYLE}>
      <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Table</p>
      <VoiceInput
        type="textarea"
        rows={5}
        value={draft}
        onChange={setDraft}
        onBlur={() => patch({ rows: parseLines(draft).map((line) => line.split(/\s*[|]\s*/)) })}
        label="Table rows"
        placeholder={'Heading | Value\nRow 1 | 42'}
      />
      <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
        <input type="checkbox" checked={table.header !== false} onChange={(e) => patch({ header: e.target.checked })} />
        First row is a header
      </label>
      <button type="button" onClick={() => onChange(null)} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>Remove table</button>
    </div>
  );
}

export default function SlideEditor() {
  const getIcon = useIcon();
  const {
    deck, setDeck, meta, saveDeck, savedDeckId, openTool, toast, present, chooseTransition,
  } = usePresentations();
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showPreview, setShowPreview] = useState(true);
  const [richOn, setRichOn] = useState({});
  const [rewrite, setRewrite] = useState({ instruction: '', index: null, busy: false });
  const [adding, setAdding] = useState(false);
  const [generating, setGenerating] = useState(null); // slide id with an image request in flight
  const [generated, setGenerated] = useState({}); // slide id -> generated asset refs waiting to be inserted
  const [picturePreview, setPicturePreview] = useState(null); // { src, slideId, from, extraIndex }

  // Another tool can hand a whole deck here as a JSON file.
  useEffect(() => {
    const file = takeToolHandoff('slides');
    if (!file) return;
    readDeckFile(file).then((parsed) => {
      if (parsed) { setDeck(parsed); toast('Deck received from the other tool.', 'success'); }
      else toast('That file was not a deck.', 'error');
    });
  }, [setDeck, toast]);

  const patchSlide = (index, updater) => setDeck((prev) => ({
    ...prev,
    slides: prev.slides.map((slide, i) => (i === index ? updater(slide) : slide)),
  }));
  const updateSlide = (index, patch) => patchSlide(index, (slide) => ({ ...slide, ...patch }));
  const updateList = (index, key, itemIndex, patch) => patchSlide(index, (slide) => {
    const list = [...(slide[key] || [])];
    list[itemIndex] = { ...list[itemIndex], ...patch };
    return { ...slide, [key]: list };
  });
  const removeListItem = (index, key, itemIndex) => patchSlide(index, (slide) => ({
    ...slide,
    [key]: (slide[key] || []).filter((_, j) => j !== itemIndex),
  }));
  const ensureRich = (slide) => slide.rich || {
    title: escapeRich(slide.title),
    body: escapeRich(slide.body),
    bullets: (slide.bullets || []).map(escapeRich),
  };

  // Columns for comparison (2), three-column (3) and stats (up to 4). Missing columns are created as they are typed into.
  const updateColumn = (index, col, patch) => patchSlide(index, (slide) => {
    const columns = [...(slide.columns || [])];
    while (columns.length <= col) columns.push({ heading: '', bullets: [] });
    columns[col] = { ...columns[col], ...patch };
    return { ...slide, columns };
  });

  const move = (index, delta) => setDeck((prev) => {
    const target = index + delta;
    if (target < 0 || target >= prev.slides.length) return prev;
    const slides = [...prev.slides];
    [slides[index], slides[target]] = [slides[target], slides[index]];
    return { ...prev, slides };
  });

  const duplicate = (index) => setDeck((prev) => {
    if (prev.slides.length >= (meta?.maxSlides || 20)) return prev;
    const copy = { ...prev.slides[index], id: `s${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, title: `${prev.slides[index].title || 'Slide'} (copy)` };
    const slides = [...prev.slides];
    slides.splice(index + 1, 0, copy);
    return { ...prev, slides };
  });

  const slideIdAt = (index) => deck.slides[index]?.id || `slide-${index}`;
  const slideIndexFor = (slideId) => deck.slides.findIndex((s) => s.id === slideId);

  // Ask the image router for one owned asset ref. This deliberately does not touch the deck: a person should be able to
  // preview the result and choose whether to insert it. Deck creation and Add slide still insert one automatically.
  const requestPlaceholder = async (index, { slideId, imagePrompt = '', silent = false } = {}) => {
    const key = slideId || slideIdAt(index);
    setGenerating(key);
    try {
      const res = await api.post('/api/presentations/placeholders', {
        deckTitle: deck.title,
        title: deck.slides[index]?.title || '',
        imagePrompt,
        index,
      });
      const data = await readJson(res, 'A placeholder picture could not be made.');
      if (!data.imageRef) {
        if (data.warning && !silent) toast(data.warning, 'warn');
        return '';
      }
      return data.imageRef;
    } catch (err) {
      if (!silent) toast(err.message || 'A placeholder picture could not be made.', 'warn');
      return '';
    } finally {
      setGenerating(null);
    }
  };

  const addPictureToSlide = (index, src) => patchSlide(index, (slide) => (
    ['picture', 'full-picture'].includes(slide.layout)
      ? { ...slide, imageRef: src }
      : { ...slide, images: [...(slide.images || []), {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ref: src, x: 58, y: 52, w: 36, h: 36, fit: 'contain',
      }] }
  ));

  const usePictureAsMain = (index, src, extraIndex = null) => patchSlide(index, (slide) => ({
    ...slide,
    imageRef: src,
    images: extraIndex === null ? (slide.images || []) : (slide.images || []).filter((_, j) => j !== extraIndex),
  }));

  const generateForSlide = async (index) => {
    const slide = deck.slides[index];
    if (!slide) return;
    const src = await requestPlaceholder(index, { slideId: slide.id, imagePrompt: slide.imagePrompt });
    if (!src) return;
    setGenerated((prev) => ({ ...prev, [slide.id]: [...(prev[slide.id] || []), src] }));
    toast('Picture ready — preview it below, then add it to the slide.', 'success');
  };

  const dropGenerated = (slideId, at) => setGenerated((prev) => ({
    ...prev,
    [slideId]: (prev[slideId] || []).filter((_, j) => j !== at),
  }));

  const insertGenerated = (index, slideId, at) => {
    const src = generated[slideId]?.[at];
    if (!src) return;
    addPictureToSlide(index, src);
    dropGenerated(slideId, at);
    toast('Picture added to this slide.', 'success');
  };

  const openPreview = (src, slideId, from = 'tray', extraIndex = null) => setPicturePreview({ src, slideId, from, extraIndex });

  const addSlide = async () => {
    const index = deck.slides.length;
    if (index >= (meta?.maxSlides || 20)) return;
    const slide = newSlide(index);
    setDeck((prev) => ({ ...prev, slides: [...prev.slides, slide] }));
    setAdding(true);
    const src = await requestPlaceholder(index, { slideId: slide.id, silent: true });
    if (src) addPictureToSlide(index, src);
    setAdding(false);
  };

  const deleteSlide = (index) => {
    const slideId = slideIdAt(index);
    setDeck((prev) => ({ ...prev, slides: prev.slides.filter((_, i) => i !== index) }));
    setGenerated((prev) => {
      const next = { ...prev };
      delete next[slideId];
      return next;
    });
    if (picturePreview?.slideId === slideId) setPicturePreview(null);
    setConfirmDelete(null);
  };

  const rewriteSlide = async (index) => {
    if (!rewrite.instruction?.trim()) {
      toast('Say what should change on this slide.', 'error');
      return;
    }
    setRewrite((r) => ({ ...r, busy: true }));
    try {
      const res = await api.post('/api/presentations/rewrite-slide', {
        deck, index, instruction: rewrite.instruction,
      });
      const data = await readJson(res, 'That slide could not be rewritten.');
      if (data.slide) updateSlide(index, data.slide);
      toast(data.warning || 'Slide updated.', data.warning ? 'warn' : 'success');
      setRewrite({ instruction: '', index: null, busy: false });
    } catch (err) {
      toast(err.message || 'That slide could not be rewritten.', 'error');
      setRewrite((r) => ({ ...r, busy: false }));
    }
  };

  const maxSlides = meta?.maxSlides || 20;

  return (
    <section className="space-y-4">
      <ToolHeader id="slides" title="Slide editor" />

      {deck.slides.length === 0 ? (
        <div className={CARD} style={CARD_STYLE}>
          <EmptyState
            icon="layers"
            title="No slides yet"
            body="Make a first draft from a brief, or open a saved deck, and its slides appear here to edit."
            action={(
              <div className="flex flex-wrap justify-center gap-2">
                <Tooltip text="Write a brief and generate a first draft to edit here.">
                  <button type="button" onClick={() => openTool('create')} className={BTN_PRIMARY} style={PRIMARY_STYLE}>Create a deck</button>
                </Tooltip>
                <Tooltip text="Open a deck you saved before.">
                  <button type="button" onClick={() => openTool('decks')} className={BTN_SECONDARY} style={SECONDARY_STYLE}>My decks</button>
                </Tooltip>
              </div>
            )}
          />
        </div>
      ) : (
        <div className="flex flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start gap-4">
          <div className="space-y-4">
            <div className={CARD} style={CARD_STYLE}>
              <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Deck details</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <Tooltip text="The title shown on the first slide and in your saved decks.">
                  <VoiceInput value={deck.title} onChange={(title) => setDeck((prev) => ({ ...prev, title }))} label="Deck title" placeholder="Deck title" />
                </Tooltip>
                <Tooltip text="An optional line under the title.">
                  <VoiceInput value={deck.subtitle} onChange={(subtitle) => setDeck((prev) => ({ ...prev, subtitle }))} label="Deck subtitle" placeholder="Subtitle (optional)" />
                </Tooltip>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block space-y-1 min-w-[9rem]">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Aspect</span>
                  <Tooltip text="All slides, previews and exports use the same aspect.">
                    <select value={deck.aspect || '16:9'} onChange={(e) => setDeck((prev) => ({ ...prev, aspect: e.target.value }))} className={SELECT} style={FIELD_STYLE}>
                      {ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </Tooltip>
                </label>
                <label className="block space-y-1 min-w-[12rem]">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Transition between slides</span>
                  <Tooltip text={(TRANSITIONS.find((t) => t.id === (deck.transition || 'fade')) || {}).tip || 'How the slideshow moves between slides.'}>
                    <select value={deck.transition || 'fade'} onChange={(e) => chooseTransition(e.target.value)} className={SELECT} style={FIELD_STYLE}>
                      {TRANSITIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </Tooltip>
                </label>
                <Tooltip text="Play the whole deck full screen from the first slide.">
                  <button type="button" onClick={() => present(0)} className={BTN_PRIMARY} style={PRIMARY_STYLE}>
                    <span className="inline-flex items-center gap-1.5">{getIcon('play', { size: 13 })} Present</span>
                  </button>
                </Tooltip>
              </div>
            </div>

            {deck.slides.map((slide, i) => (
              <div key={slide.id} className={CARD} style={CARD_STYLE}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Slide {i + 1}</span>
                  <Tooltip text="How this slide is arranged. Thirteen layouts: title, section header, bullets, agenda, two column, comparison, three columns, big numbers, quote, timeline, picture, full picture and closing.">
                    <select
                      value={slide.layout}
                      onChange={(e) => updateSlide(i, { layout: e.target.value })}
                      className="text-xs px-3 py-1.5 rounded-lg border"
                      style={FIELD_STYLE}
                      aria-label={`Layout for slide ${i + 1}`}
                    >
                      {LAYOUTS.map((layout) => <option key={layout} value={layout}>{LAYOUT_LABELS[layout] || layout}</option>)}
                    </select>
                  </Tooltip>
                  <span className="flex-1" />
                  <Tooltip text="Play the slideshow full screen, starting from this slide.">
                    <button type="button" onClick={() => present(i)} aria-label={`Present from slide ${i + 1}`} className={BTN_QUIET} style={{ color: 'var(--color-primary)' }}>
                      {getIcon('play', { size: 14 })}
                    </button>
                  </Tooltip>
                  <Tooltip text="Copy this slide and insert the copy straight after it.">
                    <button type="button" onClick={() => duplicate(i)} disabled={deck.slides.length >= maxSlides} aria-label={`Duplicate slide ${i + 1}`} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>
                      {getIcon('copy', { size: 14 })}
                    </button>
                  </Tooltip>
                  <Tooltip text="Move this slide earlier.">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move slide ${i + 1} earlier`} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>
                      {getIcon('chevron-up', { size: 14 })}
                    </button>
                  </Tooltip>
                  <Tooltip text="Move this slide later.">
                    <button type="button" onClick={() => move(i, 1)} disabled={i === deck.slides.length - 1} aria-label={`Move slide ${i + 1} later`} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>
                      {getIcon('chevron-down', { size: 14 })}
                    </button>
                  </Tooltip>
                  <InlineDelete
                    pending={confirmDelete === i}
                    onAsk={() => setConfirmDelete(i)}
                    onConfirm={() => deleteSlide(i)}
                    onCancel={() => setConfirmDelete(null)}
                    what={`slide ${i + 1} from the deck (save the deck to keep the change)`}
                  />
                </div>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{LAYOUT_HELP[slide.layout]}</p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{slide.layout === 'quote' ? 'Speaker (optional)' : 'Heading'}</span>
                    <Tooltip text={slide.layout === 'quote' ? 'Who said the quote.' : 'The heading on this slide.'}>
                      <VoiceInput value={slide.title} onChange={(title) => updateSlide(i, { title })} label={`Title for slide ${i + 1}`} placeholder={slide.layout === 'quote' ? 'Who said it' : 'Slide title'} />
                    </Tooltip>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Slide background (optional)</span>
                    <Tooltip text="A hex colour for just this slide. Leave blank to use the colour theme.">
                      <VoiceInput value={slide.background || ''} onChange={(background) => updateSlide(i, { background })} label={`Background for slide ${i + 1}`} placeholder="#ffffff" />
                    </Tooltip>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Tooltip text="Use a small bold, italic and underline toolbar for the heading, body and points. Everything else stays plain text.">
                    <button type="button" onClick={() => setRichOn((v) => ({ ...v, [i]: !v[i] }))} className={BTN_SECONDARY} style={SECONDARY_STYLE}>
                      {richOn[i] ? 'Hide inline formatting' : 'Inline formatting'}
                    </button>
                  </Tooltip>
                  <Tooltip text="Ask the model to change only this slide, using your instruction as a guide. The rest of the deck stays as it is.">
                    <button type="button" onClick={() => setRewrite((r) => ({ ...r, index: r.index === i ? null : i, instruction: '' }))} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>
                      Rewrite this slide
                    </button>
                  </Tooltip>
                </div>

                {richOn[i] && (
                  <div className={`${ROW} space-y-3`} style={FIELD_STYLE}>
                    <RichField
                      label={`Formatted heading ${i + 1}`}
                      value={ensureRich(slide).title}
                      onChange={(title) => updateSlide(i, { title: stripRich(title), rich: { ...ensureRich(slide), title } })}
                      placeholder="Slide heading"
                    />
                    <RichField
                      label={`Formatted body ${i + 1}`}
                      rows={4}
                      value={ensureRich(slide).body}
                      onChange={(body) => updateSlide(i, { body: stripRich(body), rich: { ...ensureRich(slide), body } })}
                      placeholder="Supporting text"
                    />
                    <div className="space-y-2">
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Formatted points</span>
                      {(slide.bullets || []).map((bullet, bi) => (
                        <RichField
                          key={bi}
                          label={`Point ${bi + 1}`}
                          value={ensureRich(slide).bullets?.[bi] || ''}
                          onChange={(html) => {
                            const bullets = [...(slide.bullets || [])];
                            bullets[bi] = stripRich(html);
                            const richBullets = [...(ensureRich(slide).bullets || [])];
                            while (richBullets.length < bullets.length) richBullets.push('');
                            richBullets[bi] = html;
                            updateSlide(i, { bullets, rich: { ...ensureRich(slide), bullets: richBullets } });
                          }}
                          placeholder="A point"
                        />
                      ))}
                    </div>
                  </div>
                )}

                {rewrite.index === i && (
                  <div className={`${ROW} space-y-2`} style={FIELD_STYLE}>
                    <p className="text-xs" style={{ color: 'var(--color-text)' }}>
                      What should change on slide {i + 1}? For example, “make the second point shorter and add a line about cost”.
                    </p>
                    <VoiceInput value={rewrite.instruction} onChange={(instruction) => setRewrite((r) => ({ ...r, instruction }))} label={`Rewrite instruction for slide ${i + 1}`} placeholder="Rewrite instruction" />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => rewriteSlide(i)} disabled={rewrite.busy} className={BTN_PRIMARY} style={PRIMARY_STYLE}>
                        {rewrite.busy ? 'Rewriting…' : 'Rewrite slide'}
                      </button>
                      <button type="button" onClick={() => setRewrite({ instruction: '', index: null, busy: false })} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>Cancel</button>
                    </div>
                  </div>
                )}

                {COLUMN_LAYOUTS[slide.layout] && (
                  <div className={`grid gap-3 ${COLUMN_LAYOUTS[slide.layout] === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 2xl:grid-cols-4'}`}>
                    {Array.from({ length: COLUMN_LAYOUTS[slide.layout] }, (_, ci) => {
                      const col = (slide.columns || [])[ci] || { heading: '', bullets: [] };
                      const stats = slide.layout === 'stats';
                      return (
                        <div key={ci} className={`${ROW} space-y-2`} style={FIELD_STYLE}>
                          <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{stats ? `Number ${ci + 1}${ci > 1 ? ' (optional)' : ''}` : `Column ${ci + 1}`}</span>
                          <Tooltip text={stats ? 'The big number, like 42% or $1.2m. Leave it empty to show fewer numbers.' : 'The heading of this column.'}>
                            <VoiceInput value={col.heading} onChange={(heading) => updateColumn(i, ci, { heading })} label={`${stats ? 'Number' : 'Heading'} ${ci + 1} for slide ${i + 1}`} placeholder={stats ? 'e.g. 42%' : 'Heading'} />
                          </Tooltip>
                          <Tooltip text={stats ? 'What the number measures, in a few words.' : 'One point per line.'}>
                            <LinesField
                              rows={stats ? 2 : 3}
                              lines={col.bullets}
                              onLines={(bullets) => updateColumn(i, ci, { bullets })}
                              label={`${stats ? 'Label' : 'Points'} ${ci + 1} for slide ${i + 1}`}
                              placeholder={stats ? 'e.g. Customer growth' : 'First point\nSecond point'}
                            />
                          </Tooltip>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Tooltip text="One bullet per line. On a title or picture slide this is used as supporting text.">
                    <LinesField rows={4} lines={slide.bullets} onLines={(bullets) => updateSlide(i, { bullets })} label={`Bullets for slide ${i + 1}`} placeholder={'First point\nSecond point'} />
                  </Tooltip>
                  <Tooltip text="A paragraph for this slide, where the layout uses one.">
                    <VoiceInput type="textarea" rows={4} value={slide.body} onChange={(body) => updateSlide(i, { body })} label={`Body for slide ${i + 1}`} append placeholder="Body text (optional)" />
                  </Tooltip>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Tooltip text="An image URL, an uploaded asset reference, or a data URL. Graphics handoffs can be pasted here too.">
                    <VoiceInput value={slide.imageRef} onChange={(imageRef) => updateSlide(i, { imageRef })} label={`Image for slide ${i + 1}`} placeholder="Image reference (optional)" />
                  </Tooltip>
                  <Tooltip text="Speaker notes are kept in the deck but do not appear on the slide. They appear in the presenter view and every export.">
                    <VoiceInput type="textarea" rows={2} value={slide.notes} onChange={(notes) => updateSlide(i, { notes })} label={`Notes for slide ${i + 1}`} append placeholder="Notes (optional)" />
                  </Tooltip>
                </div>
                <div className={`${ROW} space-y-3`} style={FIELD_STYLE}>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block min-w-[16rem] flex-1 space-y-1">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>AI picture idea</span>
                      <Tooltip text="Describe the simple illustration you want. Each generated picture is small, low-cost and saved in your own assets.">
                        <VoiceInput value={slide.imagePrompt || ''} onChange={(imagePrompt) => updateSlide(i, { imagePrompt })} label={`Picture prompt for slide ${i + 1}`} placeholder="e.g. a calm map of the project stages" />
                      </Tooltip>
                    </label>
                    <Tooltip text="Generate one picture. It appears below so you can preview it before deciding whether to add it.">
                      <button type="button" onClick={() => generateForSlide(i)} disabled={generating === slide.id} className={BTN_SECONDARY} style={SECONDARY_STYLE}>
                        {generating === slide.id ? 'Making picture…' : 'Generate AI picture'}
                      </button>
                    </Tooltip>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    Generated pictures wait here until you add them. Pictures added automatically when a deck or slide is made are already on their slides and can be previewed here.
                  </p>
                  {(generated[slide.id] || []).length > 0 && (
                    <div className="flex flex-wrap gap-3">
                      {(generated[slide.id] || []).map((src, gi) => (
                        <PictureTile key={`${src}-${gi}`} src={src} label={`Generated picture ${gi + 1}`} onPreview={() => openPreview(src, slide.id)}>
                          <Tooltip text="Add this picture to the slide, keeping any picture already there.">
                            <button type="button" onClick={() => insertGenerated(i, slide.id, gi)} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>Add to slide</button>
                          </Tooltip>
                          <Tooltip text="Make this the large picture for this slide.">
                            <button type="button" onClick={() => { usePictureAsMain(i, src); dropGenerated(slide.id, gi); toast('Picture set as the slide picture.', 'success'); }} className={BTN_SECONDARY} style={SECONDARY_STYLE}>Use as slide picture</button>
                          </Tooltip>
                          <button type="button" onClick={() => dropGenerated(slide.id, gi)} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>Discard</button>
                        </PictureTile>
                      ))}
                    </div>
                  )}
                  {slide.imageRef && (
                    <div className="flex flex-wrap gap-3">
                      <PictureTile src={slide.imageRef} label="Current slide picture" onPreview={() => openPreview(slide.imageRef, slide.id, 'main')}>
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Already on this slide</span>
                      </PictureTile>
                    </div>
                  )}
                </div>

                <details className="rounded-xl border p-3 space-y-3" style={FIELD_STYLE}>
                  <summary className="cursor-pointer text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                    More pictures and shapes ({(slide.images || []).length} pictures, {(slide.shapes || []).length} shapes)
                  </summary>
                  {(slide.images || []).map((image, ii) => (
                    <div key={image.id || ii} className={`${ROW} space-y-2`} style={FIELD_STYLE}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Picture {ii + 1}</span>
                        <button type="button" onClick={() => removeListItem(i, 'images', ii)} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>Remove</button>
                      </div>
                      {image.ref && (
                        <div className="flex flex-wrap gap-3">
                          <PictureTile src={image.ref} label={`Picture ${ii + 1} preview`} onPreview={() => openPreview(image.ref, slide.id, 'extra', ii)}>
                            <Tooltip text="Make this the large picture for this slide.">
                              <button type="button" onClick={() => { usePictureAsMain(i, image.ref, ii); toast('Picture set as the slide picture.', 'success'); }} className={BTN_SECONDARY} style={SECONDARY_STYLE}>Use as slide picture</button>
                            </Tooltip>
                          </PictureTile>
                        </div>
                      )}
                      <VoiceInput value={image.ref} onChange={(ref) => updateList(i, 'images', ii, { ref })} label={`Picture ${ii + 1} reference`} placeholder="Asset path or image URL" />
                      <div className="grid grid-cols-4 gap-2">
                        {['x', 'y', 'w', 'h'].map((key) => (
                          <label key={key} className="block space-y-1">
                            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{key.toUpperCase()} %</span>
                            <input type="number" min="0" max="100" value={image[key]} onChange={(e) => updateList(i, 'images', ii, { [key]: Number(e.target.value) })} className={SELECT} style={FIELD_STYLE} />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={() => patchSlide(i, (s) => ({ ...s, images: [...(s.images || []), { id: `img-${Date.now()}`, ref: '', x: 55, y: 20, w: 36, h: 36, fit: 'contain' }] }))} className={BTN_SECONDARY} style={SECONDARY_STYLE}>Add picture</button>
                  {(slide.shapes || []).map((shape, si) => (
                    <div key={shape.id || si} className={`${ROW} space-y-2`} style={FIELD_STYLE}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Shape {si + 1}</span>
                        <button type="button" onClick={() => removeListItem(i, 'shapes', si)} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>Remove</button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block space-y-1">
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Kind</span>
                          <select value={shape.kind} onChange={(e) => updateList(i, 'shapes', si, { kind: e.target.value })} className={SELECT} style={FIELD_STYLE}>
                            {SHAPE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                          </select>
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Fill</span>
                          <select value={shape.fill} onChange={(e) => updateList(i, 'shapes', si, { fill: e.target.value })} className={SELECT} style={FIELD_STYLE}>
                            {SHAPE_COLOURS.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </label>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {['x', 'y', 'w', 'h'].map((key) => (
                          <label key={key} className="block space-y-1">
                            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{key.toUpperCase()} %</span>
                            <input type="number" min="0" max="100" value={shape[key]} onChange={(e) => updateList(i, 'shapes', si, { [key]: Number(e.target.value) })} className={SELECT} style={FIELD_STYLE} />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={() => patchSlide(i, (s) => ({ ...s, shapes: [...(s.shapes || []), { id: `shape-${Date.now()}`, kind: 'rect', fill: 'primary', x: 8, y: 12, w: 20, h: 12, alpha: 0.15, rotation: 0 }] }))} className={BTN_SECONDARY} style={SECONDARY_STYLE}>Add shape</button>
                </details>

                <details className="rounded-xl border p-3 space-y-3" style={FIELD_STYLE}>
                  <summary className="cursor-pointer text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                    Chart and table{slide.chart ? ' · chart added' : ''}{slide.table ? ' · table added' : ''}
                  </summary>
                  <ChartEditor chart={slide.chart} onChange={(chart) => updateSlide(i, { chart })} />
                  <TableEditor table={slide.table} onChange={(table) => updateSlide(i, { table })} />
                </details>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text={`Add an empty slide with a low-cost AI placeholder picture (up to ${maxSlides} in a deck).`}>
                <button type="button" onClick={addSlide} disabled={deck.slides.length >= maxSlides || adding} className={BTN_SECONDARY} style={SECONDARY_STYLE}>
                  {getIcon('plus', { size: 13 })} {adding ? 'Adding picture…' : 'Add slide'}
                </button>
              </Tooltip>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{deck.slides.length} of {maxSlides} slides</span>
            </div>

            <div className="rounded-2xl border p-4 flex flex-wrap items-center gap-2" style={CARD_STYLE}>
              <Tooltip text={savedDeckId ? 'Update the saved deck in My decks with these edits.' : 'Save this deck so you can find it again in My decks.'}>
                <button type="button" onClick={() => saveDeck().catch((err) => toast(err.message || 'Could not save the deck.', 'error'))} className={BTN_PRIMARY} style={PRIMARY_STYLE}>
                  {savedDeckId ? 'Save changes' : 'Save deck'}
                </button>
              </Tooltip>
              <DeckHandoff deck={deck} />
              <Tooltip text="Make the finished files from these slides. PDF, PNG and HTML include notes pages; PPTX carries speaker notes.">
                <button type="button" onClick={() => openTool('export')} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>Export →</button>
              </Tooltip>
            </div>
          </div>

          <div className="space-y-2 xl:sticky xl:top-4">
            <Tooltip text="Show or hide the preview of the current deck. It rebuilds by itself a moment after you stop typing.">
              <button type="button" onClick={() => setShowPreview((v) => !v)} className={BTN_SECONDARY} style={{ ...SECONDARY_STYLE, color: 'var(--color-primary)' }}>
                {showPreview ? 'Hide preview' : 'Show preview'}
              </button>
            </Tooltip>
            {showPreview && <PresentationPreview deck={deck} compact />}
          </div>
        </div>
      )}

      {picturePreview && (() => {
        const index = slideIndexFor(picturePreview.slideId);
        const from = picturePreview.from;
        const discardTrayCopy = () => setGenerated((prev) => ({
          ...prev,
          [picturePreview.slideId]: (prev[picturePreview.slideId] || []).filter((src) => src !== picturePreview.src),
        }));
        return (
          <Dialog
            title={from === 'tray' ? 'Generated picture' : 'Picture on this slide'}
            size="lg"
            onClose={() => setPicturePreview(null)}
            footer={(
              <>
                {from === 'tray' && index >= 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      addPictureToSlide(index, picturePreview.src);
                      discardTrayCopy();
                      setPicturePreview(null);
                      toast('Picture added to this slide.', 'success');
                    }}
                    className={BTN_PRIMARY}
                    style={PRIMARY_STYLE}
                  >Add to slide</button>
                )}
                {index >= 0 && from !== 'main' && (
                  <button
                    type="button"
                    onClick={() => {
                      usePictureAsMain(index, picturePreview.src, from === 'extra' ? picturePreview.extraIndex : null);
                      if (from === 'tray') discardTrayCopy();
                      setPicturePreview(null);
                      toast('Picture set as the slide picture.', 'success');
                    }}
                    className={BTN_SECONDARY}
                    style={SECONDARY_STYLE}
                  >Use as slide picture</button>
                )}
                {from === 'extra' && index >= 0 && (
                  <button
                    type="button"
                    onClick={() => { removeListItem(index, 'images', picturePreview.extraIndex); setPicturePreview(null); }}
                    className={BTN_QUIET}
                    style={{ color: 'var(--color-muted)' }}
                  >Remove from slide</button>
                )}
                {from === 'main' && index >= 0 && (
                  <button
                    type="button"
                    onClick={() => { updateSlide(index, { imageRef: '' }); setPicturePreview(null); }}
                    className={BTN_QUIET}
                    style={{ color: 'var(--color-muted)' }}
                  >Remove from slide</button>
                )}
                <button type="button" onClick={() => setPicturePreview(null)} className={BTN_QUIET} style={{ color: 'var(--color-muted)' }}>Close</button>
              </>
            )}
          >
            <div className="space-y-3">
              <img
                src={picturePreview.src}
                alt="Large picture preview"
                className="max-h-[60vh] w-full rounded-xl border object-contain"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {from === 'tray'
                  ? 'This picture is saved in your Vault assets but is not on the slide yet. Add it as an extra picture, or make it the large slide picture.'
                  : 'This picture is already saved with the deck. Choose Use as slide picture to make it the large picture.'}
              </p>
            </div>
          </Dialog>
        );
      })()}
    </section>
  );
}
