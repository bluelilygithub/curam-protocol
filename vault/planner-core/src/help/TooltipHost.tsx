// One themed tooltip for the whole planner (the same look as Vault's Tooltip: a small card, 200 ms fade, hover or keyboard focus, not on
// touch). Any element with a `title` (or `data-tip`) gets it, so every button, field and function is covered without wrapping each one;
// the native `title` is moved to `data-tip` while hovering so the browser's grey tooltip never competes.
import { useEffect, useRef, useState } from 'react';
import { placeTooltip, tipOf, type Placement } from './tooltipLogic';

const SHOW_DELAY_MS = 350;

export function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; at: Placement } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const current = useRef<Element | null>(null);

  useEffect(() => {
    // While hovering, the native title is moved to data-tip (so the browser's own tooltip never shows); it is put back afterwards, so
    // the control keeps its accessible name and anything that looks controls up by title still finds them.
    const restore = (el: Element | null): void => {
      if (el instanceof HTMLElement && el.dataset.tipFromTitle && !el.hasAttribute('title')) { el.setAttribute('title', el.dataset.tip ?? ''); delete el.dataset.tipFromTitle; }
    };
    const hide = (): void => { window.clearTimeout(timer.current); restore(current.current); current.current = null; setTip(null); };
    const show = (el: Element): void => {
      if (el instanceof HTMLElement && el.hasAttribute('title')) {
        const t = el.getAttribute('title') ?? '';
        // an icon-only control is named by its title; keep a name while the title is out of the way
        if (!el.hasAttribute('aria-label') && !(el.textContent ?? '').trim()) el.setAttribute('aria-label', t);
        el.dataset.tip = t; el.dataset.tipFromTitle = '1'; el.removeAttribute('title');
      }
      const text = tipOf(el);
      if (!text) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        setTip({ text, at: placeTooltip(el.getBoundingClientRect(), window.innerWidth) });
      }, SHOW_DELAY_MS);
    };
    const target = (e: Event): Element | null => (e.target instanceof Element ? e.target.closest('[title],[data-tip]') : null);
    const over = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return;
      const el = target(e);
      if (el === current.current) return;
      hide();
      if (el) { current.current = el; show(el); }
    };
    const focus = (e: FocusEvent): void => {
      const el = target(e);
      if (el && el !== current.current) { hide(); current.current = el; show(el); }
    };
    const out = (e: PointerEvent): void => {
      if (!current.current) return;
      const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest('[title],[data-tip]') : null;
      if (to !== current.current) hide();
    };
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('focusin', focus, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      document.removeEventListener('focusin', focus, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tip) return null;
  return (
    <span
      role="tooltip" className="rp-tooltip"
      style={{ top: tip.at.top, left: tip.at.left, transform: `translate(-50%, ${tip.at.above ? '-100%' : '0'})` }}
    >
      {tip.text}
    </span>
  );
}
