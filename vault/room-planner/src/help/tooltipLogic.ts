// Tooltip placement (pure, tested). Same behaviour as Vault's Tooltip component: centred on the control, above it, flipping below when
// there is no room, and kept 80 px inside the window edges so a 240 px card never runs off.
export interface Rect { left: number; right: number; top: number; bottom: number; width: number }
export interface Placement { top: number; left: number; above: boolean }

export const TOOLTIP_GAP = 8;
export const TOOLTIP_MIN_TOP = 40;
export const TOOLTIP_EDGE = 80;

export function placeTooltip(r: Rect, viewportWidth: number, side: 'top' | 'bottom' = 'top'): Placement {
  let above = side !== 'bottom';
  let top = above ? r.top - TOOLTIP_GAP : r.bottom + TOOLTIP_GAP;
  if (above && top < TOOLTIP_MIN_TOP) { top = r.bottom + TOOLTIP_GAP; above = false; }
  const centre = r.left + r.width / 2;
  const left = Math.min(Math.max(centre, TOOLTIP_EDGE), viewportWidth - TOOLTIP_EDGE);
  return { top, left, above };
}

/** The element's tip text: a native `title` (moved to data-tip on first hover so the browser's own tooltip never shows) or data-tip. */
export function tipOf(el: Element): string {
  return (el.getAttribute('title') ?? (el as HTMLElement).dataset?.tip ?? '').trim();
}
