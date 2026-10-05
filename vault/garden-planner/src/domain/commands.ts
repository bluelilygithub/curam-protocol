// Invertible commands for undo/redo. Every change to a project is one of these; `apply` is pure and never mutates its input.
import type { CollectionName, Collections, GardenProject, ProjectMeta, SingletonName } from './types';

/** Add (`from: null`), remove (`to: null`) or replace one item of a collection. */
export interface SetItemCommand<K extends CollectionName = CollectionName> {
  type: 'SetItem'; collection: K; id: string; from: Collections[K] | null; to: Collections[K] | null;
}
/** Set (or clear, with `null`) the boundary, the house or the underlay. */
export interface SetSingletonCommand {
  type: 'SetSingleton'; name: SingletonName; from: unknown | null; to: unknown | null;
}
export interface SetMetaCommand { type: 'SetMeta'; from: Partial<ProjectMeta>; to: Partial<ProjectMeta> }
export interface CompositeCommand { type: 'Composite'; commands: Command[] }

export type Command = SetItemCommand | SetSingletonCommand | SetMetaCommand | CompositeCommand;

export class ApplyError extends Error {
  constructor(public readonly code: 'ID_NOT_FOUND' | 'ID_EXISTS' | 'UNKNOWN_COMMAND', message: string) {
    super(`${code}: ${message}`);
    this.name = 'ApplyError';
  }
}

/** Typed helper so callers get the right item type per collection. */
export function setItem<K extends CollectionName>(collection: K, id: string, from: Collections[K] | null, to: Collections[K] | null): SetItemCommand<K> {
  return { type: 'SetItem', collection, id, from, to };
}

export function inverse(c: Command): Command {
  switch (c.type) {
    case 'SetItem': return { ...c, from: c.to, to: c.from } as Command;
    case 'SetSingleton': return { ...c, from: c.to, to: c.from };
    case 'SetMeta': return { type: 'SetMeta', from: c.to, to: c.from };
    case 'Composite': return { type: 'Composite', commands: [...c.commands].reverse().map(inverse) };
    default: throw new ApplyError('UNKNOWN_COMMAND', JSON.stringify(c));
  }
}

export function apply(c: Command, p: GardenProject): GardenProject {
  switch (c.type) {
    case 'SetItem': {
      const list = p[c.collection] as Array<{ id: string }>;
      const at = list.findIndex((x) => x.id === c.id);
      let next: Array<{ id: string }>;
      if (c.to === null) {
        if (at < 0) throw new ApplyError('ID_NOT_FOUND', `${c.collection}/${c.id}`);
        next = list.filter((_, i) => i !== at);
      } else if (at < 0) {
        if (c.from !== null) throw new ApplyError('ID_NOT_FOUND', `${c.collection}/${c.id}`);
        next = [...list, c.to as { id: string }];
      } else {
        if (c.from === null) throw new ApplyError('ID_EXISTS', `${c.collection}/${c.id}`);
        next = list.map((x, i) => (i === at ? (c.to as { id: string }) : x));
      }
      return { ...p, [c.collection]: next };
    }
    case 'SetSingleton': {
      const next: GardenProject = { ...p, [c.name]: c.to };
      if (c.to === null && c.name === 'underlay') delete next.underlay; // optional field: absent, not null
      return next;
    }
    case 'SetMeta': return { ...p, ...c.to };
    case 'Composite': return c.commands.reduce((acc, sub) => apply(sub, acc), p);
    default: throw new ApplyError('UNKNOWN_COMMAND', JSON.stringify(c));
  }
}
