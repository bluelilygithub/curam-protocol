import React, { useEffect, useMemo, useRef, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { GROUPS, INGREDIENTS, CUP_STANDARDS, allUnits, getUnit, getGroup, unitsOfGroup, formatNumber, unitShort, baseSymbol, getIngredient } from '../../utils/units/registry.mjs';
import { convertValues, formatResult, conversionProblem } from '../../utils/units/convert.mjs';
import { parseSpokenNumber } from '../../utils/units/voiceParser.mjs';
import { Card, Badge, SecondaryButton, FOCUS_RING } from './shared';

const TYPE_LABEL = { factor: 'factor', offset: 'offset', inverse: 'inverse', lookup: 'lookup', compound: 'compound' };
const TYPE_HELP = {
  factor: 'Multiply by a constant',
  offset: 'Scale plus an offset (temperature)',
  inverse: 'Reciprocal relationship (fuel economy)',
  lookup: 'A table, not a formula (gas marks)',
  compound: 'Several parts added together (feet + inches…)',
};
const SYSTEM_LABEL = { metric: 'Metric', us: 'US', imperial: 'Imperial', other: 'Other' };
const selectStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

function EntryTest({ unit, prefs }) {
  const [text, setText] = useState('');
  const peers = useMemo(() => unitsOfGroup(unit.group).filter((u) => u.id !== unit.id), [unit]);
  const defaultTarget = useMemo(() => (peers.find((u) => u.type !== 'compound' && (u.system === 'metric') && u.id !== unit.id) || peers[0])?.id, [peers, unit]);
  const [target, setTarget] = useState(defaultTarget);
  const ctx = { cupStandard: prefs.cupStandard, ingredient: prefs.ingredient, tempMode: 'absolute' };
  let out = '';
  const v = text === '' ? null : parseSpokenNumber(text);
  if (v !== null && target && unit.type !== 'compound') {
    const prob = conversionProblem(unit.id, target, ctx);
    if (prob) out = prob;
    else {
      const r = convertValues(v, unit.id, target, ctx, 2);
      const ok = getUnit(target).type === 'compound' ? r.parts.every(Number.isFinite) : Number.isFinite(r.value);
      out = ok ? `${formatNumber(v)} ${unitShort(unit)} = ${formatResult(r, target, { mode: 'sig', n: 8 })}` : 'No equivalent for that value.';
    }
  } else if (text && v === null) out = 'Enter a number.';
  if (unit.type === 'compound') return <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Use the Converter tab to try compound amounts.</p>;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40">
          <VoiceInput type="number" value={text} onChange={setText} parse={(t) => { const n = parseSpokenNumber(t); return n === null ? null : String(n); }} placeholder={`Try a value (${unitShort(unit)})`} mic={false} label={`Test value for ${unit.name}`} />
        </div>
        <Tooltip text="Unit to convert the test value into">
          <select aria-label="Test target unit" value={target} onChange={(e) => setTarget(e.target.value)} className={`px-2.5 py-2.5 rounded-xl border text-sm ${FOCUS_RING}`} style={selectStyle}>
            {peers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Tooltip>
      </div>
      {out && <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }} aria-live="polite">{out}</p>}
    </div>
  );
}

