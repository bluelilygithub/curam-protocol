import React, { useMemo, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import { ENDINGS, STYLES } from './constants.mjs';
import { briefSummary } from './briefSummary.mjs';
import { BLANK_FILTERS, applyFilters, countLine, activeFilters, HARD_SPELLING_SCORE } from './filters.mjs';
import { orderedPool, toggleShortlist, toggleFeedback, feedbackOf } from './workspace.mjs';

// Step 2: the names. Filters work instantly on the names already made (no credits); steering starts a new round that builds on the brief
// and on the names you marked More like this / Less like this. Every name says where it comes from and what to watch for.
// Status colours are deliberately outside the theme (see client/DESIGN.md).

const mute = { color: 'var(--color-muted)' };
const line = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const STATE = {
  free: { mark: '✓', label: 'free', bg: '#dcfce7', fg: '#15803d', border: '#bbf7d0' },
  taken: { mark: '✕', label: 'taken', bg: '#fef2f2', fg: '#dc2626', border: '#fecaca' },
  unknown: { mark: '?', label: 'not confirmed', bg: '#f5f5f5', fg: '#777', border: '#e5e5e5' },
};
const PAGE = 24;

export function Chips({ card, required }) {
  const have = new Map(((card.domains && card.domains.results) || []).map((r) => [r.tld, r]));
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Domain endings">
      {ENDINGS.map((tld) => {
        const r = have.get(tld);
        const st = STATE[!r || r.available == null ? 'unknown' : r.available ? 'free' : 'taken'];
        const need = required.includes(tld);
        return (
          <span key={tld} className="text-xs px-2 py-0.5 rounded font-mono" title={undefined}
            style={{ background: st.bg, color: st.fg, border: `${need ? 2 : 1}px solid ${need ? st.fg : st.border}`, fontWeight: need ? 700 : 400 }}>
            .{tld} {st.mark}<span className="sr-only"> {st.label}{need ? ', required' : ''}</span>
          </span>
        );
      })}
    </div>
  );
}

