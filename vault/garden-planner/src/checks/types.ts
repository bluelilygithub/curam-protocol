// The checks (spec 5): each finds a problem in the plan, says WHY in plain words, and where it makes sense offers a fix. Pure data in, issues out.
import type { SunThresholds } from '../plants/suitability';
import type { ItemKind } from '../state/uiStore';
import type { Vec2 } from '../domain/types';

/** error = fix it (red), warning = probably fix it (amber), info = worth knowing (grey). */
export type Severity = 'error' | 'warning' | 'info';

export type CheckType =
  | 'placement' | 'spacing' | 'boundary' | 'house_distance' | 'service_distance' | 'sun'
  | 'climate' | 'frost' | 'weed' | 'weed_unknown' | 'pets'
  | 'path_width' | 'mower_access' | 'gate_swing';

export interface ItemRef { kind: ItemKind; id: string }

/** What "Fix" does. Applied as one undoable step. */
export type Fix =
  /** Move the plant to the nearest spot that clears its position problems. The spot is found when the button is pressed. */
  | { kind: 'move_plant'; plantId: string; label: string }
  | { kind: 'replace'; sel: ItemRef; next: unknown; label: string };

export interface Issue {
  /** Stable for the same problem, so the list does not jump about as you edit. */
  id: string;
  type: CheckType;
  severity: Severity;
  title: string;
  /** The reason, in plain words. Ends with the draft label when it rests on plant data. */
  message: string;
  /** True when plant data (sizes, frost, sun, weed or pet flags) is part of the reason. Such messages say "draft, unverified". */
  usesPlantData: boolean;
  /** What to select when you click the issue. */
  items: ItemRef[];
  /** Where it is on the plan (for centring the view). */
  at?: Vec2;
  fix?: Fix;
}

export interface CheckSettings {
  /** Narrowest comfortable path (default 0.9 m). */
  pathMinWidth: number;
  /** Width of the mower that has to get to the lawns (default 0.9 m). */
  mowerWidth: number;
  sun: SunThresholds;
}

export const DEFAULT_PATH_MIN_WIDTH = 0.9;
export const DEFAULT_MOWER_WIDTH = 0.9;
export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
