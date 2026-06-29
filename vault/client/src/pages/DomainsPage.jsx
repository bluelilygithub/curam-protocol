import React, { useState, useCallback } from 'react';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';
import useProcessingStore from '../store/processingStore';

// ── Tool metadata ─────────────────────────────────────────────────────────────

const TOOL_HELP = {
  suggest: {
    title: 'Name Generator',
    description: 'Describe your business or paste keywords — get AI-powered domain name ideas with live availability across 1,500+ TLDs.',
    features: ['AI suggestions based on your description', 'Checks .com, .io, .ai, .co, .app and more', 'Shows availability status per TLD', 'Filters to available names only'],
  },
  score: {
    title: 'Name Scorer',
    description: 'Paste a domain name you\'re considering. Get a quality score covering memorability, spelling difficulty, length, international readability, and brandability.',
    features: ['Overall brand quality score', 'Memorability and pronounceability ratings', 'Spelling difficulty assessment', 'International readability signal', 'Length and structure analysis'],
  },
  compare: {
    title: 'Compare Names',
    description: 'Enter 2–5 brand name candidates and rank them head-to-head across all scoring dimensions. Useful for shortlisting from a brainstorm.',
    features: ['Side-by-side scoring of up to 5 names', 'Ranked leaderboard output', 'Per-dimension breakdown', 'Exportable for stakeholder review'],
  },
  typos: {
    title: 'Typo Variants',
    description: 'Given your chosen domain, find all typo variants that exist — misspellings, missing letters, transpositions, and homoglyphs. See which are registered (brand protection risk) and which are available.',
    features: ['Common keyboard typos', 'Missing / doubled letters', 'Transposition variants', 'Availability status for each variant', 'Flags registered variants as risk'],
  },
  availability: {
    title: 'Availability Check',
    description: 'Check a name across multiple TLDs simultaneously. Useful when you\'re settled on a name and want to see the full TLD landscape.',
    features: ['Checks 1,500+ TLDs', 'Shows price per TLD', 'Highlights premium domains', 'Available for registration links'],
  },
  overview: {
    title: 'Domain Profile',
    description: 'Full intelligence report on any existing domain — registration history, WHOIS data, lifecycle phase, domain age, reputation signals, and DNS snapshot.',
    features: ['WHOIS registration details', 'Domain age and creation date', 'Lifecycle phase (active, expiring, redemption…)', 'Reputation and trust signals', 'Historical WHOIS changes'],
  },
  competitor: {
    title: 'Competitor Intel',
    description: 'Enter a competitor\'s domain and see their infrastructure — other domains they own, TLD strategy, hosting provider, tech stack, subdomains, and when they registered.',
    features: ['Associated domains and TLD strategy', 'Hosting and CDN detection', 'Tech stack fingerprint', 'Subdomain discovery', 'Registration timeline'],
  },
  value: {
    title: 'Domain Valuation',
    description: 'Estimate the aftermarket value of any domain algorithmically — useful if you\'re considering buying a premium or expired domain and want a price anchor.',
    features: ['Algorithmic market value estimate', 'Value drivers explained (length, TLD, keywords)', 'Comparable sales context', 'Aftermarket listing detection'],
  },
  social: {
    title: 'Social Handles',
    description: 'Check if your brand name is free on Instagram, X (Twitter), TikTok, LinkedIn, YouTube, GitHub, and more — all in one call.',
    features: ['Checks 10+ major platforms simultaneously', 'Available / taken / unknown status per platform', 'Username normalisation (handles special chars)', 'Results in seconds'],
  },
  brandlaunch: {
    title: 'Brand Launch Bundle',
    description: 'A pre-flight checklist that combines domain availability, social handles, typo threats, and health checks into one comprehensive report. Run this before you launch.',
    features: ['Domain availability across key TLDs', 'Social handle availability', 'Typosquatting threat scan', 'Domain health and DNS check', 'Single credit-efficient API call'],
  },
  pricing: {
    title: 'Registrar Pricing',
    description: 'Compare registration and renewal prices for a TLD across major registrars — Namecheap, GoDaddy, Cloudflare, Google Domains, and more.',
    features: ['Registration vs renewal price comparison', 'Lists all major registrars', 'Highlights cheapest renewal (renewal trap check)', 'ICANN fee breakdown'],
  },
  watchlist: {
    title: 'Expiry Watcher',
    description: 'Add domains to your watchlist and monitor when they\'re about to expire or become available. Useful for catching a competitor\'s lapsed domain or one you\'ve been eyeing.',
    features: ['Add / remove domains from watchlist', 'View expiring domains at a glance', 'Alerts when a watched domain becomes available', 'Tracks registration renewal dates'],
  },
  brandmonitor: {
    title: 'Copycat Detector',
    description: 'Monitor for newly registered domains that look like yours — typosquatters, phishing lookalikes, and brand impersonators. Run a scan or set up ongoing monitoring.',
    features: ['Scans for lookalike domain registrations', 'Detects typosquatting and homoglyph attacks', 'Ongoing brand monitor (set and forget)', 'Returns threat severity per variant'],
  },
};

