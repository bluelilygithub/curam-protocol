import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import ChordDiagram from './ChordDiagram';
import { GlossText } from './GlossaryTerm';
import { GT } from './guitarTips.mjs';
import { MAJOR_MINOR_PAIRS, pairDifference } from './pairs.mjs';
import { describeChange } from './fingering.mjs';
import { playChordSound, audioContextFrom } from './chordSound.js';

const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const btnLine = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };

/**
 * Major and minor pairs: E and Em, A and Am, D and Dm. In each pair one note changes (the 3rd), so the drill is moving one finger back and
 * forth. Shows the two shapes with the changing note in words, plays them one after the other, starts the one-minute drill on the pair,
 * `onDrill({ a, b })` starts the drill.
 */
export default function MajorMinorPairs({ onDrill, refreshKey }) {
  const [bests, setBests] = useState([]);
  const ctxRef = useRef(null);

  useEffect(() => {
    api.get('/api/guitar/transitions/pairs').then(r => r.json()).then(d => setBests(Array.isArray(d) ? d : [])).catch(() => setBests([]));
  }, [refreshKey]);

  const hear = useCallback((major, minor) => {
    try {
      const ctx = audioContextFrom(ctxRef);
      const split = (name) => ({ root: name.replace(/m$/, ''), quality: name.endsWith('m') ? 'm' : '' });
      const a = split(major), b = split(minor);
      playChordSound(ctx, a.root, a.quality, 0);
      playChordSound(ctx, b.root, b.quality, 1.6);
    } catch (_) { /* no sound in this browser: the diagrams still work */ }
  }, []);

  return (
    <section className="rounded-xl border p-4 flex flex-col gap-3" style={card} data-tour="guitar-pairs">
      <div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Major and minor pairs</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          <GlossText text="In each of these pairs only one note changes: the 3rd. Moving that one finger back and forth is the quickest way to feel the difference between a major and a minor chord. Ringed notes stay held while you change." />
        </p>
      </div>
      {MAJOR_MINOR_PAIRS.map(([major, minor]) => {
        const diff = pairDifference(major, minor);
        const change = describeChange(major, minor);
        const best = bests.find(b => b.a === major && b.b === minor);
        if (!diff.ok || !change.ok) return null;
        return (
          <div key={major} className="rounded-lg border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <p className="text-sm font-semibold font-mono" style={{ color: 'var(--color-text)' }}>{major} ↔ {minor}</p>
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex flex-col items-center"><span className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{major}</span><ChordDiagram shape={diff.shapeMajor} anchors={change.anchors} /></div>
              <span aria-hidden="true" className="text-lg pt-10" style={{ color: 'var(--color-muted)' }}>↔</span>
              <div className="flex flex-col items-center"><span className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{minor}</span><ChordDiagram shape={diff.shapeMinor} anchors={change.anchors} /></div>
              <div className="flex-1 min-w-[180px] flex flex-col gap-1">
                <p className="text-xs" style={{ color: 'var(--color-text)' }}>{diff.sentence}</p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {best && best.tries > 0 ? `Best so far: ${best.bestRate} clean changes a minute.` : 'No one-minute score saved yet.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Tooltip text={GT.pairsDrill}>
                <button onClick={() => onDrill({ a: major, b: minor })} className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200"
                  style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>Drill</button>
              </Tooltip>
              <Tooltip text={GT.pairsHear}>
                <button onClick={() => hear(major, minor)} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={btnLine}>
                  Hear {major}, then {minor}
                </button>
              </Tooltip>
            </div>
          </div>
        );
      })}
    </section>
  );
}
