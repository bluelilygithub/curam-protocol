import { describe, expect, it } from 'vitest';
import { visibleJobs } from '../src/ui/JobsPage';
import type { DesignEntry } from '../src/app/designLibrary';

const e = (id: string, name: string, updatedAt: string): DesignEntry => ({ id, name, updatedAt, runCount: 1, rackUnits: 2, estimated: false });
const list = [e('a', 'Smith cellar', '2026-10-01T00:00:00Z'), e('b', 'Adams wine room', '2026-10-05T00:00:00Z'), e('c', 'smith garage', '2026-09-01T00:00:00Z')];

describe('the Jobs page list', () => {
  it('shows the most recently saved first, or A to Z', () => {
    expect(visibleJobs(list, '', 'recent').map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(visibleJobs(list, '', 'name').map((x) => x.id)).toEqual(['b', 'a', 'c'].sort((p, q) => list.find((x) => x.id === p)!.name.localeCompare(list.find((x) => x.id === q)!.name)));
  });
  it('searches by name, ignoring case, every word must match', () => {
    expect(visibleJobs(list, 'SMITH', 'recent').map((x) => x.id)).toEqual(['a', 'c']);
    expect(visibleJobs(list, 'smith cellar', 'recent').map((x) => x.id)).toEqual(['a']);
    expect(visibleJobs(list, 'nobody', 'recent')).toEqual([]);
    expect(visibleJobs(list, '   ', 'recent')).toHaveLength(3);
  });
  it('does not change the list it is given', () => {
    const copy = [...list];
    visibleJobs(list, '', 'name');
    expect(list).toEqual(copy);
  });
});
