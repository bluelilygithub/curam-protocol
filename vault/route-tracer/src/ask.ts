import type { GeocodeResult, PlanProfile } from './api';
import type { Pos } from './geo';

/**
 * The top box takes a plain-English request ("give me a route from Morningside to Carindale") as well as a place name. The server works out
 * WHAT is wanted (api.ask: a kind, two place names, a length, a way of travelling); this file decides whether a line of text is a request at
 * all, finds the places, and sets Plan route up exactly as if the person had filled it in by hand, so they can see, correct and change it.
 */

export interface Intent {
  kind: 'direct' | 'loop' | 'detour' | 'none';
  from: string | null;
  to: string | null;
  lengthKm: number | null;
  profile: PlanProfile | null;
}

/**
 * Whether a line looks like a request rather than a place to find: it names a route, a loop, a way of travelling, a length, or "from"/"to",
 * or it is a whole sentence. A bare name ("Carindale", "12 Smith St, Morningside") is a place search, as before.
 */
export function looksLikeRequest(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (t.split(' ').length >= 5) return true;
  return /\b(?:routes?|loops?|circuits?|directions?|walk(?:ing)?|run(?:ning)?|ride|riding|cycl\w*|bike|biking|drive|driving|hike|hiking|km|kms|kilomet\w+|miles?|from|how|plan|give|take)\b/i.test(t) || /\s(?:to|->)\s/i.test(t);
}

export interface PlanActions {
  start(): void;
  setKind(k: 'direct' | 'loop' | 'detour'): void;
  setProfile(p: PlanProfile): void;
  setLengthKm(km: number): void;
  setDetourKm(km: number | null): void;
  setFrom(p: Pos, name: string): void;
  setTo(p: Pos, name: string): void;
}

export type AskResult =
  | { ok: true; summary: string; points: Pos[] }
  | { ok: false; message: string };

const PROFILE_WORD: Record<PlanProfile, string> = { walking: 'walking', hiking: 'hiking', cycling: 'cycling', driving: 'driving' };

/**
 * Find the places and set up Plan route. `find` looks one name up (nearest to where the map is looking) and returns null if there is no such
 * place. Nothing is changed unless every place was found, so a half-understood request never leaves a half-set-up plan.
 */
export async function planFromIntent(intent: Intent, find: (name: string) => Promise<GeocodeResult | null>, plan: PlanActions): Promise<AskResult> {
  if (intent.kind === 'none' || !intent.from) return { ok: false, message: 'I could not find a route in that. Try: route from Morningside to Carindale.' };
  const needsTo = intent.kind !== 'loop';
  if (needsTo && !intent.to) return { ok: false, message: 'I need two places for that: where from, and where to.' };
  const [a, b] = await Promise.all([find(intent.from), needsTo && intent.to ? find(intent.to) : Promise.resolve(null)]);
  if (!a) return { ok: false, message: `I could not find "${intent.from}". Try a fuller name, like the suburb and city.` };
  if (needsTo && !b) return { ok: false, message: `I could not find "${intent.to}". Try a fuller name, like the suburb and city.` };
  plan.start();
  plan.setKind(intent.kind);
  if (intent.profile) plan.setProfile(intent.profile);
  if (intent.kind === 'loop' && intent.lengthKm) plan.setLengthKm(intent.lengthKm);
  if (intent.kind === 'detour') plan.setDetourKm(intent.lengthKm);
  plan.setFrom([a.lng, a.lat], a.label);
  if (needsTo && b) plan.setTo([b.lng, b.lat], b.label);
  const way = intent.profile ? `${PROFILE_WORD[intent.profile]} ` : '';
  const len = intent.lengthKm ? ` of about ${+intent.lengthKm.toFixed(1)} km` : '';
  const summary = intent.kind === 'loop'
    ? `Planning a ${way}loop${len} from ${a.label}…`
    : `Planning a ${way}route${len} from ${a.label} to ${b?.label}…`;
  return { ok: true, summary, points: needsTo && b ? [[a.lng, a.lat], [b.lng, b.lat]] : [[a.lng, a.lat]] };
}
