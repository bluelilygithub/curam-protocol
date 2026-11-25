import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import EmptyState from '../../components/EmptyState';
import Skeleton from '../../components/Skeleton';
import Dialog from '../../components/Dialog';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import useToastStore from '../../store/toastStore';
import { devicesOfKind, deviceById } from '../../utils/deviceCatalog.mjs';
import {
  DEFAULT_SCREEN_IDS, MAX_COUNTRY_SCREENS, MAX_COUNTRIES, parseSpokenAddress, formatMb, formatCost, estimateLine,
  captureLabel, gridOf, screensForRun, toggleId,
} from './countriesModel.mjs';

// Device preview → Countries (docs/geo-check.md): the page as visitors in several countries see it, captured in a real browser through a
// residential proxy in each country. A check runs in the background on the server; this view starts it, follows it, and shows the pictures.
// The address box is the same one as the Screens view (url / setUrl come from the page).

const KINDS = [
  { kind: 'phone', label: 'Phones' },
  { kind: 'tablet', label: 'Tablets' },
  { kind: 'desktop', label: 'Laptops and monitors' },
];
const TONE = { ok: '#16a34a', warn: '#b45309', bad: '#ef4444' };
const card = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
const chip = (on) => ({
  borderColor: on ? 'var(--color-primary)' : 'var(--color-border)',
  background: on ? 'var(--color-primary)' : 'var(--color-bg)', color: on ? 'var(--color-on-primary)' : 'var(--color-text)',
});
const btnSecondary = 'px-3 h-8 rounded-lg border text-xs hover:opacity-70 transition-opacity duration-200';
const btnSecondaryStyle = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };

/** A picture from an owner-only route: fetched with the sign-in, shown from a local object address. */
function CaptureImage({ runId, captureId, alt, style, className }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url = null;
    let cancelled = false;
    api.get(`/api/geo-check/runs/${runId}/captures/${captureId}/image`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => { if (blob && !cancelled) { url = URL.createObjectURL(blob); setSrc(url); } })
      .catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [runId, captureId]);
  if (!src) return <div className={className} style={{ ...style, background: 'var(--color-bg)' }} aria-label={`${alt} (loading)`} />;
  return <img src={src} alt={alt} className={className} style={style} />;
}

function Badge({ capture }) {
  const l = captureLabel(capture);
  return <span className="text-xs font-medium" style={{ color: TONE[l.tone] }}>{l.text}</span>;
}