export default function FormulasTab({ prefs, focusUnit, onUseInConverter }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const [type, setType] = useState('all');
  const [system, setSystem] = useState('all');
  const [flash, setFlash] = useState(null);
  const refs = useRef({});

  const units = useMemo(() => allUnits(), []);
  const filtered = useMemo(() => {
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    return units.filter((u) => {
      if (group !== 'all' && u.group !== group) return false;
      if (type !== 'all' && u.type !== type) return false;
      if (system !== 'all' && u.system !== system && !(system === 'us' && u.alsoUS)) return false;
      if (!toks.length) return true;
      const hay = `${u.name} ${u.plural} ${u.symbols.join(' ')} ${u.aliases.join(' ')} ${u.group}`.toLowerCase();
      return toks.every((t) => hay.includes(t));
    });
  }, [units, q, group, type, system]);

  // coming from a result: clear filters, scroll to the entry and highlight it
  useEffect(() => {
    if (!focusUnit) return undefined;
    setQ(''); setType('all'); setSystem('all');
    const u = getUnit(focusUnit);
    setGroup(u ? u.group : 'all');
    setFlash(focusUnit);
    const t1 = setTimeout(() => refs.current[focusUnit]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    const t2 = setTimeout(() => setFlash(null), 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [focusUnit]);

  const showIngredients = group === 'all' || group === 'cooking';
  const std = CUP_STANDARDS[prefs.cupStandard];

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Every conversion in this app comes from this list — the exact factor, where it comes from, and a worked example.
          Variants that look alike (US vs imperial gallons, KB vs KiB) are flagged.
        </p>
        <VoiceInput value={q} onChange={setQ} placeholder="Search by unit name, symbol or alias (e.g. “feet”, “psi”, “fl oz”)" label="Search units" data-tour="formula-search" />
        <div className="flex flex-wrap gap-2">
          <Tooltip text="Show one kind of measurement"><select aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value)} className={`px-2.5 py-2 rounded-xl border text-sm ${FOCUS_RING}`} style={selectStyle}>
            <option value="all">All groups</option>
            {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.name.replace(/ \(.*\)/, '')}</option>)}
          </select></Tooltip>
          <Tooltip text="How the conversion works: factor, offset, inverse or lookup table"><select aria-label="Conversion type" value={type} onChange={(e) => setType(e.target.value)} className={`px-2.5 py-2 rounded-xl border text-sm ${FOCUS_RING}`} style={selectStyle}>
            <option value="all">All types</option>
            {Object.keys(TYPE_LABEL).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]} — {TYPE_HELP[t]}</option>)}
          </select></Tooltip>
          <Tooltip text="Metric, US or imperial units"><select aria-label="System" value={system} onChange={(e) => setSystem(e.target.value)} className={`px-2.5 py-2 rounded-xl border text-sm ${FOCUS_RING}`} style={selectStyle}>
            <option value="all">All systems</option>
            {Object.entries(SYSTEM_LABEL).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select></Tooltip>
          <span className="text-xs self-center" style={{ color: 'var(--color-muted)' }}>{filtered.length} of {units.length} entries</span>
        </div>
      </Card>

      {filtered.length === 0 && <p className="text-sm px-1" style={{ color: 'var(--color-muted)' }}>No entries match. Try a shorter search.</p>}

      <div className="space-y-3">
        {filtered.map((u) => {
          const gr = getGroup(u.group);
          return (
            <section
              key={u.id}
              ref={(el) => { refs.current[u.id] = el; }}
              data-unit-id={u.id}
              className="rounded-2xl border p-4 space-y-3 transition-all duration-200"
              style={{ background: 'var(--color-surface)', borderColor: flash === u.id ? 'var(--color-primary)' : 'var(--color-border)', boxShadow: flash === u.id ? '0 0 0 3px color-mix(in srgb, var(--color-primary) 25%, transparent)' : 'none' }}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{u.name}{u.symbols[0] ? <span className="font-normal ml-2" style={{ color: 'var(--color-muted)' }}>{u.symbols.filter(Boolean).slice(0, 3).join('  ·  ')}</span> : null}</h3>
                  <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{gr?.name.replace(/ \(.*\)/, '')} · base: {gr?.base}{baseSymbol(u.group) ? ` (${baseSymbol(u.group)})` : ''}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge title={TYPE_HELP[u.type]}>{TYPE_LABEL[u.type]}</Badge>
                  <Badge>{SYSTEM_LABEL[u.system]}{u.alsoUS ? ' / US' : ''}</Badge>
                  {u.variant && <Badge bg="#fef3c7" fg="#b45309" title="Regional / standards variant">{u.variant} variant</Badge>}
                  {u.needsContext && <Badge bg="#fef3c7" fg="#b45309" title="This conversion needs an extra choice">needs {u.needsContext === 'cupStandard' ? 'cup standard' : 'ingredient'}</Badge>}
                </div>
              </div>
              {u.formulaText && <div className="text-sm rounded-xl border px-3 py-2 font-mono break-words" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>{u.formulaText}</div>}
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt style={{ color: 'var(--color-muted)' }}>Example</dt><dd style={{ color: 'var(--color-text)' }}>{u.exampleText}</dd>
                <dt style={{ color: 'var(--color-muted)' }}>Source</dt><dd style={{ color: 'var(--color-text)' }}>{u.source}</dd>
                {u.ambiguity && (<><dt style={{ color: '#b45309' }}>Watch out</dt><dd style={{ color: '#b45309' }}>{u.ambiguity}</dd></>)}
                {u.note && (<><dt style={{ color: 'var(--color-muted)' }}>Note</dt><dd style={{ color: 'var(--color-text)' }}>{u.note}</dd></>)}
                {u.needsContext === 'cupStandard' && (<><dt style={{ color: 'var(--color-muted)' }}>Uses</dt><dd style={{ color: 'var(--color-text)' }}>{std.label} cups (change on the Converter tab)</dd></>)}
                {u.needsContext === 'ingredient' && (<><dt style={{ color: 'var(--color-muted)' }}>Uses</dt><dd style={{ color: 'var(--color-text)' }}>{getIngredient(prefs.ingredient)?.name || 'an ingredient'} · {std.label} cups (change on the Converter tab)</dd></>)}
              </dl>
              <EntryTest unit={u} prefs={prefs} />
              <div>
                <SecondaryButton onClick={() => onUseInConverter(u.id)}>Open in converter</SecondaryButton>
              </div>
            </section>
          );
        })}
      </div>

      {showIngredients && (
        <Card>
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Ingredient densities</h3>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Grams per metric cup (250 ml). These are typical baking-chart values and are approximate — they vary with brand, how the ingredient is packed and humidity.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: 'var(--color-muted)' }}>
                  <th className="py-1.5 pr-3">Ingredient</th><th className="py-1.5 pr-3">g per cup</th><th className="py-1.5 pr-3">g per ml</th><th className="py-1.5">Source</th>
                </tr>
              </thead>
              <tbody>
                {INGREDIENTS.map((i) => (
                  <tr key={i.id} className="border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <td className="py-1.5 pr-3">{i.name}</td><td className="py-1.5 pr-3">{i.gPerCup}</td><td className="py-1.5 pr-3">{formatNumber(i.gPerMl, { mode: 'sig', n: 3 })}</td>
                    <td className="py-1.5 text-xs" style={{ color: 'var(--color-muted)' }}>{i.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
