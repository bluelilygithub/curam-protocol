import React, { useEffect, useState } from 'react';
import EmptyState from '../../../components/EmptyState';
import Tooltip from '../../../components/Tooltip';
import { VoiceInput } from '../../../components/voiceInput/VoiceInput';
import { useIcon } from '../../../providers/IconProvider';
import { takeToolHandoff } from '../../../utils/toolHandoff.mjs';
import PresentationPreview from '../PresentationPreview';
import {
  BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, CARD, CARD_STYLE, FIELD_STYLE, LAYOUTS, LAYOUT_LABELS, PRIMARY_STYLE, SECONDARY_STYLE,
  DeckHandoff, InlineDelete, ToolHeader, readDeckFile, usePresentations,
} from '../shared';

export default function SlideEditor() {
  const getIcon = useIcon();
  const {
    deck, setDeck, meta, saveDeck, savedDeckId, openTool, toast,
  } = usePresentations();
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showPreview, setShowPreview] = useState(true);

  // Another tool can hand a whole deck here as a JSON file.
  useEffect(() => {
    const file = takeToolHandoff('slides');
    if (!file) return;
    readDeckFile(file).then((parsed) => {
      if (parsed) { setDeck(parsed); toast('Deck received from the other tool.', 'success'); }
      else toast('That file was not a deck.', 'error');
    });
  }, [setDeck, toast]);

  const updateSlide = (index, patch) => setDeck((prev) => ({
    ...prev,
    slides: prev.slides.map((slide, i) => (i === index ? { ...slide, ...patch } : slide)),
  }));

  const move = (index, delta) => setDeck((prev) => {
    const target = index + delta;
    if (target < 0 || target >= prev.slides.length) return prev;
    const slides = [...prev.slides];
    [slides[index], slides[target]] = [slides[target], slides[index]];
    return { ...prev, slides };
  });

  const addSlide = () => setDeck((prev) => ({
    ...prev,
    slides: [...prev.slides, { id: `s${Date.now()}`, layout: 'bullets', title: '', bullets: [], body: '', imageRef: '', notes: '' }],
  }));

  const deleteSlide = (index) => {
    setDeck((prev) => ({ ...prev, slides: prev.slides.filter((_, i) => i !== index) }));
    setConfirmDelete(null);
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
            </div>

            {deck.slides.map((slide, i) => (
              <div key={slide.id} className={CARD} style={CARD_STYLE}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Slide {i + 1}</span>
                  <Tooltip text="How this slide is arranged: Title, Bullets, Two column, Picture or Closing.">
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
                <Tooltip text="The heading on this slide.">
                  <VoiceInput value={slide.title} onChange={(title) => updateSlide(i, { title })} label={`Title for slide ${i + 1}`} placeholder="Slide title" />
                </Tooltip>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Tooltip text="One bullet per line. On a title or picture slide this is used as supporting text.">
                    <VoiceInput type="textarea" rows={4} value={slide.bullets.join('\n')} onChange={(v) => updateSlide(i, { bullets: v.split(/\r?\n/).map((b) => b.trim()).filter(Boolean) })} label={`Bullets for slide ${i + 1}`} append placeholder={'First point\nSecond point'} />
                  </Tooltip>
                  <Tooltip text="A paragraph for this slide, where the layout uses one.">
                    <VoiceInput type="textarea" rows={4} value={slide.body} onChange={(body) => updateSlide(i, { body })} label={`Body for slide ${i + 1}`} append placeholder="Body text (optional)" />
                  </Tooltip>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Tooltip text="An image URL, an uploaded asset reference, or a data URL. Graphics handoffs can be pasted here too.">
                    <VoiceInput value={slide.imageRef} onChange={(imageRef) => updateSlide(i, { imageRef })} label={`Image for slide ${i + 1}`} placeholder="Image reference (optional)" />
                  </Tooltip>
                  <Tooltip text="Speaker notes are kept in the deck but do not appear on the slide.">
                    <VoiceInput type="textarea" rows={2} value={slide.notes} onChange={(notes) => updateSlide(i, { notes })} label={`Notes for slide ${i + 1}`} append placeholder="Notes (optional)" />
                  </Tooltip>
                </div>
                {slide.imageRef && (
                  <img src={slide.imageRef} alt={`Slide ${i + 1}`} className="max-h-40 rounded-lg border object-contain" style={{ borderColor: 'var(--color-border)' }} />
                )}
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text={`Add an empty slide (up to ${maxSlides} in a deck).`}>
                <button type="button" onClick={addSlide} disabled={deck.slides.length >= maxSlides} className={BTN_SECONDARY} style={SECONDARY_STYLE}>
                  {getIcon('plus', { size: 13 })} Add slide
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
              <Tooltip text="Make the finished files from these slides.">
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
    </section>
  );
}
