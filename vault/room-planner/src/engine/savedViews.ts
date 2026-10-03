import { quantizeLinear } from './coordinates';
import type { Project, SavedView } from './types';

// Saved 3D viewpoints (M4, D44). Pure project → project functions; they never touch rooms, so they cannot affect validation,
// and the store applies them without a history entry.

const MAX_NAME = 60;
const q = (v: [number, number, number]): [number, number, number] => [quantizeLinear(v[0]), quantizeLinear(v[1]), quantizeLinear(v[2])];

export function cleanViewName(name: string, fallback: string): string {
  const n = name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  return n || fallback;
}

export const savedViewsOf = (p: Project): SavedView[] => p.savedViews ?? [];

/** Next free "View n" name. */
export function nextViewName(p: Project): string {
  const used = new Set(savedViewsOf(p).map((v) => v.name));
  for (let n = 1; ; n++) if (!used.has(`View ${n}`)) return `View ${n}`;
}

export function addSavedView(p: Project, view: Omit<SavedView, 'name'> & { name?: string }): Project {
  const saved: SavedView = {
    ...view,
    name: cleanViewName(view.name ?? '', nextViewName(p)),
    cameraPosition: q(view.cameraPosition),
    target: q(view.target),
    ...(view.zoom !== undefined ? { zoom: Math.round(view.zoom * 1000) / 1000 } : {}),
  };
  return { ...p, savedViews: [...savedViewsOf(p), saved] };
}

export function renameSavedView(p: Project, id: string, name: string): Project {
  const views = savedViewsOf(p);
  const cur = views.find((v) => v.id === id);
  if (!cur) return p;
  const next = cleanViewName(name, cur.name);
  return { ...p, savedViews: views.map((v) => (v.id === id ? { ...v, name: next } : v)) };
}

export function deleteSavedView(p: Project, id: string): Project {
  const views = savedViewsOf(p);
  if (!views.some((v) => v.id === id)) return p;
  return { ...p, savedViews: views.filter((v) => v.id !== id) };
}
