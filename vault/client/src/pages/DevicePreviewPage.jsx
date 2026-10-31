import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import EmptyState from '../components/EmptyState';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import useProcessingStore from '../store/processingStore';
import useToastStore from '../store/toastStore';
import { devicesOfKind, customScreen, CUSTOM_LIMITS } from '../utils/deviceCatalog.mjs';
import DevicePreviewTutorChat from './devicePreview/DevicePreviewTutorChat';
import { GUIDE_TOOLS, HOW_IT_WORKS } from './devicePreview/devicePreviewTools.mjs';
import { startDevicePreviewTour, TOUR_KEY as DP_TOUR_KEY } from '../utils/tours/devicePreviewTour';
import { DEFAULT_SELECTION, MAX_SCREENS, ZOOMS, buildPreviewDoc, toggleScreen, resolveScreens, cardLayout } from './devicePreview/devicePreviewModel.mjs';

// Device preview: type the address of a public page and see it at the size of real phones, tablets and monitors, side by side. It uses the same
// page loader as the Style editor (so it needs the same switch in Feature Access) but only looks: nothing is saved and nothing is changed.
const GROUPS = [
  { kind: 'phone', label: 'Phones', tip: 'Real phone screen sizes.' },
  { kind: 'tablet', label: 'Tablets', tip: 'Real tablet screen sizes.' },
  { kind: 'desktop', label: 'Laptops and monitors', tip: 'Wide screens, to check the page does not stretch too far.' },
];

const segment = (on) => ({
  padding: '4px 10px', fontSize: 12, border: '1px solid var(--color-border)',
  background: on ? 'var(--color-primary)' : 'var(--color-bg)', color: on ? '#fff' : 'var(--color-text)',
});

