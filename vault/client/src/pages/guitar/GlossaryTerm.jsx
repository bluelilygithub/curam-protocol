import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from '../../components/Tooltip';
import ChordDiagram from './ChordDiagram';
import { GT } from './guitarTips.mjs';
import { getTerm, findTerms } from './glossary.mjs';

const WIDTH = 300;

/** A small drawing for the terms that are not a chord shape. All SVG, no images. */
export function GlossaryDiagram({ diagram }) {
  if (!diagram) return null;
  if (diagram.kind === 'chord') return <ChordDiagram shape={diagram.shape} />;
  const stringYs = [12, 21, 30, 39, 48, 57];
  const fretXs = [20, 52, 84, 116, 148];
  const neck = (
    <>
      {stringYs.map(y => <line key={y} x1="20" x2="148" y1={y} y2={y} stroke="#9ca3af" strokeWidth="1" />)}
      {fretXs.map((x, i) => <line key={x} x1={x} x2={x} y1="12" y2="57" stroke={i === 0 ? '#1f2937' : '#d1d5db'} strokeWidth={i === 0 ? 3 : 1} />)}
    </>
  );
  const dot = (cx, cy, fill) => <circle cx={cx} cy={cy} r="5.5" fill={fill} />;
  const label = (x, y, t, anchor = 'middle') => <text x={x} y={y} fontSize="9" fill="#6b7280" textAnchor={anchor}>{t}</text>;
  const wrap = (children, h = 76) => <svg width="160" height={h} viewBox={`0 0 160 ${h}`} role="img" aria-hidden="true">{children}</svg>;

  switch (diagram.kind) {
    case 'capo':
      return wrap(<>{neck}<rect x="62" y="8" width="9" height="53" rx="3" fill="var(--color-primary)" />{label(66, 72, 'capo on fret 2')}</>);
    case 'neck':
      return wrap(<>{neck}{[1, 2, 3, 4].map((n, i) => label(36 + i * 32, 70, String(n)))}{label(20, 8, 'nut', 'start')}</>);
    case 'hammer':
      return wrap(<>{neck}{dot(68, 30, '#9ca3af')}{dot(132, 30, 'var(--color-primary)')}
        <path d="M70 22 Q100 8 130 22" fill="none" stroke="var(--color-primary)" strokeWidth="1.5" /><polygon points="130,22 124,15 123,23" fill="var(--color-primary)" />
        {label(100, 72, 'pick, then hammer down')}</>);
    case 'pulloff':
      return wrap(<>{neck}{dot(68, 30, 'var(--color-primary)')}{dot(132, 30, '#9ca3af')}
        <path d="M130 22 Q100 8 70 22" fill="none" stroke="var(--color-primary)" strokeWidth="1.5" /><polygon points="70,22 76,15 77,23" fill="var(--color-primary)" />
        {label(100, 72, 'pick, then pull off')}</>);
    case 'strum':
      return wrap(<>{stringYs.map(y => <line key={y} x1="10" x2="150" y1={y + 6} y2={y + 6} stroke="#d1d5db" strokeWidth="1" />)}
        <text x="42" y="42" fontSize="30" textAnchor="middle" fill="var(--color-primary)">↓</text><text x="118" y="42" fontSize="30" textAnchor="middle" fill="var(--color-primary)">↑</text>
        {label(42, 70, 'down')}{label(118, 70, 'up')}</>);
    default:
      return null;
  }
}

/**
 * A word with a dotted underline. Press it for a short explanation (and a small drawing where one helps). It closes when you press
 * anywhere else or Escape. Works by touch, because a hover tip cannot. `id` is a glossary id (glossary.mjs).
 */
export function GlossaryTerm({ id, children }) {
  const g = getTerm(id);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    // Escape closes only the explanation, not a window it sits in
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  if (!g) return <>{children}</>;

  const toggle = (e) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    const roomBelow = window.innerHeight - r.bottom;
    setPlace(roomBelow > 260 || roomBelow > r.top ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 });
    setOpen(true);
  };

  return (
    <>
      <Tooltip text={GT.glossTerm}>
        <button type="button" aria-expanded={open} onClick={toggle}
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'help', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
          {children ?? g.term}
        </button>
      </Tooltip>
      {open && place && createPortal(
        <div ref={box} role="dialog" aria-label={`${g.term}: what it means`}
          style={{
            position: 'fixed', zIndex: 70, width: WIDTH, maxWidth: 'calc(100vw - 16px)', ...place, padding: 12, borderRadius: 12,
            background: 'var(--color-bg)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            color: 'var(--color-text)', fontSize: '0.8rem', lineHeight: 1.45, textAlign: 'left', fontWeight: 400, fontStyle: 'normal', textTransform: 'none', letterSpacing: 'normal',
          }}>
          <p style={{ fontWeight: 700, marginBottom: 4 }}>{g.term}</p>
          <p style={{ margin: 0 }}>{g.short}</p>
          {g.diagram && <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center' }}><GlossaryDiagram diagram={g.diagram} /></div>}
        </div>,
        document.body,
      )}
    </>
  );
}

/** A sentence with the guitar words in it turned into GlossaryTerm links (each word once). */
export function GlossText({ text }) {
  return (
    <>
      {findTerms(text).map((p, i) => (p.id ? <GlossaryTerm key={i} id={p.id}>{p.text}</GlossaryTerm> : <React.Fragment key={i}>{p.text}</React.Fragment>))}
    </>
  );
}
