import { describe, expect, it, vi } from 'vitest';
import { randomId } from '../../src/state/projectFactory';

describe('randomId', () => {
  it('is unique, and sorts in the order ids were made (so sorting by id lists things in creation order)', () => {
    const ids = Array.from({ length: 5000 }, () => randomId());
    expect(new Set(ids).size).toBe(5000);
    expect([...ids].sort()).toEqual(ids);
  });
  it('keeps order across milliseconds', () => {
    vi.useFakeTimers();
    try {
      const a = randomId();
      vi.advanceTimersByTime(5);
      const b = randomId();
      vi.advanceTimersByTime(60_000);
      const c = randomId();
      expect([a, b, c].sort()).toEqual([a, b, c]);
    } finally { vi.useRealTimers(); }
  });
  it('is a plain string with no spaces, safe as a key and in a URL', () => {
    expect(randomId()).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
  });
});
