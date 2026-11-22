import React, { useEffect, useState } from 'react';
import Tooltip from '../../../components/Tooltip';
import { VoiceInput } from '../../../components/voiceInput/VoiceInput';
import { takeToolHandoff } from '../../../utils/toolHandoff.mjs';
import PresentationPreview from '../PresentationPreview';
import {
  CARD_STYLE, FIELD_STYLE, LAYOUTS, DeckHandoff, Notice, ToolHeader, readDeckFile, usePresentations,
} from '../shared';

export default function SlideEditor() {
  const { deck, setDeck, meta, saveDeck, openTool, toast } = usePresentations();
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
      <ToolHeader id="slides" title="Slide editor" blurb="Everything here is the canonical deck: the preview and every export render from this one model." />

      {deck.slides.length === 0 ? (
        <div className="rounded-2xl border p-6 space-y-3" style={CARD_STYLE}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>There are no slides in this deck yet.</p>
          <Tooltip text="Write a brief and generate a first draft to edit here.">
            <button type="button" onClick={() => openTool('create')} className="px-4 py-2 rounded-xl text-sm font-medium hover:opacity-80 transition-opacity" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>Create a deck</button>
          </Tooltip>
        </div>
      ) : (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start gap-4">
          <div className="space-y-4">
            <div className="rounded-2xl border p-4 space-y-3" style={CARD_STYLE}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Deck details</h3>
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
              <div key={slide.id} className="rounded-2xl border p-4 space-y-3" style={CARD_STYLE}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Slide {i + 1}</span>
                  <Tooltip text="How this slide is arranged by the renderer.">
                    <select
                      value={slide.layout}
                      onChange={(e) => updateSlide(i, { layout: e.target.value })}
                      className="text-xs px-2 py-1 rounded-lg border"
                      style={FIELD_STYLE}
                      aria-label={`Layout for slide ${i + 1}`}
                    >
                      {LAYOUTS.map((layout) => <option key={layout} value={layout}>{layout}</option>)}
                    </select>
                  </Tooltip>
                  <span className="flex-1" />
                  <Tooltip text="Move this slide earlier.">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 disabled:opacity-30" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>↑</button>
                  </Tooltip>
                  <Tooltip text="Move this slide later.">
                    <button type="button" onClick={() => move(i, 1)} disabled={i === deck.slides.length - 1} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 disabled:opacity-30" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>↓</button>
                  </Tooltip>
                  {confirmDelete === i ? (
                    <>
                      <button type="button" onClick={() => deleteSlide(i)} className="text-xs px-2 py-1 rounded-lg" style={{ color: '#991b1b' }}>Delete</button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="text-xs px-2 py-1 rounded-lg" style={{ color: 'var(--color-muted)' }}>Cancel</button>
                    </>
                  ) : (
                    <Tooltip text="Remove this slide from the deck.">
                      <button type="button" onClick={() => setConfirmDelete(i)} className="text-xs px-2 py-1 rounded-lg hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Delete</button>
                    </Tooltip>
                  )}
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
                <button type="button" onClick={addSlide} disabled={deck.slides.length >= maxSlides} className="px-3 py-2 rounded-xl text-xs font-medium border hover:opacity-70 disabled:opacity-40 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>+ Add slide</button>
              </Tooltip>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{deck.slides.length}/{maxSlides} slides</span>
            </div>

            <div className="rounded-2xl border p-4 flex flex-wrap items-center gap-2" style={CARD_STYLE}>
              <Tooltip text={meta?.brandKit ? 'Update the saved deck with these edits.' : 'Save this deck so you can find it again in My decks.'}>
                <button type="button" onClick={() => saveDeck().catch((err) => toast(err.message || 'Could not save the deck.', 'error'))} className="px-4 py-2 rounded-xl text-sm font-medium hover:opacity-80 transition-opacity" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>Save deck</button>
              </Tooltip>
              <DeckHandoff deck={deck} />
              <Tooltip text="Make the finished files from these slides.">
                <button type="button" onClick={() => openTool('export')} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Export →</button>
              </Tooltip>
            </div>
          </div>

          <div className="space-y-2">
            <Tooltip text="Show or hide the HTML preview of the current deck.">
              <button type="button" onClick={() => setShowPreview((v) => !v)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
                {showPreview ? 'Hide preview' : 'Show preview'}
              </button>
            </Tooltip>
            {showPreview && <PresentationPreview deck={deck} compact />}
            <Notice>Click Refresh in the preview after an edit if it has not caught up yet.</Notice>
          </div>
        </div>
      )}
    </section>
  );
}