export default function DevicePreviewPage() {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const info = useToolInfoModal('vault_device_preview_info_seen');
  const [params, setParams] = useSearchParams();

  const [url, setUrl] = useState('');
  const [render, setRender] = useState(false);
  const [renderAvailable, setRenderAvailable] = useState(false);
  const [page, setPage] = useState(null);           // { doc, sourceUrl }
  const [error, setError] = useState('');
  const [selection, setSelection] = useState(DEFAULT_SELECTION);
  const [customs, setCustoms] = useState([]);
  const [customW, setCustomW] = useState('480');
  const [customH, setCustomH] = useState('800');
  const [landscape, setLandscape] = useState(false);
  const [zoom, setZoom] = useState('fit');

  // Settings -> Device preview Tour opens /device-preview?tour=1
  useEffect(() => {
    if (params.get('tour')) {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(startDevicePreviewTour, 300);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startTour = () => {
    try { localStorage.removeItem(DP_TOUR_KEY); } catch (_) { /* ignore */ }
    startDevicePreviewTour();
  };

  // The guide's "Open" buttons: scroll to the area that holds the control.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    document.querySelector(`[data-guide="${target ? target.tool : id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    api.get('/api/restyle/capabilities').then((r) => r.json()).then((d) => setRenderAvailable(!!d?.render)).catch(() => {});
  }, []);

  const screens = useMemo(() => resolveScreens(selection, customs), [selection, customs]);

  const toggle = (id) => {
    const r = toggleScreen(selection, id);
    if (r.refused) addToast(`Up to ${MAX_SCREENS} screens at once. Remove one first.`, 'warn');
    else setSelection(r.selection);
  };

  const addCustom = () => {
    const cs = customScreen(customW, customH);
    if (!cs) { addToast(`Sizes must be between ${CUSTOM_LIMITS.min} and ${CUSTOM_LIMITS.max} pixels.`, 'warn'); return; }
    if (customs.length >= 3) { addToast('Up to 3 custom sizes. Remove one first.', 'warn'); return; }
    const withId = { ...cs, id: `custom-${Date.now()}` };
    setCustoms((c) => [...c, withId]);
    const r = toggleScreen(selection, withId.id);
    if (r.refused) addToast(`Added to your sizes, but ${MAX_SCREENS} screens are already showing. Remove one to see it.`, 'warn');
    else setSelection(r.selection);
  };

  const removeCustom = (id) => {
    setCustoms((c) => c.filter((x) => x.id !== id));
    setSelection((s) => s.filter((x) => x !== id));
  };

  const show = async () => {
    const address = url.trim();
    if (!address) { setError('Type the address of the page first.'); return; }
    setError('');
    startProcessing(render ? 'Opening the page in a browser…' : 'Loading the page…', render ? 'This can take half a minute.' : 'Fetching the page and its style files.');
    try {
      const res = await api.post('/api/restyle/fetch-url', { url: address, render: !!render });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "We couldn't load that page.");
      setPage({ doc: buildPreviewDoc(data), sourceUrl: data.sourceUrl || address });
    } catch (e) {
      setPage(null);
      setError(e.message);
    } finally {
      stopProcessing();
    }
  };

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="p-4 sm:p-6 space-y-4 max-w-full">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Device preview</h1>
          <Tooltip text="How this works, and what it cannot do.">
            <button type="button" onClick={info.open} aria-label="How Device preview works" className="w-8 h-8 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
              {getIcon('info', { size: 16 })}
            </button>
          </Tooltip>
          <Tooltip text="Take the guided tour of Device preview.">
            <button type="button" onClick={startTour} aria-label="Take the guided tour of Device preview" className="w-8 h-8 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
              {getIcon('compass', { size: 16 })}
            </button>
          </Tooltip>
        </div>

        <section className="rounded-xl border p-4 space-y-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex flex-wrap items-start gap-2" data-guide="show" data-tour="dp-address">
            <div className="flex-1 min-w-[16rem]">
              <Tooltip text="The address of a public page, such as https://www.example.com/. You can say it with the microphone.">
                <div>
                  <VoiceInput
                    value={url}
                    onChange={setUrl}
                    parse={(t) => {
                      const joined = String(t || '').replace(/\b(dot|slash|colon|dash|hyphen|underscore)\b/gi, (w) => ({ dot: '.', slash: '/', colon: ':', dash: '-', hyphen: '-', underscore: '_' }[w.toLowerCase()])).replace(/\s+/g, '').replace(/\.+$/, '');
                      return joined ? joined.toLowerCase() : null;
                    }}
                    placeholder="https://www.example.com/"
                    label="Address of the page"
                    onKeyDown={(e) => { if (e.key === 'Enter') show(); }}
                  />
                </div>
              </Tooltip>
            </div>
            <Tooltip text="Load the page and show it on every screen chosen below.">
              <button type="button" onClick={show} className="px-4 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity duration-200" style={{ background: 'var(--color-primary)', color: '#fff', minHeight: 40 }}>
                Show the page
              </button>
            </Tooltip>
          </div>
          <Tooltip text={renderAvailable ? 'Tick this if the page comes up empty or half-built. It is opened in a real browser first so its scripts can build it. Slower, and limited to 8 an hour.' : 'Not set up on this server.'}>
            <label className="flex items-start gap-2 text-xs w-fit" style={{ color: renderAvailable ? 'var(--color-text)' : 'var(--color-muted)' }}>
              <input type="checkbox" className="mt-0.5" checked={render} disabled={!renderAvailable} onChange={(e) => setRender(e.target.checked)} />
              <span>This page builds itself with JavaScript (loads slower)</span>
            </label>
          </Tooltip>
          {error && <p role="alert" className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}

          <div className="space-y-2 pt-1" data-guide="choose-screens">
            <div className="space-y-2" data-tour="dp-devices">
            {GROUPS.map((g) => (
              <div key={g.kind}>
                <Tooltip text={g.tip}><p className="text-xs font-semibold uppercase tracking-widest mb-1 w-fit" style={{ color: 'var(--color-muted)' }}>{g.label}</p></Tooltip>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={g.label}>
                  {devicesOfKind(g.kind).map((d) => {
                    const on = selection.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => toggle(d.id)}
                        aria-pressed={on}
                        className="px-2.5 py-1 rounded-full text-xs border hover:opacity-70 transition-opacity duration-200"
                        style={{ borderColor: on ? 'var(--color-primary)' : 'var(--color-border)', background: on ? 'var(--color-primary)' : 'var(--color-bg)', color: on ? '#fff' : 'var(--color-text)' }}
                      >
                        {d.label} <span style={{ opacity: 0.75 }}>{d.width} x {d.height}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            </div>
            <div data-tour="dp-own">
              <Tooltip text="Any size you like, in pixels. Up to 3 of your own sizes."><p className="text-xs font-semibold uppercase tracking-widest mb-1 w-fit" style={{ color: 'var(--color-muted)' }}>Your own size</p></Tooltip>
              <div className="flex flex-wrap items-center gap-1.5">
                {customs.map((c) => {
                  const on = selection.includes(c.id);
                  return (
                    <span key={c.id} className="inline-flex items-center rounded-full border text-xs overflow-hidden" style={{ borderColor: on ? 'var(--color-primary)' : 'var(--color-border)' }}>
                      <button type="button" onClick={() => toggle(c.id)} aria-pressed={on} className="px-2.5 py-1 hover:opacity-70 transition-opacity duration-200" style={{ background: on ? 'var(--color-primary)' : 'var(--color-bg)', color: on ? '#fff' : 'var(--color-text)' }}>{c.width} x {c.height}</button>
                      <button type="button" onClick={() => removeCustom(c.id)} aria-label={`Remove the ${c.width} by ${c.height} size`} className="px-2 py-1 hover:opacity-70 transition-opacity duration-200" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>x</button>
                    </span>
                  );
                })}
                <input aria-label="Width in pixels" type="number" inputMode="numeric" value={customW} onChange={(e) => setCustomW(e.target.value)} className="h-8 w-20 rounded-lg border px-2 text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                <span className="text-sm" style={{ color: 'var(--color-muted)' }}>x</span>
                <input aria-label="Height in pixels" type="number" inputMode="numeric" value={customH} onChange={(e) => setCustomH(e.target.value)} className="h-8 w-20 rounded-lg border px-2 text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                <Tooltip text="Add this size to the list and show it.">
                  <button type="button" onClick={addCustom} className="px-3 h-8 rounded-lg border text-xs hover:opacity-70 transition-opacity duration-200" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}>Add</button>
                </Tooltip>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1" data-guide="turn" data-tour="dp-view">
            <Tooltip text="Hold phones and tablets on their side. Laptops and monitors are not turned.">
              <button
                type="button"
                onClick={() => setLandscape((v) => !v)}
                aria-pressed={landscape}
                aria-label={landscape ? 'Turn phones and tablets upright' : 'Turn phones and tablets on their side'}
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg border hover:opacity-70 transition-opacity duration-200"
                style={{ borderColor: 'var(--color-border)', background: landscape ? 'var(--color-primary)' : 'var(--color-bg)', color: landscape ? '#fff' : 'var(--color-text)' }}
              >
                <span style={{ display: 'inline-flex', transform: landscape ? 'rotate(90deg)' : 'none', transition: 'transform 200ms' }}>{getIcon('smartphone', { size: 16 })}</span>
              </button>
            </Tooltip>
            <div className="flex" role="group" aria-label="Size on screen">
              {ZOOMS.map((z, i) => (
                <Tooltip key={z.id} text={z.id === 'fit' ? 'Shrink each screen so it fits on the page without scrolling down.' : `Show each screen at ${z.label} of its real size.`}>
                  <button type="button" onClick={() => setZoom(z.id)} aria-pressed={zoom === z.id} className="hover:opacity-70 transition-opacity duration-200" style={{ ...segment(zoom === z.id), borderRadius: i === 0 ? '8px 0 0 8px' : i === ZOOMS.length - 1 ? '0 8px 8px 0' : 0 }}>{z.label}</button>
                </Tooltip>
              ))}
            </div>
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{screens.length} of {MAX_SCREENS} screens</span>
          </div>
        </section>

        {!page && !error && (
          <div className="rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <EmptyState icon="smartphone" title="See a page on real screens" body="Type the address of a public page and press Show the page. Choose up to four phones, tablets or monitors to compare side by side." />
          </div>
        )}

        {page && screens.length === 0 && (
          <div className="rounded-xl border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <EmptyState icon="smartphone" title="No screens chosen" body="Pick a phone, tablet or monitor above to see the page on it." />
          </div>
        )}

        {page && screens.length > 0 && (
          <div>
            <p className="text-xs mb-2 truncate" style={{ color: 'var(--color-muted)' }}>Showing {page.sourceUrl}</p>
            <div className="flex gap-4 overflow-x-auto pb-4 items-start scroll-x-obvious">
              {screens.map((d) => {
                const l = cardLayout(d, { zoom, landscape });
                return (
                  <figure key={d.id} className="flex-shrink-0 m-0">
                    <figcaption className="text-xs mb-1.5" style={{ color: 'var(--color-text)' }}>
                      <span className="font-medium">{d.label}</span> <span style={{ color: 'var(--color-muted)' }}>{l.width} x {l.height}{l.scale < 1 ? `, shown at ${Math.round(l.scale * 100)}%` : ''}</span>
                    </figcaption>
                    <div className="rounded-xl border overflow-hidden" style={{ width: l.outerWidth, height: l.outerHeight, borderColor: 'var(--color-border)', background: '#fff' }}>
                      <iframe
                        title={`${d.label} preview`}
                        sandbox="allow-same-origin"
                        srcDoc={page.doc}
                        style={{ width: l.width, height: l.height, border: 'none', background: '#fff', transform: `scale(${l.scale})`, transformOrigin: 'top left' }}
                      />
                    </div>
                  </figure>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <DevicePreviewTutorChat currentTool="show" onOpenTool={openToolById} />

      {info.show && (
        <ToolInfoModal title="How Device preview Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            See how a public web page looks at the size of real phones, tablets and monitors, side by side. It does not change the page or save anything.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p style={{ color: 'var(--color-text)' }}><strong>1. Type the address</strong> of a public page and press Show the page.</p>
            <p style={{ color: 'var(--color-text)' }}><strong>2. Choose screens.</strong> Tap up to four devices, or add your own width and height.</p>
            <p style={{ color: 'var(--color-text)' }}><strong>3. Compare.</strong> Turn phones and tablets on their side, or change how big each one is drawn.</p>
          </div>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Sizes are the screen's width and height in CSS pixels, which is what a page's own layout rules respond to. A real phone also has browser bars that use some of the height, so treat the height as close, not exact. The page is shown without its scripts (menus that open and sliders will not work), and pages that need a login cannot be loaded. To change a page's styling, use the Style editor.
          </p>
        </ToolInfoModal>
      )}
    </VoiceInputProvider>
  );
}
