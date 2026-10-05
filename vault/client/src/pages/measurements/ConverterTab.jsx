import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import {
  GROUPS, INGREDIENTS, CUP_STANDARDS, getUnit, getGroup, unitsOfGroup, getIngredient, unitShort,
} from '../../utils/units/registry.mjs';
import { convert, convertValues, allInGroup, formatResult, conversionProblem, partLabel } from '../../utils/units/convert.mjs';
import { formatNumber } from '../../utils/units/registry.mjs';
import { parseSpokenNumber, parseSpokenCommand, parseSpokenUnit } from '../../utils/units/voiceParser.mjs';
import { Card, Label, Combobox, Segmented, PrimaryButton, SecondaryButton, FOCUS_RING } from './shared';

export const GROUP_DEFAULTS = {
  length: ['length.foot', 'length.metre'], area: ['area.ft2', 'area.m2'], volume: ['volume.cup', 'volume.millilitre'],
  mass: ['mass.pound', 'mass.kilogram'], temperature: ['temperature.fahrenheit', 'temperature.celsius'],
  speed: ['speed.mph', 'speed.kmh'], time: ['time.hour', 'time.minute'], pressure: ['pressure.psi', 'pressure.kilopascal'],
  energy: ['energy.kcal', 'energy.kilojoule'], power: ['power.hp', 'power.kilowatt'], data: ['data.gb', 'data.mb'],
  datarate: ['datarate.mbps', 'datarate.mbytes'], angle: ['angle.degree', 'angle.radian'], fuel: ['fuel.mpg_us', 'fuel.l100'],
  cooking: ['cooking.cup', 'cooking.g'], force: ['force.lbf', 'force.newton'], torque: ['torque.ftlb', 'torque.nm'],
  flow: ['flow.gpm_us', 'flow.lmin'],
};

const toItems = (units) => units.map((u) => ({
  id: u.id,
  label: u.type === 'compound' ? u.name : `${u.name}${u.symbols[0] && u.symbols[0] !== u.name ? ` (${u.symbols[0]})` : ''}`,
  hint: u.system === 'metric' ? 'metric' : u.system === 'us' ? 'US' : u.system === 'imperial' ? (u.alsoUS ? 'US/imperial' : 'imperial') : '',
  keywords: [...u.symbols, ...u.aliases].join(' '),
}));

const parsePart = (t) => {
  if (t === '' || t === null || t === undefined) return null;
  const v = parseSpokenNumber(t);
  return v === null ? NaN : v;
};