export default function CountriesView({ url, setUrl, config, countryName, onConfigChange }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);

  const [countries, setCountries] = useState(config.countries);
  const [screenIds, setScreenIds] = useState(DEFAULT_SCREEN_IDS);
  const [allowMedia, setAllowMedia] = useState(false);
  const [label, setLabel] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [runs, setRuns] = useState(null);           // null = loading
  const [run, setRun] = useState(null);             // the open run, with captures
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [zoomed, setZoomed] = useState(null);       // { capture, other }

  const devices = screenIds.map(deviceById).filter(Boolean);
  const pictures = countries.length * devices.length;
  const tooMany = pictures > config.maxCaptures;
  const running = run && run.status === 'running';

  const loadRuns = useCallback(async () => {
    try {
      const r = await api.get('/api/geo-check/runs');
      const d = await r.json();
      setRuns(r.ok ? d.runs : []);
      return r.ok ? d.runs : [];
    } catch { setRuns([]); return []; }
  }, []);

  const openRun = useCallback(async (id) => {
    try {
      const r = await api.get(`/api/geo-check/runs/${id}`);
      if (!r.ok) throw new Error('gone');
      setRun(await r.json());
    } catch { addToast('That country check could not be opened.', 'error'); }
  }, [addToast]);

  // On arrival, open the newest check (a running one first), so "your country check is ready" lands on it.
  useEffect(() => {
    loadRuns().then((list) => { if (list.length) openRun((list.find((x) => x.status === 'running') || list[0]).id); });
  }, [loadRuns, openRun]);

  // Follow a running check every 2 seconds until it ends.
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(async () => {
      try {
        const r = await api.get(`/api/geo-check/runs/${run.id}`);
        if (!r.ok) return;
        const next = await r.json();
        setRun(next);
        if (next.status !== 'running') {
          loadRuns();
          onConfigChange();
          addToast(next.status === 'done' ? 'Country check finished ✓' : `Country check ${next.status}.`, next.status === 'done' ? 'success' : 'warn');
        }
      } catch { /* try again next tick */ }
    }, 2000);
    return () => clearInterval(t);
  }, [running, run && run.id, loadRuns, onConfigChange, addToast]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleScreen = (id) => {
    const r = toggleId(screenIds, id);
    if (r.refused) addToast(`Up to ${MAX_COUNTRY_SCREENS} screens. Remove one first.`, 'warn');
    else setScreenIds(r.list);
  };

  const addCountry = (code) => {
    if (!code || countries.includes(code)) return;
    if (countries.length >= MAX_COUNTRIES) { addToast(`Up to ${MAX_COUNTRIES} countries. Remove one first.`, 'warn'); return; }
    setCountries([...countries, code]);
  };

  const saveCountries = async () => {
    try {
      const r = await api.put('/api/geo-check/countries', { countries });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      addToast('Saved as your country list ✓', 'success');
      onConfigChange();
    } catch (e) { addToast(e.message || 'Your list could not be saved.', 'error'); }
  };

  const start = async () => {
    if (!url.trim()) { setError('Type the address of the page first.'); return; }
    setError('');
    setStarting(true);
    try {
      const r = await api.post('/api/geo-check/runs', { url: url.trim(), label: label.trim(), countries, screens: screensForRun(devices), allowMedia });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'The check could not start.');
      setLabel('');
      await openRun(d.id);
      loadRuns();
    } catch (e) { setError(e.message); } finally { setStarting(false); }
  };

  const stop = async () => {
    await api.post(`/api/geo-check/runs/${run.id}/stop`).catch(() => null);
    addToast('Stopping after the countries already under way…', 'info');
  };

  const remove = async (item) => {
    setConfirmDelete(null);
    try {
      const r = await api.delete(`/api/geo-check/runs/${item.id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setRuns((cur) => cur.filter((x) => x.id !== item.id));
      if (run && run.id === item.id) setRun(null);
      addToast('Country check deleted. Kept 30 days in the recycle bin.', 'success', undefined, {
        label: 'Undo',
        onClick: async () => {
          const res = await api.post(`/api/recycle-bin/${d.binId}/restore`).catch(() => null);
          if (res?.ok) { loadRuns(); addToast('Country check restored ✓', 'success'); } else addToast('That could not be restored. Look in Settings → Recycle bin.', 'error');
        },
      });
    } catch (e) { addToast(e.message || 'That country check could not be deleted.', 'error'); }
  };

  const grid = useMemo(() => gridOf(run), [run]);
  const others = useMemo(() => (run ? run.captures.filter((c) => c.hasImage) : []), [run]);

  if (!config.configured) {
    return (
      <div className="rounded-xl border" style={card}>
        <EmptyState icon="globe" title="Countries is not set up yet" body="It needs a proxy service that lets Vault open pages from other countries. An admin adds its details on the server; then you can check a page from up to twelve countries at once." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-4">
        <section className="rounded-xl border p-4 space-y-3" style={card} data-guide="countries-setup" data-tour="dp-countries">
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex-1 min-w-[16rem]">
              <Tooltip text="The address of a public page, such as https://www.example.com/. You can say it with the microphone.">
                <div>
                  <VoiceInput value={url} onChange={setUrl} parse={parseSpokenAddress} placeholder="https://www.example.com/" label="Address of the page" onKeyDown={(e) => { if (e.key === 'Enter' && !running && !tooMany) start(); }} />
                </div>
              </Tooltip>
            </div>
          </div>
          <Tooltip text="Optional: a name to find this check again, such as 'before release 4.2'. You can say it with the microphone.">
            <div>
              <VoiceInput value={label} onChange={setLabel} placeholder="Name for this check (optional)" label="Name for this check" />
            </div>
          </Tooltip>

          <div>
            <Tooltip text="The countries to show the page from. Each one is opened through an internet connection in that country, in its language and time zone.">
              <p className="text-xs font-semibold uppercase tracking-widest mb-1 w-fit" style={{ color: 'var(--color-muted)' }}>Countries</p>
            </Tooltip>
            <div className="flex flex-wrap items-center gap-1.5">
              {countries.map((code) => (
                <span key={code} className="inline-flex items-center rounded-full border text-xs overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                  <span className="px-2.5 py-1" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}><strong>{code}</strong> {countryName(code)}</span>
                  <Tooltip text={`Remove ${countryName(code)} from this check.`}>
                    <button type="button" onClick={() => setCountries(countries.filter((c) => c !== code))} aria-label={`Remove ${countryName(code)}`} className="px-2 py-1 hover:opacity-70 transition-opacity duration-200" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>x</button>
                  </Tooltip>
                </span>
              ))}
              <Tooltip text="Add another country to this check.">
                <select aria-label="Add a country" value="" onChange={(e) => addCountry(e.target.value)} className="h-8 rounded-lg border px-2 text-xs" style={btnSecondaryStyle}>
                  <option value="">Add a country…</option>
                  {config.catalogue.filter((c) => !countries.includes(c.code)).map((c) => <option key={c.code} value={c.code}>{c.code} {c.name}</option>)}
                </select>
              </Tooltip>
              <Tooltip text="Use these countries every time you open Countries.">
                <button type="button" onClick={saveCountries} disabled={!countries.length} className={btnSecondary} style={btnSecondaryStyle}>Save as my list</button>
              </Tooltip>
            </div>
          </div>

          <div className="space-y-2" data-tour="dp-country-screens">
            {KINDS.map((g) => (
              <div key={g.kind}>
                <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>{g.label}</p>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={g.label}>
                  {devicesOfKind(g.kind).map((d) => {
                    const on = screenIds.includes(d.id);
                    return (
                      <Tooltip key={d.id} text={`${on ? 'Remove' : 'Add'} ${d.label} (${d.width} x ${d.height}). Up to ${MAX_COUNTRY_SCREENS} screens.`}>
                        <button type="button" onClick={() => toggleScreen(d.id)} aria-pressed={on} className="px-2.5 py-1 rounded-full text-xs border hover:opacity-70 transition-opacity duration-200" style={chip(on)}>
                          {d.label} <span style={{ opacity: 0.75 }}>{d.width} x {d.height}</span>
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <Tooltip text="Videos and sound are skipped to save proxy traffic (it is paid by the amount downloaded). Tick to load them too.">
            <label className="flex items-start gap-2 text-xs w-fit" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" className="mt-0.5" checked={allowMedia} onChange={(e) => setAllowMedia(e.target.checked)} />
              <span>Load video and sound (uses more traffic)</span>
            </label>
          </Tooltip>

          <p className="text-xs" style={{ color: tooMany ? '#ef4444' : 'var(--color-muted)' }}>
            {estimateLine({ countries: countries.length, screens: devices.length, bytesPerCountry: config.bytesPerCountry, costPerGb: config.costPerGb })}
            {tooMany ? `. The most in one check is ${config.maxCaptures} pictures.` : ''}
          </p>
          {error && <p role="alert" className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
          <Tooltip text={running ? 'A check is already running.' : 'Start the check. It runs on the server, so you can leave this page; it shows under Needs attention when it is ready.'}>
            <button type="button" onClick={start} disabled={starting || running || tooMany || !countries.length || !devices.length}
              className="px-4 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity duration-200 disabled:opacity-50"
              style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)', minHeight: 40 }}>
              {starting ? 'Starting…' : 'Check these countries'}
            </button>
          </Tooltip>
        </section>

        <section className="rounded-xl border p-4 space-y-2" style={card} data-guide="countries-saved" data-tour="dp-country-saved">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Saved checks</h2>
          {runs === null && <Skeleton lines={4} label="Loading saved checks" />}
          {runs && runs.length === 0 && <EmptyState icon="globe" title="No country checks yet" body="Your checks are kept here so you can compare before and after a release." />}
          {runs && runs.length > 0 && (
            <ul className="space-y-1.5 max-h-[32rem] overflow-y-auto">
              {runs.map((r) => (
                <li key={r.id} className="group flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: run && run.id === r.id ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <Tooltip text="Open this check.">
                    <button type="button" onClick={() => openRun(r.id)} className="flex-1 min-w-0 text-left hover:opacity-70 transition-opacity duration-200">
                      <span className="block text-sm truncate" style={{ color: 'var(--color-text)' }}>{r.label || r.url}</span>
                      <span className="block text-xs truncate" style={{ color: 'var(--color-muted)' }}>
                        {new Date(r.createdAt).toLocaleString()} · {(r.settings.countries || []).join(' ')} · {r.status === 'done' ? formatMb(r.bytesTotal) : r.status}
                        {r.label ? ` · ${r.url}` : ''}
                      </span>
                    </button>
                  </Tooltip>
                  {confirmDelete === r.id ? (
                    <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                      Delete?
                      <button type="button" onClick={() => remove(r)} className="font-medium hover:opacity-70 transition-opacity duration-200" style={{ color: '#ef4444' }}>Yes</button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>No</button>
                    </span>
                  ) : r.status !== 'running' && (
                    <Tooltip text="Delete this check (kept 30 days in the recycle bin).">
                      <button type="button" onClick={() => setConfirmDelete(r.id)} aria-label={`Delete the check of ${r.label || r.url}`} className="opacity-0 group-hover:opacity-70 hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
                        {getIcon('trash', { size: 14 })}
                      </button>
                    </Tooltip>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {run && (
        <section className="rounded-xl border p-4 space-y-3" style={card} data-guide="countries-result" data-tour="dp-country-result">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{run.label || 'Country check'}</h2>
            <span className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>
              {run.url} · {new Date(run.createdAt).toLocaleString()} · {formatMb(run.bytesTotal)}{config.costPerGb ? `, ${formatCost(run.bytesTotal, config.costPerGb)}` : ''}
            </span>
          </div>

          {running && (
            <div role="status" className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <div className="flex items-center gap-3">
                <span className="text-sm flex-1" style={{ color: 'var(--color-text)' }}>{run.stage || 'Starting'} · {run.capturesDone} of {run.capturesTotal} pictures</span>
                <Tooltip text="Stop the check. The countries already done are kept.">
                  <button type="button" onClick={stop} className={btnSecondary} style={btnSecondaryStyle}>Stop</button>
                </Tooltip>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                <div className="h-full transition-all duration-200" style={{ width: `${Math.max(3, run.progress)}%`, background: 'var(--color-primary)' }} />
              </div>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>You can leave this page; the check carries on and shows under Needs attention when it is ready.</p>
            </div>
          )}
          {!running && run.errorMessage && (
            <p role="status" className="text-sm" style={{ color: run.status === 'failed' ? '#ef4444' : '#b45309' }}>{run.errorMessage}</p>
          )}

          <div className="overflow-x-auto scroll-x-obvious">
            <table className="w-full border-separate" style={{ borderSpacing: 8 }}>
              <thead>
                <tr>
                  <th className="text-left text-xs font-semibold" style={{ color: 'var(--color-muted)', width: '8rem' }}>Country</th>
                  {grid.screens.map((s) => (
                    <th key={s.id} className="text-left text-xs font-semibold" style={{ color: 'var(--color-muted)', minWidth: s.mobile ? 180 : 280 }}>
                      {s.label} <span style={{ fontWeight: 400 }}>{s.width} x {s.height}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.country}>
                    <th scope="row" className="text-left align-top text-sm font-normal" style={{ color: 'var(--color-text)' }}>
                      <strong>{row.country}</strong><br /><span className="text-xs" style={{ color: 'var(--color-muted)' }}>{countryName(row.country)}</span>
                    </th>
                    {row.cells.map((c, i) => (
                      <td key={grid.screens[i].id} className="align-top">
                        {!c && <div className="rounded-lg border text-xs p-3" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>{running ? 'Waiting…' : 'Not captured.'}</div>}
                        {c && (
                          <div className="space-y-1">
                            {c.hasImage ? (
                              <Tooltip text="Open full size, and compare it with another picture side by side.">
                                <button type="button" onClick={() => setZoomed({ capture: c, other: null })} className="block w-full rounded-lg border overflow-hidden hover:opacity-80 transition-opacity duration-200" style={{ borderColor: 'var(--color-border)', background: '#fff' }} aria-label={`Open ${countryName(c.country)} on ${grid.screens[i].label} full size`}>
                                  <CaptureImage runId={run.id} captureId={c.id} alt={`${countryName(c.country)} on ${grid.screens[i].label}`} className="w-full block"
                                    style={{ aspectRatio: `${c.width} / ${Math.min(c.height, c.width * 2)}`, objectFit: 'cover', objectPosition: 'top' }} />
                                </button>
                              </Tooltip>
                            ) : (
                              <div className="rounded-lg border text-xs p-3" style={{ borderColor: 'var(--color-border)', color: '#ef4444' }}>{c.error || 'No picture.'}</div>
                            )}
                            <Badge capture={c} />
                            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                              {c.status === 'blocked' ? 'The site showed a refusal or robot check. ' : ''}
                              {c.finalUrl && c.finalUrl !== run.url ? `Went to ${c.finalUrl}. ` : ''}
                              {c.htmlLang ? `Language ${c.htmlLang}. ` : ''}
                              {c.bytes ? `${formatMb(c.bytes)}. ` : ''}
                              {c.cut ? 'Cut at 8,000 pixels tall.' : ''}
                            </p>
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {zoomed && (
        <CompareDialog run={run} zoomed={zoomed} setZoomed={setZoomed} others={others} countryName={countryName} screenLabel={(id) => (grid.screens.find((s) => s.id === id) || {}).label || id} />
      )}
    </div>
  );
}

/** Full size, with an optional second picture beside it; the two scroll together. */
function CompareDialog({ run, zoomed, setZoomed, others, countryName, screenLabel }) {
  const left = useRef(null);
  const right = useRef(null);
  const syncing = useRef(false);
  const name = (c) => `${c.country} ${countryName(c.country)}, ${screenLabel(c.deviceId)}`;
  const sync = (from, to) => () => {
    if (syncing.current || !from.current || !to.current) { syncing.current = false; return; }
    syncing.current = true;
    const f = from.current;
    const ratio = f.scrollTop / Math.max(1, f.scrollHeight - f.clientHeight);
    to.current.scrollTop = ratio * (to.current.scrollHeight - to.current.clientHeight);
  };
  const pane = (c, ref, onScroll) => (
    <div className="flex-1 min-w-0 space-y-1">
      <p className="text-xs" style={{ color: 'var(--color-text)' }}><strong>{name(c)}</strong> · <Badge capture={c} /></p>
      <div ref={ref} onScroll={onScroll} className="overflow-auto rounded-lg border" style={{ maxHeight: '72vh', borderColor: 'var(--color-border)', background: '#fff' }}>
        <CaptureImage runId={run.id} captureId={c.id} alt={name(c)} className="block max-w-none" style={{ width: c.width }} />
      </div>
    </div>
  );
  return (
    <Dialog title="Full size" onClose={() => setZoomed(null)} size="2xl" panelClassName="!max-w-[min(1700px,96vw)] w-[96vw]">
      <div className="space-y-3">
        <Tooltip text="Pick another picture to show beside this one. Both scroll together.">
          <select aria-label="Compare with" value={zoomed.other ? zoomed.other.id : ''} onChange={(e) => setZoomed({ ...zoomed, other: others.find((o) => String(o.id) === e.target.value) || null })}
            className="h-8 rounded-lg border px-2 text-xs" style={btnSecondaryStyle}>
            <option value="">Compare with…</option>
            {others.filter((o) => o.id !== zoomed.capture.id).map((o) => <option key={o.id} value={o.id}>{name(o)}</option>)}
          </select>
        </Tooltip>
        <div className="flex gap-3">
          {pane(zoomed.capture, left, sync(left, right))}
          {zoomed.other && pane(zoomed.other, right, sync(right, left))}
        </div>
      </div>
    </Dialog>
  );
}
