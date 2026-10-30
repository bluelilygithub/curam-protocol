import { useEffect, useLayoutEffect, useState } from 'react';
import { TOUR_STEPS } from '../lib/help';

interface Box { top: number; left: number; width: number; height: number }

/**
 * A short guided tour (the shelf's version of Vault's compass tour): a spotlight on one part of the page and a card that says what it is. Steps whose
 * target is not on screen are skipped. Esc or Skip ends it.
 */
export default function Tour({ onDone }: { onDone: () => void }) {
  const [steps] = useState(() => TOUR_STEPS.filter((s) => document.querySelector(`[data-tour="${s.target}"]`)));
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const step = steps[i];

  useLayoutEffect(() => {
    const measure = () => {
      const el = step ? document.querySelector(`[data-tour="${step.target}"]`) : null;
      if (!el) { setBox(null); return; }
      const r = el.getBoundingClientRect();
      setBox({ top: r.top - 4, left: r.left - 4, width: r.width + 8, height: r.height + 8 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step]);

  useEffect(() => { if (steps.length === 0) onDone(); }, [steps.length, onDone]);
  if (!step || !box) return null;

  const last = i === steps.length - 1;
  const below = box.top + box.height + 160 < window.innerHeight;
  const cardLeft = Math.min(Math.max(box.left, 12), Math.max(12, window.innerWidth - 300));
  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Guided tour">
      <div className="absolute rounded-card pointer-events-none transition-all duration-200" style={{ top: box.top, left: box.left, width: box.width, height: box.height, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)' }} />
      <div className="absolute w-[288px] rounded-card border border-shelf-line bg-shelf-card text-shelf-text shadow-2xl p-3.5 space-y-2" style={{ left: cardLeft, top: below ? box.top + box.height + 10 : Math.max(8, box.top - 160) }}>
        <div className="text-[11px] text-shelf-muted">Step {i + 1} of {steps.length}</div>
        <h2 className="m-0 text-sm font-semibold">{step.title}</h2>
        <p className="m-0 text-xs leading-relaxed">{step.text}</p>
        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={onDone} className="text-xs text-shelf-muted hover:opacity-70 transition-opacity">Skip</button>
          <div className="ml-auto flex gap-2">
            {i > 0 && <button type="button" onClick={() => setI(i - 1)} className="px-3 py-1 rounded-lg text-xs border border-shelf-line hover:opacity-70 transition-opacity">Back</button>}
            <button type="button" autoFocus onClick={() => (last ? onDone() : setI(i + 1))} className="px-3 py-1 rounded-lg text-xs font-medium bg-shelf-accent text-shelf-onaccent hover:opacity-80 transition-opacity">{last ? 'Done' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