function Card({ card, ws, setWs, required, onVariations, generating }) {
  const starred = ws.shortlist.includes(card.name);
  const fb = feedbackOf(ws, card.name);
  const btn = (on) => ({ className: 'text-xs px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity duration-200', style: on ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' } : line });
  return (
    <div className="rounded-xl px-4 py-3 space-y-2" style={{ background: 'var(--color-bg)', border: `1px solid ${starred ? 'var(--color-primary)' : 'var(--color-border)'}` }} data-guide="name-card">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{card.label || card.name}</span>
        {card.label && <span className="text-xs font-mono" style={mute}>{card.name}</span>}
        {card.own && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'var(--color-surface)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}>Your name</span>}
        {!card.own && card.style && <span className="text-[10px]" style={mute}>{card.style}</span>}
        {card.round > 1 && <span className="text-[10px]" style={mute}>round {card.round}</span>}
      </div>
      <Chips card={card} required={required} />
      {card.reasoning && <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{card.reasoning}</p>}
      {card.risks.length > 0 && (
        <ul className="text-xs space-y-0.5" style={{ color: '#b45309' }}>
          {card.risks.map((r, i) => <li key={i}>⚠ {r}</li>)}
        </ul>
      )}
      {card.domains && card.domains.results.length === 0 && <p className="text-xs" style={mute}>The domain service gave no answer for this name, so every ending is unconfirmed.</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Tooltip text="Add or remove this name from your shortlist. Shortlisted names are compared side by side and checked in full."><button onClick={() => setWs((w) => toggleShortlist(w, card.name))} aria-pressed={starred} {...btn(starred)}>{starred ? '★ Shortlisted' : '☆ Shortlist'}</button></Tooltip>
        {!card.own && (
          <>
            <Tooltip text="Tell the next round you like names like this one: a similar sound, structure or meaning."><button onClick={() => setWs((w) => toggleFeedback(w, card.name, 'more'))} aria-pressed={fb === 'more'} {...btn(fb === 'more')}>More like this</button></Tooltip>
            <Tooltip text="Tell the next round to avoid names like this one."><button onClick={() => setWs((w) => toggleFeedback(w, card.name, 'less'))} aria-pressed={fb === 'less'} {...btn(fb === 'less')}>Less like this</button></Tooltip>
          </>
        )}
        <Tooltip text="Try prefixes and suffixes, other spellings and your own words joined on. Useful when this name's .com is taken. Checks up to 24 variations."><button onClick={() => onVariations(card.name)} disabled={generating} {...btn(false)}>Variations</button></Tooltip>
      </div>
    </div>
  );
}

export default function NameResults({ ws, setWs, filters, setFilters, config, generating, onMore, onVariations, onEditBrief }) {
  const [limit, setLimit] = useState(PAGE);
  const required = ws.brief.required.tlds;
  const ordered = useMemo(() => orderedPool(ws.pool), [ws.pool]);
  const shown = useMemo(() => applyFilters(ordered, filters, ws.shortlist), [ordered, filters, ws.shortlist]);
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const toggleIn = (key, v) => setFilters((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }));
  const styles = [...new Set(ws.pool.map((c) => c.style).filter((s) => s && s !== 'own' && s !== 'variation'))];
  const last = ws.lastCounts;
  const credits = config && config.generate ? config.generate.credits : 40;
  const active = activeFilters(filters).length;
  const input = 'px-2 py-1 rounded-lg border text-xs outline-none';
  const inputStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

  return (
    <div className="space-y-4" data-guide="names">
      <div className="rounded-xl px-4 py-3 flex flex-wrap items-center gap-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <p className="flex-1 min-w-[16rem] text-sm" style={{ color: 'var(--color-text)' }}><span style={mute}>The brief: </span>{briefSummary(ws.brief)}</p>
        <Tooltip text="Change the description, tone, styles or words. The names you have stay; new names are made from the changed brief."><button onClick={onEditBrief} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={line}>Edit brief</button></Tooltip>
      </div>

      {last && (
        <p className="text-xs" style={mute}>
          Last round: {last.generated} ideas written · {last.passedFilters} passed the free filters · {last.checked} checked for domains · {last.takenDropped} dropped because a required ending is taken · {last.shown} shown.
          {last.credits ? ` About ${last.credits} lookup credits used.` : ''}
        </p>
      )}

      <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} data-guide="filters">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Filter these names <span className="font-normal" style={mute}>· instant, free</span></p>
          {active > 0 && <button onClick={() => setFilters(BLANK_FILTERS)} className="text-xs underline hover:opacity-70" style={mute}>Clear filters</button>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" style={{ color: 'var(--color-text)' }}>
          <Tooltip text="Only names up to this many letters."><label className="flex items-center gap-1.5">Length
            <select value={filters.maxLetters} onChange={(e) => set({ maxLetters: Number(e.target.value) })} className={input} style={inputStyle}>
              <option value={0}>any</option>{[6, 8, 10, 12].map((n) => <option key={n} value={n}>up to {n} letters</option>)}
            </select></label></Tooltip>
          <Tooltip text="Only names up to this many syllables."><label className="flex items-center gap-1.5">Syllables
            <select value={filters.maxSyllables} onChange={(e) => set({ maxSyllables: Number(e.target.value) })} className={input} style={inputStyle}>
              <option value={0}>any</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>up to {n}</option>)}
            </select></label></Tooltip>
          <Tooltip text="Names must start with one of these letters or sounds, separated by commas, for example b, br, st."><label className="flex items-center gap-1.5">Starts with
            <input value={filters.startsWith} onChange={(e) => set({ startsWith: e.target.value })} placeholder="b, br" className={`${input} w-24`} style={inputStyle} /></label></Tooltip>
          <Tooltip text="Hide names containing any of these letters, for example xz."><label className="flex items-center gap-1.5">Avoid letters
            <input value={filters.avoidLetters} onChange={(e) => set({ avoidLetters: e.target.value })} placeholder="xz" className={`${input} w-20`} style={inputStyle} /></label></Tooltip>
          <Tooltip text={`Hide names with spelling traps, such as ph/f or k/c, that people get wrong after hearing the name once (a risk score of ${HARD_SPELLING_SCORE} or more).`}>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={filters.hideHardSpelling} onChange={(e) => set({ hideHardSpelling: e.target.checked })} />Hide hard to spell</label></Tooltip>
          <Tooltip text="Show only the names you have shortlisted."><label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={filters.shortlistedOnly} onChange={(e) => set({ shortlistedOnly: e.target.checked })} />Shortlisted only</label></Tooltip>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--color-text)' }}>
          <span style={mute}>Must be free:</span>
          {ENDINGS.map((t) => (
            <Tooltip key={t} text={`Only names with .${t} confirmed free. Not confirmed does not count as free.`}>
              <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={filters.endings.includes(t)} onChange={() => toggleIn('endings', t)} />.{t}</label>
            </Tooltip>
          ))}
        </div>
        {styles.length > 1 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--color-text)' }}>
            <span style={mute}>Style:</span>
            {styles.map((s) => (
              <label key={s} className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={filters.styles.includes(s)} onChange={() => toggleIn('styles', s)} />{(STYLES.find((x) => x[0] === s) || [s, s])[1]}</label>
            ))}
          </div>
        )}
        <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }} aria-live="polite">{countLine(shown.length, ws.pool.length, filters)}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3" data-guide="steer">
        <Tooltip text={`Make a new round of names from the brief and from the names you marked More like this and Less like this. Names you have seen are not repeated. Uses about ${credits} lookup credits.`}>
          <button onClick={onMore} disabled={generating} className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
            {generating ? 'Working…' : 'Get more names'}
          </button>
        </Tooltip>
        <span className="text-xs" style={mute}>About {credits} lookup credits{ws.feedback.more.length + ws.feedback.less.length ? ` · steering with ${ws.feedback.more.length} liked and ${ws.feedback.less.length} disliked` : ''}</span>
      </div>

      {ws.pool.length === 0 && <p className="text-sm" style={mute}>No names yet. Fill in the brief and generate.</p>}
      {ws.pool.length > 0 && shown.length === 0 && <p className="text-sm" style={mute}>No names match those filters. Clear a filter to see them again, or get more names.</p>}

      <div className="grid gap-3 xl:grid-cols-2">
        {shown.slice(0, limit).map((c) => <Card key={c.name} card={c} ws={ws} setWs={setWs} required={required} onVariations={onVariations} generating={generating} />)}
      </div>
      {shown.length > limit && (
        <button onClick={() => setLimit((n) => n + PAGE)} className="text-sm px-4 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={line}>Show more ({shown.length - limit} left)</button>
      )}
    </div>
  );
}
