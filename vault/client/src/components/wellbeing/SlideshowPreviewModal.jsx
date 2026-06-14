import React, { useEffect, useMemo, useState } from 'react';

function buildSlides(slideshow) {
  if (!slideshow) return [];
  if (Array.isArray(slideshow.slides) && slideshow.slides.length) {
    return slideshow.slides.map((slide) => ({
      type: slide.type || 'content',
      title: slide.title || 'Wellbeing takeaways',
      subtitle: slide.subtitle || 'Takeaway points',
      bullets: Array.isArray(slide.bullets) ? slide.bullets : [],
      chartItems: Array.isArray(slide.chartItems) ? slide.chartItems : [],
    }));
  }
  const modules = Array.isArray(slideshow.modules) ? slideshow.modules : [];
  return [
    {
      type: 'title',
      title: slideshow.title || 'Wellbeing Takeaway Slideshow',
      subtitle: slideshow.subtitle || '',
      bullets: [...modules.map(module => module.title), 'Final overall report'].filter(Boolean),
    },
    ...modules.map(module => ({
      type: 'module',
      title: module.title || 'Module takeaways',
      subtitle: 'Module takeaway points',
      bullets: Array.isArray(module.takeaways) ? module.takeaways : [],
    })),
    {
      type: 'final',
      title: slideshow.final?.title || 'Final overall report',
      subtitle: 'Final report takeaway points',
      bullets: Array.isArray(slideshow.final?.takeaways) ? slideshow.final.takeaways : [],
    },
  ];
}

export default function SlideshowPreviewModal({
  open,
  slideshow,
  loading = false,
  error = '',
  onClose,
  onDownload,
  downloading = false,
}) {
  const slides = useMemo(() => buildSlides(slideshow), [slideshow]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
  }, [slideshow]);
  if (!open) return null;

  const safeIndex = Math.min(index, Math.max(slides.length - 1, 0));
  const slide = slides[safeIndex];
  const canNavigate = slides.length > 1;

  const goPrevious = () => setIndex(value => Math.max(0, value - 1));
  const goNext = () => setIndex(value => Math.min(slides.length - 1, value + 1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.58)' }}>
      <div className="w-full max-w-5xl rounded-3xl border shadow-2xl overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: 'var(--color-muted)' }}>Slideshow preview</p>
            <h2 className="text-base font-semibold mt-1" style={{ color: 'var(--color-text)' }}>
              {slideshow?.title || 'Wellbeing takeaway slideshow'}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onDownload}
              disabled={downloading || loading || !!error || !slides.length}
              className="px-3 py-2 rounded-xl text-sm font-semibold border disabled:opacity-50 hover:opacity-80"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-bg)' }}
            >
              {downloading ? 'Preparing PPTX...' : 'Download PPTX'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}
            >
              Close
            </button>
          </div>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="rounded-2xl border p-10 text-center" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <div className="mx-auto h-10 w-10 rounded-full border-4 border-t-transparent animate-spin mb-4" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Preparing slideshow preview...</p>
              <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>This uses saved report text when available and fallback takeaway points from the completed scores.</p>
            </div>
          ) : error ? (
            <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: '#fecaca', background: '#fff1f2', color: '#991b1b' }}>
              {error}
            </div>
          ) : slide ? (
            <>
              <div className="aspect-video rounded-3xl border p-8 sm:p-10 flex flex-col" style={{ borderColor: '#e5d8ca', background: '#f7f3ee' }}>
                <p className="text-xs uppercase tracking-widest font-semibold mb-3" style={{ color: '#6b7280' }}>
                  {slide.subtitle || (slide.type === 'title' ? 'Overview' : 'Takeaways')}
                </p>
                <h3 className="text-2xl sm:text-4xl font-semibold leading-tight" style={{ color: '#8a5a2b' }}>{slide.title}</h3>
                {slide.type === 'chart' ? (
                  <div className="grid gap-2 mt-5">
                    {(slide.chartItems || []).slice(0, 12).map((item, idx) => {
                      const value = Math.max(0, Math.min(1, Number(item.value) || 0));
                      return (
                        <div key={`${safeIndex}-chart-${idx}`} className="grid grid-cols-[minmax(120px,220px)_1fr_56px] items-center gap-3 text-xs sm:text-sm">
                          <span className="truncate" style={{ color: '#1f2937' }}>{item.label}</span>
                          <span className="h-3 rounded-full overflow-hidden" style={{ background: '#e8ded3' }}>
                            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, value * 100)}%`, background: '#8a5a2b' }} />
                          </span>
                          <span className="text-right tabular-nums" style={{ color: '#6b7280' }}>{item.valueLabel || `${Math.round(value * 100)}%`}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid gap-3 mt-6">
                    {(slide.bullets || []).slice(0, 6).map((bullet, idx) => (
                      <div key={`${safeIndex}-${idx}`} className="rounded-2xl border px-4 py-3 text-sm sm:text-base" style={{ borderColor: '#e5d8ca', background: '#fff', color: '#1f2937' }}>
                        {bullet}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-auto flex items-center justify-between pt-6 text-xs" style={{ color: '#6b7280' }}>
                  <span>Proof-of-concept self-report summary. Not clinical advice.</span>
                  <span>{safeIndex + 1}/{slides.length}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                <button
                  type="button"
                  onClick={goPrevious}
                  disabled={!canNavigate || safeIndex === 0}
                  className="px-3 py-2 rounded-xl text-sm font-semibold border disabled:opacity-40 hover:opacity-80"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
                >
                  Previous
                </button>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {slides.map((_, dotIdx) => (
                    <button
                      key={dotIdx}
                      type="button"
                      aria-label={`Go to slide ${dotIdx + 1}`}
                      onClick={() => setIndex(dotIdx)}
                      className="h-2.5 rounded-full transition-all"
                      style={{
                        width: dotIdx === safeIndex ? 22 : 10,
                        background: dotIdx === safeIndex ? 'var(--color-primary)' : 'var(--color-border)',
                      }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canNavigate || safeIndex === slides.length - 1}
                  className="px-3 py-2 rounded-xl text-sm font-semibold border disabled:opacity-40 hover:opacity-80"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
              No slideshow slides are available yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
