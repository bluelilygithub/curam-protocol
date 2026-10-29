// Windowing for the horizontal card strip: only the cards in (or just outside) view are rendered, so 100 clips never put 100 cards in the page.

export interface WindowInput { scroll: number; viewport: number; itemSize: number; gap: number; count: number; overscan?: number }
export interface WindowOutput { start: number; end: number; total: number; step: number }

export function windowFor({ scroll, viewport, itemSize, gap, count, overscan = 2 }: WindowInput): WindowOutput {
  const step = itemSize + gap;
  const total = count > 0 ? count * step - gap : 0;
  if (count <= 0 || step <= 0) return { start: 0, end: 0, total, step };
  const first = Math.max(0, Math.floor(Math.max(0, scroll) / step) - overscan);
  const last = Math.min(count, Math.ceil((Math.max(0, scroll) + Math.max(0, viewport)) / step) + overscan);
  return { start: Math.min(first, count), end: Math.max(Math.min(first, count), last), total, step };
}

/** The scroll position that brings card `index` fully into view with the least movement (unchanged when it already is). */
export function scrollToReveal(index: number, scroll: number, viewport: number, itemSize: number, gap: number): number {
  const step = itemSize + gap;
  const left = index * step;
  const right = left + itemSize;
  if (left < scroll) return left;
  if (right > scroll + viewport) return Math.max(0, right - viewport);
  return scroll;
}
