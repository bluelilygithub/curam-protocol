import type { Project } from './types';

export class SerializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SerializeError';
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** JSON with keys sorted recursively; `undefined` properties are dropped; -0 never appears. */
export function canonicalStringify(value: unknown, indent?: number): string {
  return JSON.stringify(sortKeys(value), (_k, v) => (v === 0 ? 0 : v), indent);
}

export function serializeProject(project: Project): string {
  return canonicalStringify(project, 2) + '\n';
}

export function deserializeProject(json: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new SerializeError('invalid JSON');
  }
  if (!data || typeof data !== 'object') throw new SerializeError('project must be an object');
  const p = data as Partial<Project>;
  if (p.schemaVersion !== 1) throw new SerializeError(`unsupported schemaVersion: ${String(p.schemaVersion)}`);
  if (typeof p.id !== 'string' || !Array.isArray(p.rooms) || !Array.isArray(p.furnitureDefinitions) || !Array.isArray(p.materials)) {
    throw new SerializeError('malformed project');
  }
  return p as Project;
}
