// Shepherd tour helpers shared by the planners. Shepherd keeps every earlier step's card in the page, hidden, so "the card" must always
// mean the one that is showing: looking up the first `.shepherd-element` finds a hidden one, which put the step counter on the wrong card
// (and left keyboard focus outside the visible one). DOM only: it does not import Shepherd.

const CARD = '.shepherd-element.vault-tour';

/** The card that is showing now, or null (before the next step's card has been drawn). */
export function visibleTourCard(root: ParentNode = document): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>(CARD)].find((el) => !el.hasAttribute('hidden')) ?? null;
}

/**
 * Keep keyboard focus inside the showing card, so Esc and the arrow keys keep working after a step's button is replaced. Shepherd listens
 * for those keys on the card itself, and the card cannot take focus until it has a tabindex.
 */
export function focusTourCard(root: ParentNode = document): void {
  const el = visibleTourCard(root);
  if (!el) return;
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

/**
 * Put "Step n of total" on the showing card (just above its buttons) and focus it. The card is drawn a frame or two after Shepherd's
 * `show`, so this retries briefly. Focus is taken again a moment later because Shepherd moves it while it positions the card.
 */
export function injectStepCounter(n: number, total: number, tries = 20): void {
  requestAnimationFrame(() => {
    const el = visibleTourCard();
    const footer = el?.querySelector('.shepherd-footer');
    if (!el || !footer) { if (tries > 0) injectStepCounter(n, total, tries - 1); return; }
    let c = el.querySelector('.vault-tour-step-count');
    if (!c) {
      c = document.createElement('div');
      c.className = 'vault-tour-step-count';
      footer.parentElement?.insertBefore(c, footer);
    }
    c.textContent = `Step ${n} of ${total}`;
    focusTourCard();
    window.setTimeout(() => focusTourCard(), 300);
  });
}
