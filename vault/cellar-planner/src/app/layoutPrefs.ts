// How the person has arranged the screen: the width of the controls panel and whether the controls and checks panels are hidden. Kept in this browser
// (not in the design, and not shared). Reading it never throws and never trusts what it finds: anything odd gives the standard layout.

export interface LayoutPrefs { leftW: number; leftHidden: boolean; rightHidden: boolean }
export const LAYOUT_KEY = 'cellar-planner:layout:v1';
export const LEFT_MIN = 240, LEFT_MAX = 560, LEFT_DEFAULT = 330;
export const DEFAULT_LAYOUT: LayoutPrefs = { leftW: LEFT_DEFAULT, leftHidden: false, rightHidden: false };

export const clampLeft = (w: number): number => (Number.isFinite(w) ? Math.min(LEFT_MAX, Math.max(LEFT_MIN, Math.round(w))) : LEFT_DEFAULT);

type Reader = { getItem(k: string): string | null };
type Writer = { setItem(k: string, v: string): void };

export function loadLayout(storage: Reader | undefined): LayoutPrefs {
  try {
    const raw = storage?.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return DEFAULT_LAYOUT;
    return { leftW: typeof o.leftW === 'number' ? clampLeft(o.leftW) : LEFT_DEFAULT, leftHidden: o.leftHidden === true, rightHidden: o.rightHidden === true };
  } catch { return DEFAULT_LAYOUT; }
}
export function saveLayout(storage: Writer | undefined, l: LayoutPrefs): void {
  try { storage?.setItem(LAYOUT_KEY, JSON.stringify({ leftW: clampLeft(l.leftW), leftHidden: l.leftHidden, rightHidden: l.rightHidden })); } catch { /* storage blocked or full: the layout just does not stick */ }
}
