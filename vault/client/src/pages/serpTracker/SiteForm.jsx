import React, { useEffect, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import api from '../../utils/apiClient';

// SERP Tracker, Site setup: the form for ONE site (a client's website). Controlled by the page; this only draws it. See docs/serp-tracker.md.

const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const CARD = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const labelCls = 'block text-xs font-medium mb-1';
const muted = { color: 'var(--color-muted)' };
const input = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none';

// What DataForSEO will really search from for the typed place (a free check), so the label shows the real place and not just the typed text.
function useLocationCheck(name) {
  const [info, setInfo] = useState(null); // null = checking, { found, code, name, type, unavailable }
  useEffect(() => {
    let live = true;
    setInfo(null);
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/api/serp-tracker/location-check?name=${encodeURIComponent(name || '')}`);
        const data = await res.json();
        if (live) setInfo(res.ok ? data : { found: false, unavailable: true });
      } catch { if (live) setInfo({ found: false, unavailable: true }); }
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [name]);
  return info;
}

function searchingAs(info, form) {
  const site = form.searchDomain || 'google.com.au';
  const lang = form.languageCode || 'en';
  if (!info) return `Checking the place…`;
  if (info.found) return `Searching as: ${info.name} (${info.type.toLowerCase()}, place ${info.code}) · ${site} · language ${lang}`;
  if (info.unavailable) return `Searching as: "${form.locationName}" (could not be checked just now) · ${site} · language ${lang}`;
  return `"${form.locationName}" is not a place DataForSEO knows. Use the exact form, for example "Bowen Hills,Queensland,Australia". Searches will fail until it is fixed.`;
}

export default function SiteForm({ form, set, toggleDevice, errors, saving, onSave, isNew, savedAt, clients, clientId, onClientChange, clientName }) {
  const locInfo = useLocationCheck(form.locationName);
  return (
    <section className="rounded-2xl border p-6 space-y-4" style={CARD} aria-labelledby="serp-site-title">
      <h2 id="serp-site-title" className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{isNew ? 'New site' : 'Your site'}</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div data-guide="site-name">
          <label htmlFor="serp-name" className={labelCls} style={muted}>Name (optional)</label>
          <Tooltip text="What you call this site, for example the client's name. It is what the site switcher shows. If you leave it empty the web address is shown.">
            <input id="serp-name" value={form.name} onChange={set('name')} maxLength={80} placeholder="Acme Wines" className={input} style={FIELD} />
          </Tooltip>
        </div>
        <div data-guide="client-link">
          <label htmlFor="serp-client" className={labelCls} style={muted}>CRM client (optional)</label>
          <Tooltip text="Links this site to one of your clients in the CRM, so you can tell whose site it is. It changes nothing else. If the client is deleted from the CRM the link is simply removed.">
            <select id="serp-client" value={clientId ?? ''} onChange={(e) => onClientChange(e.target.value === '' ? null : Number(e.target.value))} className={input} style={FIELD}>
              <option value="">No client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>)}
              {clientId != null && !clients.some((c) => c.id === clientId) && <option value={clientId}>{clientName || 'Linked client'}</option>}
            </select>
          </Tooltip>
        </div>
      </div>

      <div data-guide="site-address">
        <label htmlFor="serp-domain" className={labelCls} style={muted}>Site address</label>
        <Tooltip text="The site you want to track, for example www.wiwc.com.au. Any www or https:// is tidied up for you. You can track each address once.">
          <input id="serp-domain" value={form.domain} onChange={set('domain')} placeholder="www.example.com.au" className={input} style={FIELD} />
        </Tooltip>
      </div>

      <div data-guide="brand-names">
        <label htmlFor="serp-brand" className={labelCls} style={muted}>Brand names (one per line)</label>
        <Tooltip text="Words people type when they are looking for you by name. Used later to split searches into branded and non-branded.">
          <textarea id="serp-brand" rows={3} value={form.brandTermsText} onChange={set('brandTermsText')} className={input} style={FIELD} />
        </Tooltip>
      </div>

      <div data-guide="keywords">
        <label htmlFor="serp-keywords" className={labelCls} style={muted}>Keywords to track (one per line; add the page you want to rank after a | )</label>
        <Tooltip text="One search per line, for example: walk in wine cabinets | https://www.example.com.au/cabinets/ . The page after the bar is optional.">
          <textarea id="serp-keywords" rows={8} value={form.keywordsText} onChange={set('keywordsText')} className={`${input} font-mono`} style={FIELD} />
        </Tooltip>
      </div>

      <div data-guide="competitors">
        <label htmlFor="serp-competitors" className={labelCls} style={muted}>Competitors (one per line; pages to watch after a | , separated by commas)</label>
        <Tooltip text="A competitor's site, then optionally the pages whose wording you want saved each week, for example: rival.com.au | https://rival.com.au/page-a/, https://rival.com.au/page-b/">
          <textarea id="serp-competitors" rows={5} value={form.competitorsText} onChange={set('competitorsText')} className={`${input} font-mono`} style={FIELD} />
        </Tooltip>
      </div>

      <div data-guide="health-urls">
        <label htmlFor="serp-health" className={labelCls} style={muted}>Pages of yours to health-check each day (one per line)</label>
        <Tooltip text="Pages checked every day for redirects, errors and changed canonical addresses, so a ranking drop can be read alongside them.">
          <textarea id="serp-health" rows={3} value={form.healthText} onChange={set('healthText')} className={`${input} font-mono`} style={FIELD} />
        </Tooltip>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-guide="location-depth">
        <div>
          <label htmlFor="serp-location" className={labelCls} style={muted}>Where Google is asked from</label>
          <Tooltip text='The place the search is made from. "Australia" gives national results; a city such as "Brisbane,Queensland,Australia" gives local ones. Lookups for this site use it.'>
            <input id="serp-location" value={form.locationName} onChange={set('locationName')} className={input} style={FIELD} />
          </Tooltip>
        </div>
        <div>
          <label htmlFor="serp-depth" className={labelCls} style={muted}>Results to request (10 to 100)</label>
          <Tooltip text="How deep into Google's results the daily check will look, once it collects rankings. Deeper costs more. (A Lookup chooses its own depth.)">
            <input id="serp-depth" type="number" min={10} max={100} step={10} value={form.serpDepth} onChange={set('serpDepth')} className={input} style={FIELD} />
          </Tooltip>
        </div>
        <div>
          <label htmlFor="serp-lang" className={labelCls} style={muted}>Language</label>
          <input id="serp-lang" value={form.languageCode} onChange={set('languageCode')} className={input} style={FIELD} />
        </div>
        <div>
          <label htmlFor="serp-searchdomain" className={labelCls} style={muted}>Google site (the index searched)</label>
          <Tooltip text='The Google website the search is made on. "google.com.au" is the Australian index. Lookups for this site use it.'>
            <input id="serp-searchdomain" value={form.searchDomain} onChange={set('searchDomain')} placeholder="google.com.au" className={input} style={FIELD} />
          </Tooltip>
        </div>
        <p className="sm:col-span-2 text-xs" role="status" aria-live="polite" data-guide="searching-as" style={{ color: locInfo && !locInfo.found && !locInfo.unavailable ? '#ef4444' : 'var(--color-muted)' }}>
          {searchingAs(locInfo, form)}
        </p>
        <div>
          <label htmlFor="serp-tz" className={labelCls} style={muted}>Your time zone</label>
          <Tooltip text="Reports group days, and weekly tasks run on Mondays, in this time zone.">
            <input id="serp-tz" value={form.timezone} onChange={set('timezone')} className={input} style={FIELD} />
          </Tooltip>
        </div>
      </div>

      <fieldset data-guide="devices">
        <legend className={labelCls} style={muted}>Devices</legend>
        <div className="flex gap-4">
          {['desktop', 'mobile'].map((d) => (
            <label key={d} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={form.devices.includes(d)} onChange={() => toggleDevice(d)} />
              {d === 'desktop' ? 'Desktop' : 'Mobile'}
            </label>
          ))}
        </div>
      </fieldset>

      {errors.length > 0 && (
        <div role="alert" className="rounded-xl border p-3 text-sm space-y-1" style={{ background: '#fff1f2', borderColor: '#fca5a5', color: '#991b1b' }}>
          {errors.map((e) => <p key={e}>{e}</p>)}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Tooltip text={isNew ? 'Adds this site. Nothing is collected or charged by saving.' : 'Saves these details. Nothing is collected or charged by saving.'}>
          <button type="button" onClick={onSave} disabled={saving} data-guide="save-site"
            className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
            style={{ background: 'var(--color-primary)', color: '#fff' }}>
            {saving ? 'Saving…' : isNew ? 'Add site' : 'Save site details'}
          </button>
        </Tooltip>
        {savedAt && <span className="text-xs" style={muted}>Saved {when(savedAt)}</span>}
      </div>
    </section>
  );
}
