import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import {
  DEFAULT_HALF_LIFE, DEFAULT_PERCENTS, SIGNAL_FIELDS, feedLines, fromPercents, parseFeedLines, percentTotal, spendLine, toPercents,
} from './format.mjs';

const CARD = 'rounded-2xl border p-6 space-y-4';
const LABEL = 'block text-sm font-medium mb-1';

// Site profile and feed list. The profile is what later milestones tell the research brief about your site; the feeds are what a search reads now.
export default function SettingsPanel({ onSaved }) {
  const addToast = useToastStore((s) => s.addToast);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [niche, setNiche] = useState('');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState('');
  const [region, setRegion] = useState('AU');
  const [feeds, setFeeds] = useState('');
  const [serpProvider, setSerpProvider] = useState('none');
  const [sources, setSources] = useState(null); // [{ id, label, enabled, reason }]
  const [pct, setPct] = useState(Object.fromEntries(Object.entries(DEFAULT_PERCENTS).map(([k, v]) => [k, String(v)])));
  const [halfLife, setHalfLife] = useState(String(DEFAULT_HALF_LIFE));
  const [outlets, setOutlets] = useState([]); // [{ domain, weight (text), note }]
  const [budget, setBudget] = useState('20'); // the monthly limit as typed; 0 = no limit
  const [usage, setUsage] = useState(null); // this month's spend: { spentUsd, searchUsd, briefUsd, limitUsd, over, pricesSet }

  const resetRanking = () => { setPct(Object.fromEntries(Object.entries(DEFAULT_PERCENTS).map(([k, v]) => [k, String(v)]))); setHalfLife(String(DEFAULT_HALF_LIFE)); };
  const setOutlet = (i, patch) => setOutlets((cur) => cur.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const loadUsage = async () => {
    try {
      const r = await api.get('/api/topic-research/usage');
      const d = await r.json();
      if (r.ok) setUsage(d.usage);
    } catch { /* the box simply stays empty */ }
  };

  const loadSources = async () => {
    try {
      const r = await api.get('/api/topic-research/sources');
      const d = await r.json();
      if (r.ok) setSources(d.sources);
    } catch { /* the box simply stays empty */ }
  };

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await api.get('/api/topic-research/settings');
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not load your settings.');
        if (!live) return;
        const s = d.settings;
        setNiche(s.niche); setAudience(s.audience); setTone(s.tone); setRegion(s.region); setFeeds(feedLines(s.feeds)); setSerpProvider(s.serpProvider);
        setPct(toPercents(s.scoringWeights)); setHalfLife(String(s.halfLifeHours)); setBudget(String(s.monthlyBudgetUsd));
        loadUsage();
        const w = await api.get('/api/topic-research/source-weights');
        const wd = await w.json();
        if (w.ok && live) setOutlets(wd.weights.map((o) => ({ domain: o.domain, weight: String(o.weight), note: o.note || '' })));
        loadSources();
      } catch (e) { if (live) setError(e.message || 'Could not reach the server.'); } finally { if (live) setLoaded(true); }
    })();
    return () => { live = false; };
  }, []);

  const save = async () => {
    setSaving(true); setError('');
    try {
      const r = await api.put('/api/topic-research/settings', {
        niche, audience, tone, region, serpProvider, feeds: parseFeedLines(feeds), scoringWeights: fromPercents(pct), halfLifeHours: Number(halfLife), monthlyBudgetUsd: budget.trim() === '' ? undefined : Number(budget),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save.');
      setFeeds(feedLines(d.settings.feeds)); setRegion(d.settings.region); setBudget(String(d.settings.monthlyBudgetUsd));
      const rows = outlets.filter((o) => o.domain.trim()).map((o) => ({ domain: o.domain, weight: o.weight === '' ? undefined : Number(o.weight), note: o.note }));
      const w = await api.put('/api/topic-research/source-weights', { weights: rows });
      const wd = await w.json();
      if (!w.ok) throw new Error(wd.error || 'Could not save the outlet list.');
      setOutlets(wd.weights.map((o) => ({ domain: o.domain, weight: String(o.weight), note: o.note || '' })));
      addToast('Settings saved', 'success');
      loadSources(); loadUsage();
      onSaved?.();
    } catch (e) { setError(e.message || 'Could not reach the server.'); } finally { setSaving(false); }
  };

  if (!loaded) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;

  const surface = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
  const text = { color: 'var(--color-text)' };
  const muted = { color: 'var(--color-muted)' };

  return (
    <div className="space-y-5">
      <div className={CARD} style={surface} data-guide="spending">
        <h2 className="text-base font-semibold" style={text}>Spending this month</h2>
        {usage && (
          <>
            <p className="text-sm font-medium" style={usage.over ? { color: '#ef4444' } : text} role="status">{spendLine(usage)}</p>
            <p className="text-sm" style={muted}>
              Searches about <strong>${usage.searchUsd.toFixed(2)}</strong> · briefs about <strong>${usage.briefUsd.toFixed(2)}</strong> · drafts about <strong>${(usage.draftUsd || 0).toFixed(2)}</strong>. These are estimates, counted for this calendar month (UTC).
            </p>
          </>
        )}
        <div>
          <label className={LABEL} style={text} htmlFor="tr-budget">Monthly limit (US dollars)</label>
          <input
            id="tr-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} aria-label="Monthly spending limit in US dollars"
            title="When this month's estimated spend reaches this, paid searches, new briefs and drafts pause. 0 means no limit."
            className="px-3 py-2.5 rounded-xl border text-sm outline-none w-32" maxLength={8}
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
          <p className="text-xs mt-1" style={muted}>0 means no limit. When it is reached, paid search sources, new briefs and drafts pause; free sources and old results carry on.</p>
        </div>
        {usage && !usage.pricesSet && (
          <p className="text-xs leading-relaxed" style={muted}>
            Paid search prices are not set on the server yet, so searches count as free here and only briefs add to the total. Real search charges are on your provider&apos;s own bill.
          </p>
        )}
      </div>

      <div className={CARD} style={surface} data-guide="feeds">
        <h2 className="text-base font-semibold" style={text}>RSS feeds</h2>
        <p className="text-sm leading-relaxed" style={muted}>
          A search reads these feeds and keeps the items that mention every word of your topic. Put one feed address per line. Use feeds from the sites you want to watch
          (most news and trade sites have one: look for an RSS link, or try adding /feed to the site address).
        </p>
        <VoiceInput
          type="textarea" append rows={8} value={feeds} onChange={setFeeds} label="RSS feed addresses, one per line"
          placeholder={'https://www.abc.net.au/news/feed/51120/rss.xml\nhttps://www.example.com/feed'}
          spellCheck={false} autoCapitalize="none"
        />
      </div>

      <div className={CARD} style={surface}>
        <h2 className="text-base font-semibold" style={text}>Where a search looks</h2>
        <p className="text-sm leading-relaxed" style={muted}>
          Sources that need a key stay off until the key is added on the server. Saving the feed list above refreshes this list.
        </p>
        {sources === null && <p className="text-sm" style={muted}>Checking…</p>}
        <ul className="space-y-2">
          {(sources || []).map((s) => (
            <li key={s.id} className="flex items-start gap-2 text-sm">
              <span
                className="mt-0.5 shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded"
                style={{ color: s.enabled ? '#16a34a' : 'var(--color-muted)', border: `1px solid ${s.enabled ? '#16a34a' : 'var(--color-border)'}` }}
              >{s.enabled ? 'On' : 'Off'}</span>
              <span className="min-w-0">
                <span className="font-medium" style={text}>{s.label}</span>
                {!s.enabled && s.reason && <span className="block text-xs leading-relaxed break-words" style={muted}>{s.reason}</span>}
              </span>
            </li>
          ))}
        </ul>
        <div>
          <label className={LABEL} style={text} htmlFor="tr-serp">Google results provider</label>
          <select
            id="tr-serp" value={serpProvider} onChange={(e) => setSerpProvider(e.target.value)}
            className="px-3 py-2.5 rounded-xl border text-sm outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            <option value="none">None chosen</option>
            <option value="serper">Serper</option>
            <option value="serpapi" disabled>SerpAPI (not built yet)</option>
            <option value="dataforseo" disabled>DataForSEO (not built yet)</option>
          </select>
          <p className="text-xs mt-1" style={muted}>Gives each result&apos;s Google position plus the &quot;People also ask&quot; questions. Needs the provider&apos;s key on the server (SERP_API_KEY); if the workspace already has a Serper key (SERPER_SEARCH_API_KEY, used by the other search tools), choosing Serper here uses it. Each search then costs a little, and it is only used once you choose it.</p>
        </div>
      </div>

      <div className={CARD} style={surface}>
        <h2 className="text-base font-semibold" style={text}>How results are ranked</h2>
        <p className="text-sm leading-relaxed" style={muted}>
          Each article gets a score out of 100 from six things. A page that looks like a shop (a product or a list of products) has its score cut to 40%. Say how much each one matters to you. Only the proportions count: they are scaled to add up to 100%.
          A thing that has no information in a search (for example search rank when no Google or Brave results are on) is left out of that search and the rest count for more.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {SIGNAL_FIELDS.map((f) => (
            <div key={f.id}>
              <label className={LABEL} style={text} htmlFor={`tr-w-${f.id}`}>{f.label}</label>
              <div className="flex items-center gap-2">
                <input
                  id={`tr-w-${f.id}`} type="number" min="0" max="100" step="1" inputMode="numeric" value={pct[f.id]} onChange={(e) => setPct((c) => ({ ...c, [f.id]: e.target.value }))}
                  className="px-3 py-2.5 rounded-xl border text-sm outline-none w-24" aria-label={`${f.label} weight in percent`}
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <span className="text-sm" style={muted}>%</span>
              </div>
              <p className="text-xs mt-1" style={muted}>{f.tip}</p>
            </div>
          ))}
        </div>
        <p className="text-sm" style={percentTotal(pct) === 100 ? muted : { color: '#b45309' }} role="status">
          Total {percentTotal(pct)}%{percentTotal(pct) === 100 ? '' : ' (that is fine, the weights are scaled to 100%)'}
        </p>
        <div>
          <label className={LABEL} style={text} htmlFor="tr-halflife">How fast news goes stale</label>
          <div className="flex items-center gap-2">
            <input
              id="tr-halflife" type="number" min="1" max="720" step="1" inputMode="numeric" value={halfLife} onChange={(e) => setHalfLife(e.target.value)}
              className="px-3 py-2.5 rounded-xl border text-sm outline-none w-24"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            <span className="text-sm" style={muted}>hours</span>
          </div>
          <p className="text-xs mt-1" style={muted}>An article this many hours old counts half as fresh as one published just now. An article with no date counts as middling.</p>
        </div>
        <button type="button" onClick={resetRanking} className="text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>Put these back to the usual settings</button>
      </div>

      <div className={CARD} style={surface}>
        <h2 className="text-base font-semibold" style={text}>Outlets you trust more or less</h2>
        <p className="text-sm leading-relaxed" style={muted}>
          Give a site a weight from 0 (do not count it for much) to 1 (the most trusted). A site not in the list counts as 0.5. A weight for abc.net.au also covers news.abc.net.au unless that one is listed too.
        </p>
        {outlets.length === 0 && <p className="text-sm" style={muted}>No outlets listed yet.</p>}
        <div className="space-y-2">
          {outlets.map((o, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                value={o.domain} onChange={(e) => setOutlet(i, { domain: e.target.value })} placeholder="abc.net.au" aria-label="Site name" autoCapitalize="none" spellCheck={false}
                className="px-3 py-2 rounded-xl border text-sm outline-none flex-1 min-w-[10rem]"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <input
                type="number" min="0" max="1" step="0.1" inputMode="decimal" value={o.weight} onChange={(e) => setOutlet(i, { weight: e.target.value })} aria-label={`Weight for ${o.domain || 'this site'}, 0 to 1`}
                className="px-3 py-2 rounded-xl border text-sm outline-none w-20"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <input
                value={o.note} onChange={(e) => setOutlet(i, { note: e.target.value })} placeholder="Note (optional)" aria-label="Note" maxLength={100}
                className="px-3 py-2 rounded-xl border text-sm outline-none flex-1 min-w-[8rem]"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <button type="button" aria-label={`Remove ${o.domain || 'this site'}`} onClick={() => setOutlets((cur) => cur.filter((_, j) => j !== i))} className="text-sm hover:opacity-70 transition-opacity" style={muted}>Remove</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setOutlets((cur) => [...cur, { domain: '', weight: '0.5', note: '' }])} className="text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>+ Add an outlet</button>
      </div>

      <div className={CARD} style={surface}>
        <h2 className="text-base font-semibold" style={text}>Your site</h2>
        <p className="text-sm leading-relaxed" style={muted}>Used later to shape the suggested angles and outline. Nothing here is sent anywhere yet.</p>
        <div>
          <label className={LABEL} style={text}>What your site is about</label>
          <VoiceInput value={niche} onChange={setNiche} placeholder="e.g. home energy and heating for Queensland households" label="What your site is about" />
        </div>
        <div>
          <label className={LABEL} style={text}>Who reads it</label>
          <VoiceInput value={audience} onChange={setAudience} placeholder="e.g. homeowners deciding on an upgrade" label="Who reads your site" />
        </div>
        <div>
          <label className={LABEL} style={text}>Tone</label>
          <VoiceInput value={tone} onChange={setTone} placeholder="e.g. plain, practical, no hype" label="Tone of your writing" />
        </div>
        <div>
          <label className={LABEL} style={text}>Region</label>
          <input
            className="px-3 py-2.5 rounded-xl border text-sm outline-none w-24 uppercase" maxLength={2} aria-label="Region code"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            value={region} onChange={(e) => setRegion(e.target.value)}
          />
          <p className="text-xs mt-1" style={muted}>Two-letter country code, for example AU.</p>
        </div>
      </div>

      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
      <button
        type="button" onClick={save} disabled={saving}
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40"
        style={{ background: 'var(--color-primary)', color: '#fff' }}
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}