const MODE_GROUPS = [
  {
    label: 'Discover',
    icon: 'sparkles',
    modes: ['suggest', 'score', 'compare', 'typos', 'availability'],
  },
  {
    label: 'Research',
    icon: 'search',
    modes: ['overview', 'competitor', 'value'],
  },
  {
    label: 'Launch Readiness',
    icon: 'shield-check',
    modes: ['social', 'brandlaunch', 'pricing'],
  },
  {
    label: 'Monitor',
    icon: 'eye',
    modes: ['watchlist', 'brandmonitor'],
  },
];

const MODE_LABELS = {
  suggest: 'Name Generator',
  score: 'Name Scorer',
  compare: 'Compare Names',
  typos: 'Typo Variants',
  availability: 'Availability Check',
  overview: 'Domain Profile',
  competitor: 'Competitor Intel',
  value: 'Domain Valuation',
  social: 'Social Handles',
  brandlaunch: 'Brand Launch Bundle',
  pricing: 'Registrar Pricing',
  watchlist: 'Expiry Watcher',
  brandmonitor: 'Copycat Detector',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function HelpModal({ tool, onClose }) {
  const help = TOOL_HELP[tool];
  if (!help) return null;
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-6 max-w-md w-full mx-4 shadow-xl"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-semibold text-base" style={{ color: 'var(--color-text)' }}>{help.title}</h3>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }} className="hover:opacity-60 transition-opacity flex-shrink-0">✕</button>
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>{help.description}</p>
        {help.features?.length > 0 && (
          <ul className="space-y-1.5">
            {help.features.map(f => (
              <li key={f} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                <span style={{ color: 'var(--color-primary)', flexShrink: 0 }}>•</span>
                {f}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ErrMsg({ msg }) {
  if (!msg) return null;
  return (
    <p className="text-sm mt-3 px-3 py-2 rounded-lg" style={{ background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca' }}>
      {msg}
    </p>
  );
}

function RunBtn({ onClick, busy, label = 'Run', disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity"
      style={{ background: 'var(--color-primary)', color: '#fff', opacity: busy || disabled ? 0.5 : 1 }}
    >
      {busy ? 'Running…' : label}
    </button>
  );
}

function DomainInput({ value, onChange, placeholder = 'e.g. example.com', label }) {
  return (
    <div>
      {label && <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>{label}</label>}
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
      />
    </div>
  );
}

function ResultCard({ data }) {
  if (!data) return null;
  return (
    <div
      className="mt-4 rounded-xl p-4 text-sm overflow-auto max-h-[60vh]"
      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
    >
      <pre className="whitespace-pre-wrap break-words text-xs" style={{ fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

// Renders DomScan results in a human-readable way where possible
function SmartResult({ mode, data }) {
  if (!data) return null;

  // Suggestions
  if (mode === 'suggest' && data.suggestions) {
    return (
      <div className="mt-4 space-y-2">
        {data.suggestions.map((s, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
            <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{s.domain || s.name}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
              background: s.available ? '#dcfce7' : '#fef2f2',
              color: s.available ? '#16a34a' : '#dc2626',
            }}>
              {s.available ? 'Available' : 'Taken'}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Score
  if (mode === 'score' && (data.score !== undefined || data.total !== undefined)) {
    const score = data.score ?? data.total;
    const breakdown = data.breakdown || data.scores || {};
    return (
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-4 px-4 py-3 rounded-xl" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <div className="text-4xl font-bold" style={{ color: 'var(--color-primary)' }}>{score}</div>
          <div>
            <div className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>Overall Brand Score</div>
            <div className="text-xs" style={{ color: 'var(--color-muted)' }}>out of 100</div>
          </div>
        </div>
        {Object.keys(breakdown).length > 0 && (
          <div className="space-y-1.5">
            {Object.entries(breakdown).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-3 py-1.5 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                <span className="text-xs capitalize" style={{ color: 'var(--color-muted)' }}>{k.replace(/_/g, ' ')}</span>
                <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{typeof v === 'number' ? v : String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Compare
  if (mode === 'compare' && (data.rankings || data.results || data.comparison)) {
    const list = data.rankings || data.results || data.comparison || [];
    return (
      <div className="mt-4 space-y-2">
        {list.map((item, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
            <span className="text-sm font-bold w-5 text-center" style={{ color: 'var(--color-primary)' }}>#{i + 1}</span>
            <span className="flex-1 font-medium text-sm" style={{ color: 'var(--color-text)' }}>{item.domain || item.name}</span>
            <span className="text-sm font-medium" style={{ color: 'var(--color-muted)' }}>{item.score ?? item.total ?? ''}</span>
          </div>
        ))}
      </div>
    );
  }

  // Availability
  if (mode === 'availability' && data.results) {
    return (
      <div className="mt-4 space-y-2">
        {data.results.map((r, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
            <span className="font-mono text-sm" style={{ color: 'var(--color-text)' }}>{r.domain}</span>
            <div className="flex items-center gap-2">
              {r.price && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{r.price}</span>}
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
                background: r.available ? '#dcfce7' : '#fef2f2',
                color: r.available ? '#16a34a' : '#dc2626',
              }}>
                {r.available ? 'Available' : 'Taken'}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Typos
  if (mode === 'typos' && (data.typos || data.variants || data.results)) {
    const variants = data.typos || data.variants || data.results || [];
    const registered = variants.filter(v => !v.available);
    const available = variants.filter(v => v.available);
    return (
      <div className="mt-4 space-y-3">
        {registered.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1.5" style={{ color: '#dc2626' }}>⚠ Registered ({registered.length}) — brand protection risk</p>
            <div className="space-y-1">
              {registered.map((v, i) => (
                <div key={i} className="px-3 py-1.5 rounded-lg text-sm font-mono" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                  {v.domain || v.name}
                </div>
              ))}
            </div>
          </div>
        )}
        {available.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-muted)' }}>Available variants ({available.length})</p>
            <div className="space-y-1">
              {available.slice(0, 20).map((v, i) => (
                <div key={i} className="px-3 py-1.5 rounded-lg text-sm font-mono" style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                  {v.domain || v.name}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Social handles
  if (mode === 'social' && (data.platforms || data.handles || data.results)) {
    const platforms = data.platforms || data.handles || data.results || {};
    const entries = Array.isArray(platforms)
      ? platforms
      : Object.entries(platforms).map(([k, v]) => ({ platform: k, ...(typeof v === 'object' ? v : { available: v }) }));
    return (
      <div className="mt-4 space-y-2">
        {entries.map((p, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
            <span className="text-sm font-medium capitalize" style={{ color: 'var(--color-text)' }}>{p.platform || p.name}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{
              background: p.available ? '#dcfce7' : p.available === false ? '#fef2f2' : '#fafafa',
              color: p.available ? '#16a34a' : p.available === false ? '#dc2626' : '#888',
            }}>
              {p.available ? 'Available' : p.available === false ? 'Taken' : 'Unknown'}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Watchlist
  if (mode === 'watchlist' && (data.domains || data.items || data.watchlist)) {
    const items = data.domains || data.items || data.watchlist || [];
    if (items.length === 0) {
      return <p className="mt-4 text-sm" style={{ color: 'var(--color-muted)' }}>Your watchlist is empty. Add domains below.</p>;
    }
    return (
      <div className="mt-4 space-y-2">
        {items.map((d, i) => (
          <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
            <span className="text-sm font-mono" style={{ color: 'var(--color-text)' }}>{d.domain || d}</span>
            {d.expiry && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Expires {d.expiry}</span>}
          </div>
        ))}
      </div>
    );
  }

  // Fallback: raw JSON
  return <ResultCard data={data} />;
}

// ── Tool panels ───────────────────────────────────────────────────────────────

function SuggestPanel() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const { startProcessing, stopProcessing } = useProcessingStore();

  const run = useCallback(async () => {
    if (!q.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    startProcessing('Generating name ideas…', 'Querying DomScan AI suggestions.');
    try {
      const res = await api.get(`/api/domains/suggest?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); stopProcessing(); }
  }, [q]);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Describe your business or paste keywords</label>
        <textarea
          rows={3}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="e.g. AI-powered fitness coaching app for busy professionals"
          className="w-full px-3 py-2 rounded-lg text-sm border outline-none resize-none"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
      </div>
      <RunBtn onClick={run} busy={busy} label="Generate Names" disabled={!q.trim()} />
      <ErrMsg msg={err} />
      <SmartResult mode="suggest" data={result} />
    </div>
  );
}

function ScorePanel() {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const { startProcessing, stopProcessing } = useProcessingStore();

  const run = useCallback(async () => {
    if (!domain.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    startProcessing('Scoring brand name…');
    try {
      const res = await api.get(`/api/domains/score?domain=${encodeURIComponent(domain.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); stopProcessing(); }
  }, [domain]);

  return (
    <div className="space-y-3">
      <DomainInput value={domain} onChange={setDomain} label="Domain or brand name" placeholder="e.g. launchpad.io" />
      <RunBtn onClick={run} busy={busy} label="Score Name" disabled={!domain.trim()} />
      <ErrMsg msg={err} />
      <SmartResult mode="score" data={result} />
    </div>
  );
}

function ComparePanel() {
  const [names, setNames] = useState(['', '']);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const { startProcessing, stopProcessing } = useProcessingStore();

  const setName = (i, v) => setNames(prev => { const n = [...prev]; n[i] = v; return n; });
  const addName = () => names.length < 5 && setNames(p => [...p, '']);

  const run = useCallback(async () => {
    const valid = names.filter(n => n.trim());
    if (valid.length < 2) { setErr('Enter at least 2 names.'); return; }
    setBusy(true); setErr(''); setResult(null);
    startProcessing('Comparing brand names…');
    try {
      const res = await api.post('/api/domains/score/compare', { domains: valid });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); stopProcessing(); }
  }, [names]);

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Brand name candidates (2–5)</label>
      {names.map((n, i) => (
        <input
          key={i}
          type="text"
          value={n}
          onChange={e => setName(i, e.target.value)}
          placeholder={`Name ${i + 1}`}
          className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
      ))}
      <div className="flex items-center gap-2">
        {names.length < 5 && (
          <button onClick={addName} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-60 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            + Add name
          </button>
        )}
        <RunBtn onClick={run} busy={busy} label="Compare" />
      </div>
      <ErrMsg msg={err} />
      <SmartResult mode="compare" data={result} />
    </div>
  );
}

function TyposPanel() {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const { startProcessing, stopProcessing } = useProcessingStore();

  const run = useCallback(async () => {
    if (!domain.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    startProcessing('Scanning typo variants…', 'This checks availability for every variant.');
    try {
      const res = await api.get(`/api/domains/typos?domain=${encodeURIComponent(domain.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); stopProcessing(); }
  }, [domain]);

  return (
    <div className="space-y-3">
      <DomainInput value={domain} onChange={setDomain} label="Your domain" placeholder="e.g. mybrand.com" />
      <RunBtn onClick={run} busy={busy} label="Find Typos" disabled={!domain.trim()} />
      <ErrMsg msg={err} />
      <SmartResult mode="typos" data={result} />
    </div>
  );
}

function AvailabilityPanel() {
  const [name, setName] = useState('');
  const [tlds, setTlds] = useState('com,io,ai,co,app,net,org,dev');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const { startProcessing, stopProcessing } = useProcessingStore();

  const run = useCallback(async () => {
    if (!name.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    startProcessing('Checking availability…');
    try {
      const res = await api.get(`/api/domains/availability?name=${encodeURIComponent(name.trim())}&tlds=${encodeURIComponent(tlds)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); stopProcessing(); }
  }, [name, tlds]);

  return (
    <div className="space-y-3">
      <DomainInput value={name} onChange={setName} label="Name (without TLD)" placeholder="e.g. launchpad" />
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>TLDs to check (comma-separated)</label>
        <input
          type="text"
          value={tlds}
          onChange={e => setTlds(e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
      </div>
      <RunBtn onClick={run} busy={busy} label="Check Availability" disabled={!name.trim()} />
      <ErrMsg msg={err} />
      <SmartResult mode="availability" data={result} />
    </div>
  );
}

function OverviewPanel() {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const { startProcessing, stopProcessing } = useProcessingStore();

  const run = useCallback(async () => {
    if (!domain.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    startProcessing('Fetching domain profile…', 'Combining WHOIS, lifecycle, and reputation data.');
    try {
      const res = await api.get(`/api/domains/overview?domain=${encodeURIComponent(domain.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); stopProcessing(); }
  }, [domain]);

  return (
    <div className="space-y-3">
      <DomainInput value={domain} onChange={setDomain} label="Domain to research" placeholder="e.g. competitor.com" />
      <RunBtn onClick={run} busy={busy} label="Get Profile" disabled={!domain.trim()} />
      <ErrMsg msg={err} />
      <ResultCard data={result} />
    </div>
  );
}

function CompetitorPanel() {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const { startProcessing, stopProcessing } = useProcessingStore();

  const run = useCallback(async () => {
    if (!domain.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    startProcessing('Running competitor analysis…', 'Discovering infrastructure, tech stack, and associated domains.');
    try {
      const res = await api.get(`/api/domains/competitor?domain=${encodeURIComponent(domain.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); stopProcessing(); }
  }, [domain]);

  return (
    <div className="space-y-3">
      <DomainInput value={domain} onChange={setDomain} label="Competitor domain" placeholder="e.g. competitor.com" />
      <RunBtn onClick={run} busy={busy} label="Analyse Competitor" disabled={!domain.trim()} />
      <ErrMsg msg={err} />
      <ResultCard data={result} />
    </div>
  );
}

function ValuePanel() {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const { startProcessing, stopProcessing } = useProcessingStore();

  const run = useCallback(async () => {
    if (!domain.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    startProcessing('Estimating domain value…');
    try {
      const res = await api.get(`/api/domains/value?domain=${encodeURIComponent(domain.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); stopProcessing(); }
  }, [domain]);

  const val = result?.value || result?.estimate || result?.estimated_value;

  return (
    <div className="space-y-3">
      <DomainInput value={domain} onChange={setDomain} label="Domain to value" placeholder="e.g. bestbrand.com" />
      <RunBtn onClick={run} busy={busy} label="Estimate Value" disabled={!domain.trim()} />
      <ErrMsg msg={err} />
      {result && val && (
        <div className="mt-3 px-4 py-3 rounded-xl" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Estimated market value</p>
          <p className="text-3xl font-bold" style={{ color: 'var(--color-primary)' }}>{typeof val === 'number' ? `$${val.toLocaleString()}` : val}</p>
        </div>
      )}
      {result && <ResultCard data={result} />}
    </div>
  );
}

function SocialPanel() {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const { startProcessing, stopProcessing } = useProcessingStore();

  const run = useCallback(async () => {
    if (!username.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    startProcessing('Checking social handles…', 'Querying Instagram, X, TikTok, LinkedIn, YouTube…');
    try {
      const res = await api.get(`/api/domains/social?username=${encodeURIComponent(username.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); stopProcessing(); }
  }, [username]);

  return (
    <div className="space-y-3">
      <DomainInput value={username} onChange={setUsername} label="Brand / username to check" placeholder="e.g. mybrand" />
      <RunBtn onClick={run} busy={busy} label="Check Handles" disabled={!username.trim()} />
      <ErrMsg msg={err} />
      <SmartResult mode="social" data={result} />
    </div>
  );
}

function BrandLaunchPanel() {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const { startProcessing, stopProcessing } = useProcessingStore();

  const run = useCallback(async () => {
    if (!domain.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    startProcessing('Running brand launch checklist…', 'Combining domain, social, typo, and health checks.');
    try {
      const res = await api.get(`/api/domains/brand-launch?domain=${encodeURIComponent(domain.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); stopProcessing(); }
  }, [domain]);

  return (
    <div className="space-y-3">
      <DomainInput value={domain} onChange={setDomain} label="Your domain" placeholder="e.g. mybrand.com" />
      <RunBtn onClick={run} busy={busy} label="Run Pre-Launch Check" disabled={!domain.trim()} />
      <ErrMsg msg={err} />
      <ResultCard data={result} />
    </div>
  );
}

function PricingPanel() {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const { startProcessing, stopProcessing } = useProcessingStore();

  const run = useCallback(async () => {
    if (!domain.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    startProcessing('Fetching registrar prices…');
    try {
      const res = await api.get(`/api/domains/pricing?domain=${encodeURIComponent(domain.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); stopProcessing(); }
  }, [domain]);

  return (
    <div className="space-y-3">
      <DomainInput value={domain} onChange={setDomain} label="Domain (used to detect TLD)" placeholder="e.g. mybrand.io" />
      <RunBtn onClick={run} busy={busy} label="Compare Prices" disabled={!domain.trim()} />
      <ErrMsg msg={err} />
      <ResultCard data={result} />
    </div>
  );
}

function WatchlistPanel() {
  const [list, setList] = useState(null);
  const [expiring, setExpiring] = useState(null);
  const [addDomain, setAddDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([
        api.get('/api/domains/watchlist'),
        api.get('/api/domains/watchlist/expiring'),
      ]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      setList(d1);
      setExpiring(d2);
    } catch (e) { setErr(e.message); }
  }, []);

  React.useEffect(() => { load(); }, []);

  const add = async () => {
    if (!addDomain.trim()) return;
    setBusy(true); setErr('');
    try {
      const res = await api.post('/api/domains/watchlist', { domain: addDomain.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAddDomain('');
      load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const remove = async (domain) => {
    try {
      await api.delete(`/api/domains/watchlist?domain=${encodeURIComponent(domain)}`);
      load();
    } catch (e) { setErr(e.message); }
  };

  const items = list?.domains || list?.items || list?.watchlist || [];
  const expiringItems = expiring?.domains || expiring?.items || [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={addDomain}
          onChange={e => setAddDomain(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Add domain to watch…"
          className="flex-1 px-3 py-2 rounded-lg text-sm border outline-none"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        />
        <RunBtn onClick={add} busy={busy} label="Add" disabled={!addDomain.trim()} />
      </div>
      <ErrMsg msg={err} />
      {expiringItems.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: '#f59e0b' }}>⏰ Expiring soon</p>
          {expiringItems.map((d, i) => (
            <div key={i} className="flex justify-between items-center px-3 py-2 rounded-lg mb-1" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
              <span className="text-sm font-mono">{d.domain || d}</span>
              {d.expiry && <span className="text-xs" style={{ color: '#92400e' }}>{d.expiry}</span>}
            </div>
          ))}
        </div>
      )}
      {items.length > 0 ? (
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>Watched domains ({items.length})</p>
          <div className="space-y-1">
            {items.map((d, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                <span className="text-sm font-mono" style={{ color: 'var(--color-text)' }}>{d.domain || d}</span>
                <button onClick={() => remove(d.domain || d)} className="text-xs hover:opacity-60 transition-opacity" style={{ color: '#ef4444' }}>Remove</button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No domains in your watchlist yet.</p>
      )}
    </div>
  );
}

function BrandMonitorPanel() {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [monitors, setMonitors] = useState(null);
  const [err, setErr] = useState('');
  const { startProcessing, stopProcessing } = useProcessingStore();

  const loadMonitors = useCallback(async () => {
    try {
      const res = await api.get('/api/domains/brand-monitor');
      const data = await res.json();
      setMonitors(data);
    } catch {}
  }, []);

  React.useEffect(() => { loadMonitors(); }, []);

  const scan = async () => {
    if (!domain.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    startProcessing('Scanning for copycats…', 'Looking for lookalike and typosquatting domains.');
    try {
      const res = await api.get(`/api/domains/brand-monitor/scan?domain=${encodeURIComponent(domain.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) { setErr(e.message); } finally { setBusy(false); stopProcessing(); }
  };

  const createMonitor = async () => {
    if (!domain.trim()) return;
    setBusy(true); setErr('');
    try {
      const res = await api.post('/api/domains/brand-monitor', { domain: domain.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadMonitors();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <DomainInput value={domain} onChange={setDomain} label="Your domain to protect" placeholder="e.g. mybrand.com" />
      <div className="flex gap-2">
        <RunBtn onClick={scan} busy={busy} label="Scan Now" disabled={!domain.trim()} />
        <button
          onClick={createMonitor}
          disabled={busy || !domain.trim()}
          className="px-4 py-1.5 rounded-lg text-sm border transition-opacity hover:opacity-60"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', opacity: busy || !domain.trim() ? 0.4 : 1 }}
        >
          Add Monitor
        </button>
      </div>
      <ErrMsg msg={err} />
      {monitors && (monitors.monitors || monitors.items || []).length > 0 && (
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>Active monitors</p>
          {(monitors.monitors || monitors.items).map((m, i) => (
            <div key={i} className="px-3 py-2 rounded-lg text-sm font-mono mb-1" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              {m.domain || m}
            </div>
          ))}
        </div>
      )}
      <ResultCard data={result} />
    </div>
  );
}

// ── Panel router ──────────────────────────────────────────────────────────────

const PANELS = {
  suggest: SuggestPanel,
  score: ScorePanel,
  compare: ComparePanel,
  typos: TyposPanel,
  availability: AvailabilityPanel,
  overview: OverviewPanel,
  competitor: CompetitorPanel,
  value: ValuePanel,
  social: SocialPanel,
  brandlaunch: BrandLaunchPanel,
  pricing: PricingPanel,
  watchlist: WatchlistPanel,
  brandmonitor: BrandMonitorPanel,
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DomainsPage() {
  const [mode, setMode] = useState('suggest');
  const [helpTool, setHelpTool] = useState(null);
  const getIcon = useIcon();

  const Panel = PANELS[mode] || (() => null);

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>

      {/* ── Sidebar ── */}
      <div
        className="flex-shrink-0 w-52 flex flex-col border-r overflow-y-auto"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="px-3 pt-4 pb-2">
          <div className="flex items-center gap-2 mb-4">
            {getIcon('globe', { size: 16, style: { color: 'var(--color-primary)' } })}
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Domain & Brand</span>
          </div>

          {MODE_GROUPS.map(group => (
            <div key={group.label} className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  {group.label}
                </span>
                <button
                  onClick={() => {
                    const first = group.modes[0];
                    if (TOOL_HELP[first]) setHelpTool(first);
                    else setHelpTool(group.modes.find(m => TOOL_HELP[m]));
                  }}
                  className="text-xs hover:opacity-60 transition-opacity"
                  style={{ color: 'var(--color-muted)' }}
                  data-tip={`About ${group.label}`}
                >
                  ?
                </button>
              </div>
              {group.modes.map(m => (
                <div key={m} className="flex items-center group">
                  <button
                    onClick={() => setMode(m)}
                    className="flex-1 text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
                    style={{
                      background: mode === m ? 'var(--color-bg)' : 'transparent',
                      color: mode === m ? 'var(--color-primary)' : 'var(--color-text)',
                      fontWeight: mode === m ? 500 : 400,
                    }}
                  >
                    {MODE_LABELS[m]}
                  </button>
                  <button
                    onClick={() => setHelpTool(m)}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-xs w-5 h-5 flex items-center justify-center rounded"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    ?
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
              {MODE_LABELS[mode]}
            </h1>
            <button
              onClick={() => setHelpTool(mode)}
              className="text-xs w-5 h-5 flex items-center justify-center rounded-full border hover:opacity-60 transition-opacity"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              ?
            </button>
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            {TOOL_HELP[mode]?.description}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="max-w-xl">
            <Panel key={mode} />
          </div>
        </div>
      </div>

      {helpTool && <HelpModal tool={helpTool} onClose={() => setHelpTool(null)} />}
    </div>
  );
}
