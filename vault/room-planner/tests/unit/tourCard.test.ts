import { describe, expect, it } from 'vitest';
import { focusTourCard, visibleTourCard } from '@planner-core/help/tourCard';

// Shepherd keeps earlier steps' cards in the page, hidden. These stand in for the DOM (the unit tests run without a browser); the real
// thing is covered by the Chrome tours in both apps.
const card = (id: string, hidden: boolean) => {
  const attrs = new Map<string, string>(hidden ? [['hidden', '']] : []);
  const el = {
    id, focused: false,
    hasAttribute: (n: string) => attrs.has(n),
    setAttribute: (n: string, v: string) => { attrs.set(n, v); },
    getAttribute: (n: string) => attrs.get(n) ?? null,
    focus: () => { el.focused = true; },
  };
  return el;
};
const root = (cards: Array<ReturnType<typeof card>>) => ({ querySelectorAll: () => cards }) as unknown as ParentNode;

describe('tour card lookup', () => {
  it('finds the showing card, not an earlier hidden one', () => {
    const welcome = card('welcome', true);
    const second = card('second', false);
    expect(visibleTourCard(root([welcome, second]))).toBe(second);
  });

  it('finds the showing card even when it comes first in the page', () => {
    const shown = card('shown', false);
    expect(visibleTourCard(root([shown, card('old', true)]))).toBe(shown);
  });

  it('returns null when every card is hidden (the next one is not drawn yet)', () => {
    expect(visibleTourCard(root([card('a', true), card('b', true)]))).toBeNull();
    expect(visibleTourCard(root([]))).toBeNull();
  });

  it('focuses only the showing card, and gives it a tabindex so it can take focus', () => {
    const old = card('old', true);
    const shown = card('shown', false);
    focusTourCard(root([old, shown]));
    expect(shown.focused).toBe(true);
    expect(shown.getAttribute('tabindex')).toBe('-1');
    expect(old.focused).toBe(false);
  });
});
