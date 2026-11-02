import React from 'react';
import ChordDiagram from './ChordDiagram';
import { GlossText } from './GlossaryTerm';
import { changesFor } from './fingering.mjs';

/**
 * Finger patterns for a loop of chords: for each change, two small diagrams (a ring marks a note that stays held), a one-line count, the
 * step by step instructions in plain words and a tip. Chords with no fingering in the table say so instead of guessing.
 * sequence: ['A', 'D', 'E'] goes A to D, D to E and E back to A.
 */
export default function FingerMoves({ sequence }) {
  const changes = changesFor(sequence);
  return (
    <div className="flex flex-col gap-3" data-tour="guitar-fingers">
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        <GlossText text="A ring on a diagram marks a note that stays held while you change, so that finger can stay where it is. Numbers are fingers: 1 is your index finger, 2 middle, 3 ring, 4 little." />
      </p>
      {changes.map((c, i) => (
        <div key={`${c.from}-${c.to}-${i}`} className="rounded-lg border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <p className="text-sm font-semibold font-mono" style={{ color: 'var(--color-text)' }}>{c.from} → {c.to}</p>
          {!c.ok ? (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{c.reason} Look the chord up in a chart and work the change out slowly.</p>
          ) : (
            <>
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex flex-col items-center"><span className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{c.from}</span><ChordDiagram shape={c.shapeFrom} anchors={c.anchors} /></div>
                <span aria-hidden="true" className="text-lg pt-10" style={{ color: 'var(--color-muted)' }}>→</span>
                <div className="flex flex-col items-center"><span className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{c.to}</span><ChordDiagram shape={c.shapeTo} anchors={c.anchors} /></div>
                <div className="flex-1 min-w-[180px] flex flex-col gap-1">
                  <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{c.summary}</p>
                  <ul className="list-disc pl-4 flex flex-col gap-0.5">
                    {c.lines.map((l, j) => <li key={j} className="text-xs" style={{ color: 'var(--color-text)' }}><GlossText text={l} /></li>)}
                  </ul>
                </div>
              </div>
              <p className="text-xs" style={{ color: 'var(--color-text)' }}><strong>Tip:</strong> <GlossText text={c.tip} /></p>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
