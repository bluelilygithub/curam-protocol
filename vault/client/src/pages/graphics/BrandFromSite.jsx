import React, { useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import { useIcon } from '../../providers/IconProvider';
import { VoiceInput, VoiceInputProvider } from '../../components/voiceInput/VoiceInput';
import { defaultUse, useIsEmpty, applyBody, summaryOfChanged, roleList, logoLabel, radiusCss, fontSummary } from './brandSiteLogic.mjs';

// "Get from a website" inside the Graphics Brand Kit window: paste an address, see what the site's colours, fonts, corners and logo
// are, tick what to use, press Use selected. The server does the reading and the saving (docs/brand-from-url.md); nothing is saved
// until Use selected. `onApplied` reloads the kit in the page afterwards.

const SAMPLE_PREFIX = 'brandsample';

function Check({ checked, onChange, label, tip, disabled }) {
  return (
    <Tooltip text={tip}>
      <label className={`flex items-center gap-2 text-xs ${disabled ? 'opacity-50' : 'cursor-pointer'}`} style={{ color: 'var(--color-text)' }}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    </Tooltip>
  );
}

function BrandFromSiteInner({ onApplied }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [url, setUrl] = useState('');
  const [brand, setBrand] = useState(null);
  const [use, setUse] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [samples, setSamples] = useState({ heading: null, body: null }); // CSS family names of the loaded sample fonts
  const faces = useRef([]);
  const alive = useRef(true);

  const dropSamples = () => {
    for (const f of faces.current) { try { document.fonts.delete(f); } catch { /* already gone */ } }
    faces.current = [];
    setSamples({ heading: null, body: null });
  };
  // alive is switched back on when the effect runs again: React's development double-mount runs the cleanup once before the real mount
  useEffect(() => { alive.current = true; return () => { alive.current = false; dropSamples(); }; }, []);

  // load the downloaded font files of a reading so the sample text is drawn in them
  const loadSamples = async (b) => {
    const out = { heading: null, body: null };
    for (const role of ['heading', 'body']) {
      if (!b.fonts?.[role]?.file) continue;
      try {
        const res = await api.get(`/api/graphics/brand-from-url/${b.id}/font/${role}`);
        if (!res.ok) continue;
        const face = new FontFace(`${SAMPLE_PREFIX}-${role}-${b.id.slice(0, 8)}`, await res.arrayBuffer());
        await face.load();
        document.fonts.add(face);
        faces.current.push(face);
        out[role] = face.family;
      } catch { /* the sample falls back to a stand-in font; the file itself is untouched */ }
    }
    if (alive.current) setSamples(out);
  };

  const read = async () => {
    const address = url.trim();
    if (!address || busy) return;
    setError('');
    setBusy(true);
    dropSamples();
    const ctrl = new AbortController();
    const store = useProcessingStore.getState();
    store.startProcessing('Reading the website…', 'Opening the page and looking at its colours, fonts and logo. This can take up to a minute.', {
      steps: ['Opening the page', 'Reading colours, fonts and logo', 'Preparing the fonts'],
      onCancel: () => ctrl.abort(),
    });
    const timers = [setTimeout(() => useProcessingStore.getState().advanceProcessingStep(), 7000), setTimeout(() => useProcessingStore.getState().advanceProcessingStep(), 16000)];
    try {
      const res = await api.post('/api/graphics/brand-from-url', { url: address }, { signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not read that website.');
      if (!alive.current) return;
      setBrand(data);
      setUse(defaultUse(data));
      loadSamples(data);
    } catch (err) {
      if (err.name === 'AbortError') setError('Cancelled. Nothing was read.');
      else setError(err.message || 'Could not read that website.');
    } finally {
      timers.forEach(clearTimeout);
      useProcessingStore.getState().stopProcessing();
      if (alive.current) setBusy(false);
    }
  };

  const apply = async () => {
    if (!brand || !use || useIsEmpty(use) || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/api/graphics/brand-from-url/${brand.id}/apply`, applyBody(use));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the brand.');
      addToast(summaryOfChanged(data.changed), 'success');
      dropSamples();
      setBrand(null);
      setUse(null);
      setUrl('');
      await onApplied?.();
    } catch (err) {
      setError(err.message || 'Could not save the brand.');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const set = (patch) => setUse((u) => ({ ...u, ...patch }));
  const colours = brand ? roleList(brand.colours) : [];
  const h = brand?.fonts?.heading;
  const b = brand?.fonts?.body;

  return (
    <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div className="flex items-center gap-2">
        <span style={{ color: 'var(--color-muted)' }}>{getIcon('globe', { size: 15 })}</span>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Get from a website</h3>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
        Paste a website address. Vault opens the page, reads its colours, fonts, corner style and logo, and shows them here. Nothing is saved until you press <strong>Use selected</strong>.
      </p>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <VoiceInput
            value={url}
            onChange={setUrl}
            label="Website address"
            placeholder="e.g. www.example.com"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); read(); } }}
            disabled={busy}
          />
        </div>
        <Tooltip text="Open this website in a browser on the server and read its colours, fonts, corner style and logo. Takes 10 to 30 seconds.">
          <button type="button" onClick={read} disabled={busy || !url.trim()} className="flex-shrink-0 px-3.5 py-2.5 rounded-xl text-sm font-medium text-white transition-opacity duration-200 hover:opacity-70 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
            {brand ? 'Read again' : 'Read'}
          </button>
        </Tooltip>
      </div>

      {error && <p role="alert" className="text-xs rounded-lg px-3 py-2" style={{ background: '#fff1f2', color: '#991b1b' }}>{error}</p>}

      {brand && use && (
        <div className="space-y-4">
          <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Read <strong style={{ color: 'var(--color-text)' }}>{brand.title || brand.finalUrl}</strong>
            {brand.siteName && brand.siteName !== brand.title ? ` (${brand.siteName})` : ''}. Tick what to use.
          </div>

          {colours.length > 0 && (
            <section className="space-y-2">
              <Check checked={use.colours} onChange={(v) => set({ colours: v })} label="Colours" tip="Use these colours: the main and accent colour become your brand swatches in Text Overlay, Watermark and Composite, and the whole set is kept in the Brand Kit." />
              <div className="grid grid-cols-4 gap-2">
                {colours.map((c) => (
                  <div key={c.key} className="text-center">
                    <div className="h-9 rounded-lg border" title={`${c.label} ${c.hex}`} style={{ background: c.hex, borderColor: 'var(--color-border)' }} />
                    <div className="text-[11px] mt-1 leading-tight" style={{ color: 'var(--color-text)' }}>{c.label}</div>
                    <div className="text-[10px] leading-tight" style={{ color: 'var(--color-muted)' }}>{c.hex}</div>
                  </div>
                ))}
              </div>
              {brand.dark && <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>This site also has a dark look ({brand.dark.background} with {brand.dark.text} text); it is kept too.</p>}
            </section>
          )}

          {Number.isFinite(brand.radius?.px) && (
            <section className="flex items-center gap-3">
              <Check checked={use.radius} onChange={(v) => set({ radius: v })} label={`Corners: ${brand.radius.label}`} tip="Keep this corner style in the Brand Kit." />
              <div className="h-7 w-16 border-2" style={{ borderRadius: radiusCss(brand.radius), borderColor: brand.colours?.primary || 'var(--color-primary)' }} />
            </section>
          )}

          {(h || b) && (
            <section className="space-y-3">
              {[['heading', 'Heading font', h], ['body', 'Body font', b]].map(([role, title, f]) => f && (
                <div key={role} className="space-y-1">
                  <Check
                    checked={use[role]}
                    onChange={(v) => set({ [role]: v })}
                    label={title}
                    tip={f.file ? 'Keep this font file in your Brand Kit so Graphics tools can draw text in it.' : 'Only the name of this font can be kept. It replaces the font name in your Brand Kit.'}
                  />
                  <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{fontSummary(f)}</div>
                  <div className="rounded-lg border px-3 py-2 text-lg leading-snug" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontFamily: samples[role] ? `"${samples[role]}", sans-serif` : `"${f.family}", sans-serif` }}>
                    {role === 'heading' ? 'A heading in this font' : 'Body text reads like this, in this font.'}
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="space-y-2">
            <div className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Logo</div>
            {brand.logos?.length ? (
              <div className="flex flex-wrap gap-2">
                {brand.logos.map((l, i) => (
                  <Tooltip key={i} text={`${logoLabel(l.kind)}${l.width ? ` (${l.width} × ${l.height})` : ''}. Click to use it as your Brand Kit logo.`}>
                    <button type="button" onClick={() => set({ logo: i })} aria-pressed={use.logo === i} className="rounded-lg border p-1.5 transition-opacity duration-200 hover:opacity-70" style={{ borderColor: use.logo === i ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-surface)', borderWidth: use.logo === i ? 2 : 1 }}>
                      <img src={l.dataUrl} alt={logoLabel(l.kind)} className="h-12 max-w-[7rem] object-contain" />
                      <div className="text-[10px] mt-1" style={{ color: 'var(--color-muted)' }}>{logoLabel(l.kind)}</div>
                    </button>
                  </Tooltip>
                ))}
                <Tooltip text="Do not change the logo in your Brand Kit.">
                  <button type="button" onClick={() => set({ logo: null })} aria-pressed={use.logo === null} className="rounded-lg border px-3 text-xs transition-opacity duration-200 hover:opacity-70" style={{ borderColor: use.logo === null ? 'var(--color-primary)' : 'var(--color-border)', borderWidth: use.logo === null ? 2 : 1, background: 'var(--color-surface)', color: 'var(--color-text)' }}>
                    Keep my logo
                  </button>
                </Tooltip>
              </div>
            ) : (
              <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>No logo was found on the page. Upload one below.</p>
            )}
          </section>

          {brand.warnings?.length > 0 && (
            <ul className="space-y-1 text-[11px] rounded-lg px-3 py-2" style={{ background: '#fef3c7', color: '#b45309' }}>
              {brand.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            These are read from a public website for your own use. They are not official brand assets.
          </p>

          <div className="flex items-center justify-end">
            <Tooltip text={useIsEmpty(use) ? 'Tick at least one thing to use.' : 'Save the ticked things into your Brand Kit. Anything not ticked stays as it is.'}>
              <button type="button" onClick={apply} disabled={busy || useIsEmpty(use)} className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity duration-200 hover:opacity-70 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
                {busy ? 'Saving…' : 'Use selected'}
              </button>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BrandFromSite(props) {
  // the address box has a microphone like every text field; the Brand Kit window sits outside any voice provider
  return (
    <VoiceInputProvider lang="en-AU">
      <BrandFromSiteInner {...props} />
    </VoiceInputProvider>
  );
}