export default function ConverterTab({ prefs, update, history, addHistory, clearHistory, onOpenFormula }) {
  const getIcon = useIcon();
  const { group, fromId, toId } = prefs;
  const [valueText, setValueText] = useState('1');
  const [partTexts, setPartTexts] = useState(['', '', '']);
  const [command, setCommand] = useState('');
  const [copied, setCopied] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const histTimer = useRef(null);

  const from = getUnit(fromId);
  const to = getUnit(toId);
  const groupUnits = useMemo(() => unitsOfGroup(group), [group]);
  const ctx = { cupStandard: prefs.cupStandard, ingredient: prefs.ingredient, tempMode: prefs.tempMode };
  const needsIngredient = (from?.needsContext === 'ingredient') || (to?.needsContext === 'ingredient');
  const needsCup = group === 'cooking' || [from, to].some((u) => u && ['volume.cup', 'volume.tbsp', 'volume.tsp'].includes(u.id));
  const isTemp = group === 'temperature' && ![from, to].some((u) => u?.type === 'lookup');
  const fromCompound = from?.type === 'compound';

  const decimals = prefs.precision.mode === 'dp' ? prefs.precision.n : 2;

  // ── compute ──
  const { result, problem, inputText } = useMemo(() => {
    const prob = conversionProblem(fromId, toId, ctx);
    if (!from || !to) return { result: null, problem: prob, inputText: '' };
    let values;
    if (fromCompound) {
      const parts = from.parts.map((_, i) => parsePart(partTexts[i]));
      if (parts.every((p) => p === null)) return { result: null, problem: null, inputText: '' };
      if (parts.some((p) => Number.isNaN(p))) return { result: null, problem: 'Check the numbers.', inputText: '' };
      values = parts.map((p) => p ?? 0);
    } else {
      const v = parsePart(valueText);
      if (v === null) return { result: null, problem: null, inputText: '' };
      if (Number.isNaN(v)) return { result: null, problem: 'Enter a number (digits, a fraction like 3/4, or say it).', inputText: '' };
      values = v;
    }
    if (prob) return { result: null, problem: prob, inputText: '' };
    const r = convertValues(values, fromId, toId, ctx, decimals);
    const bad = to.type === 'compound' ? r.parts.some((x) => !Number.isFinite(x)) : !Number.isFinite(r.value);
    const text = fromCompound
      ? from.parts.map((pid, i) => `${formatNumber(values[i], { mode: 'sig', n: 8 })} ${partLabel(pid)}`).join(' ')
      : `${formatNumber(values, { mode: 'sig', n: 8 })} ${unitShort(from)}`;
    return { result: bad ? null : r, problem: bad ? 'That value has no equivalent here (gas marks only cover the standard marks).' : null, inputText: text };
  }, [fromId, toId, valueText, partTexts, prefs.cupStandard, prefs.ingredient, prefs.tempMode, prefs.precision.mode, prefs.precision.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const resultText = result ? formatResult(result, toId, prefs.precision) : '';

  // recent conversions: log once the user pauses on a valid result
  useEffect(() => {
    if (!result) return undefined;
    clearTimeout(histTimer.current);
    histTimer.current = setTimeout(() => {
      addHistory({ text: `${inputText} = ${resultText}`, group, fromId, toId, valueText, partTexts, ingredient: needsIngredient ? prefs.ingredient : null });
    }, 1800);
    return () => clearTimeout(histTimer.current);
  }, [resultText, inputText]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── actions ──
  const setGroup = (g, keepPair) => {
    const [f, t] = keepPair || GROUP_DEFAULTS[g] || unitsOfGroup(g).slice(0, 2).map((u) => u.id);
    update({ group: g, fromId: f, toId: t });
    setValueText('1');
    setPartTexts(['', '', '']);
  };

  const swap = () => {
    if (fromCompound || to?.type === 'compound') { update({ fromId: toId, toId: fromId }); return; }
    update({ fromId: toId, toId: fromId });
    if (result && to.type !== 'compound') setValueText(formatNumber(result.value, { mode: 'sig', n: 10 }));
  };

  const applyUnitFromSpeech = (side) => (text) => {
    const id = parseSpokenUnit(text, { preferGroup: group, region: prefs.region });
    if (!id) return null;
    const u = getUnit(id);
    if (u.group !== group) {
      const [f, t] = GROUP_DEFAULTS[u.group] || unitsOfGroup(u.group).slice(0, 2).map((x) => x.id);
      update({ group: u.group, fromId: side === 'from' ? id : (f === id ? t : f), toId: side === 'to' ? id : (t === id ? f : t) });
    }
    return id;
  };

  const applyCommand = (r) => {
    if (!r.ok) return;
    update({
      group: r.groupId, fromId: r.fromId, toId: r.toId,
      ...(r.ingredientId ? { ingredient: r.ingredientId } : {}),
    });
    if (r.parts) setPartTexts([...r.parts.map(String), '', ''].slice(0, 3));
    else setValueText(String(r.value));
    setCommand('');
  };

  const parsedCommand = useMemo(() => (command.trim() ? parseSpokenCommand(command, { region: prefs.region, preferGroup: group }) : null), [command, prefs.region, group]);

  const copyResult = () => {
    const text = `${inputText} = ${resultText}`;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    addHistory({ text, group, fromId, toId, valueText, partTexts, ingredient: needsIngredient ? prefs.ingredient : null });
  };

  const restore = (h) => {
    update({ group: h.group, fromId: h.fromId, toId: h.toId, ...(h.ingredient ? { ingredient: h.ingredient } : {}) });
    setValueText(h.valueText ?? '1');
    setPartTexts(h.partTexts ?? ['', '', '']);
  };

  const rows = useMemo(() => (result ? allInGroup(result.base, groupUnits, ctx) : []), [result, groupUnits, prefs.cupStandard, prefs.ingredient, prefs.tempMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const unitItems = useMemo(() => toItems(groupUnits), [groupUnits]);
  const ingItems = useMemo(() => INGREDIENTS.map((i) => ({ id: i.id, label: i.name, hint: `${i.gPerCup} g/cup`, keywords: i.aliases.join(' ') })), []);
  // The entry whose formula explains this conversion: prefer a unit that is not just the group's base (factor 1).
  const informative = (u) => u && u.type !== 'compound' && (u.type !== 'factor' || u.needsContext || u.factor !== 1);
  const formulaUnit = [from, to].find(informative) || (to && to.type !== 'compound' ? to : from);
  const simplePair = from?.type === 'factor' && to?.type === 'factor' && !from.needsContext && !to.needsContext;
  const formulaLine = !formulaUnit ? '' : simplePair
    ? `1 ${unitShort(from)} = ${formatNumber(convert(1, fromId, toId, ctx), { mode: 'sig', n: 10 })} ${unitShort(to)}`
    : (formulaUnit.formulaText || formulaUnit.exampleText);
  const g = getGroup(group);

  return (
    <div className="space-y-4">
      {/* Say it */}
      <Card data-tour="measure-say">
        <Label hint="speak or type a whole conversion">Say it</Label>
        <VoiceInput
          value={command}
          onChange={setCommand}
          placeholder={'e.g. "five feet eleven in centimetres" or "two cups of flour in grams"'}
          label="Whole spoken conversion"
        />
        {parsedCommand && (
          <div className="rounded-xl border p-3 flex flex-wrap items-center gap-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
            <div className="text-sm flex-1 min-w-[12rem]" style={{ color: 'var(--color-text)' }}>
              <span className="text-xs mr-2" style={{ color: 'var(--color-muted)' }}>Understood:</span>
              {parsedCommand.understood || '—'}
              {parsedCommand.notes.map((n) => <div key={n} className="text-xs mt-1" style={{ color: '#b45309' }}>{n}</div>)}
            </div>
            <Tooltip text="Fill the converter with what was understood. You can still change anything below.">
              <PrimaryButton onClick={() => applyCommand(parsedCommand)} disabled={!parsedCommand.ok}>Use this</PrimaryButton>
            </Tooltip>
          </div>
        )}
      </Card>

      {/* Group chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1" data-tour="measure-groups" role="tablist" aria-label="Kind of measurement">
        {GROUPS.map((gr) => {
          const active = gr.id === group;
          return (
            <button
              key={gr.id}
              role="tab"
              aria-selected={active}
              onClick={() => setGroup(gr.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full border text-xs font-medium transition-all duration-200 hover:opacity-70 ${FOCUS_RING}`}
              style={{ background: active ? 'var(--color-primary)' : 'var(--color-surface)', color: active ? '#fff' : 'var(--color-text)', borderColor: active ? 'var(--color-primary)' : 'var(--color-border)' }}
            >
              {gr.name.replace(/ \(.*\)/, '')}
            </button>
          );
        })}
      </div>
      {g?.note && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{g.note}</p>}

      {/* Converter */}
      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] items-end">
          <div className="space-y-2" data-tour="measure-value">
            <Label>{fromCompound ? 'Amount' : 'Value'}</Label>
            {fromCompound ? (
              <div className="flex gap-2">
                {from.parts.map((pid, i) => (
                  <div key={pid} className="flex-1">
                    <VoiceInput
                      type="number"
                      value={partTexts[i] || ''}
                      onChange={(v) => setPartTexts((p) => p.map((x, j) => (j === i ? v : x)))}
                      parse={(t) => { const n = parseSpokenNumber(t); return n === null ? null : String(n); }}
                      placeholder={partLabel(pid)}
                      label={`${getUnit(pid).plural}`}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <VoiceInput
                type="number"
                value={valueText}
                onChange={setValueText}
                parse={(t) => { const n = parseSpokenNumber(t); return n === null ? null : String(n); }}
                onSpoken={(t) => {
                  if (parseSpokenNumber(t) !== null) return false;
                  const r = parseSpokenCommand(t, { region: prefs.region, preferGroup: group });
                  if (r.ok) { applyCommand(r); return true; }
                  return false;
                }}
                placeholder="Value"
                label="Value to convert"
              />
            )}
            <Combobox items={unitItems} value={fromId} onChange={(id) => update({ fromId: id })} speak={applyUnitFromSpeech('from')} label="From unit" placeholder="Search units, or speak one…" tip="The unit you have" />
          </div>

          <div className="flex sm:flex-col justify-center pb-1">
            <Tooltip text="Swap the two units">
              <button type="button" onClick={swap} aria-label="Swap units" className={`p-2 rounded-xl border hover:opacity-60 transition-all duration-200 ${FOCUS_RING}`} style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                {getIcon('arrow-left-right', { size: 16 })}
              </button>
            </Tooltip>
          </div>

          <div className="space-y-2">
            <Label>Convert to</Label>
            <div className="px-3 py-2.5 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
              {result ? 'Result below' : 'Enter a value'}
            </div>
            <Combobox items={unitItems} value={toId} onChange={(id) => update({ toId: id })} speak={applyUnitFromSpeech('to')} label="To unit" placeholder="Search units, or speak one…" tip="The unit you want" />
          </div>
        </div>

        {/* Context */}
        {(
          <div className="flex flex-wrap items-end gap-4 pt-1">
            {needsIngredient && (
              <div className="min-w-[14rem]">
                <Label hint="cups and spoons need an ingredient to become grams">Ingredient</Label>
                <Combobox items={ingItems} value={prefs.ingredient} onChange={(id) => update({ ingredient: id })} speak={(t) => { const n = t.toLowerCase(); const ing = INGREDIENTS.find((i) => i.aliases.some((a) => n.includes(a)) || n.includes(i.name.toLowerCase())); return ing ? ing.id : null; }} label="Ingredient" placeholder="Search ingredients, or speak one…" />
              </div>
            )}
            {needsCup && (
              <div>
                <Label hint="sizes of cups & spoons">Cup standard</Label>
                <Segmented
                  label="Cup standard"
                  value={prefs.cupStandard}
                  onChange={(v) => update({ cupStandard: v })}
                  options={Object.values(CUP_STANDARDS).map((c) => ({ id: c.id, label: c.label, tip: `${c.label}: cup ${c.cupMl} ml, tablespoon ${c.tbspMl} ml, teaspoon ${c.tspMl} ml` }))}
                />
              </div>
            )}
            {isTemp && (
              <div>
                <Label hint="a 10° change is not the same as 10°">Temperature</Label>
                <Segmented
                  label="Temperature mode"
                  value={prefs.tempMode}
                  onChange={(v) => update({ tempMode: v })}
                  options={[
                    { id: 'absolute', label: 'Absolute', tip: 'A reading, e.g. 20 °C = 68 °F' },
                    { id: 'difference', label: 'Difference', tip: 'A change, e.g. a rise of 10 °C = a rise of 18 °F' },
                  ]}
                />
              </div>
            )}
            <div>
              <Label>Precision</Label>
              <div className="flex items-center gap-2">
                <Segmented
                  label="Precision type"
                  value={prefs.precision.mode}
                  onChange={(m) => update({ precision: { mode: m, n: m === 'dp' ? 4 : 6 } })}
                  options={[{ id: 'sig', label: 'Sig. figs', tip: 'Significant figures' }, { id: 'dp', label: 'Decimals', tip: 'Decimal places' }]}
                />
                <div className="w-24">
                  <VoiceInput
                    type="number"
                    value={String(prefs.precision.n)}
                    onChange={(v) => { const n = Math.max(0, Math.min(12, parseInt(v, 10))); if (!Number.isNaN(n)) update({ precision: { ...prefs.precision, n } }); }}
                    parse={(t) => { const n = parseSpokenNumber(t); return n === null ? null : String(Math.round(n)); }}
                    placeholder="n"
                    label="Number of digits"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Result */}
      <Card data-tour="measure-result" aria-live="polite">
        {problem && <p className="text-sm" style={{ color: '#b45309' }}>{problem}</p>}
        {!result && !problem && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Type or say a value to see the result.</p>}
        {result && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>{inputText} =</div>
                <div className="text-3xl sm:text-4xl font-semibold break-all" style={{ color: 'var(--color-text)' }}>{resultText}</div>
                {to.type === 'lookup' && <div className="text-xs mt-1" style={{ color: '#b45309' }}>Nearest gas mark — gas marks are a lookup table, not a formula.</div>}
                {prefs.tempMode === 'difference' && isTemp && <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Temperature difference (no offset applied).</div>}
              </div>
              <Tooltip text="Copy the result to the clipboard">
                <SecondaryButton onClick={copyResult}>{copied ? 'Copied ✓' : 'Copy result'}</SecondaryButton>
              </Tooltip>
            </div>
            {formulaUnit && (
              <div className="rounded-xl border p-3 text-sm flex flex-wrap items-center justify-between gap-2" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                <span><span className="text-xs mr-2" style={{ color: 'var(--color-muted)' }}>Formula:</span>{formulaLine}</span>
                <Tooltip text="See the factor, source and example in the formula library">
                  <button type="button" onClick={() => onOpenFormula(formulaUnit.id)} className={`text-xs underline hover:opacity-60 transition-opacity duration-200 ${FOCUS_RING}`} style={{ color: 'var(--color-primary)' }}>See formula & source</button>
                </Tooltip>
              </div>
            )}
          </>
        )}
      </Card>

      {/* All units */}
      {result && rows.length > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Every {g?.name.replace(/ \(.*\)/, '').toLowerCase()} unit</h3>
            <SecondaryButton onClick={() => setShowAll((s) => !s)}>{showAll ? 'Hide' : 'Show'}</SecondaryButton>
          </div>
          {showAll && (
            <div className="grid gap-2 sm:grid-cols-2">
              {rows.map(({ unit, value }) => (
                <div key={unit.id} className="rounded-xl border px-3 py-2 flex items-center justify-between gap-2" style={{ background: 'var(--color-bg)', borderColor: unit.id === toId ? 'var(--color-primary)' : 'var(--color-border)' }}>
                  <button type="button" onClick={() => update({ toId: unit.id })} className={`text-left min-w-0 hover:opacity-60 transition-opacity duration-200 ${FOCUS_RING}`} title="Use as the target unit">
                    <div className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>{unit.name}</div>
                    <div className="text-sm font-medium break-all" style={{ color: 'var(--color-text)' }}>{formatNumber(value, prefs.precision)} {unitShort(unit)}</div>
                  </button>
                  <button type="button" onClick={() => onOpenFormula(unit.id)} className={`text-[11px] underline flex-shrink-0 hover:opacity-60 ${FOCUS_RING}`} style={{ color: 'var(--color-primary)' }}>formula</button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* History */}
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Recent conversions</h3>
          <div className="flex gap-2">
            {history.length > 0 && <SecondaryButton onClick={clearHistory}>Clear</SecondaryButton>}
            <SecondaryButton onClick={() => setShowHistory((s) => !s)}>{showHistory ? 'Hide' : `Show (${history.length})`}</SecondaryButton>
          </div>
        </div>
        {showHistory && (history.length === 0
          ? <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Nothing yet. Conversions appear here once you pause on a result.</p>
          : (
            <ul className="space-y-1.5">
              {history.map((h) => (
                <li key={h.t}>
                  <button type="button" onClick={() => restore(h)} className={`w-full text-left rounded-xl border px-3 py-2 text-sm hover:opacity-60 transition-opacity duration-200 ${FOCUS_RING}`} style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    {h.text}
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </Card>
    </div>
  );
}
