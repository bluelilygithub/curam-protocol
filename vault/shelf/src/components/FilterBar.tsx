import { FILTERS, type FilterId } from '../lib/describe';
import Icon from './Icon';

export default function FilterBar({ filter, counts, onFilter, onSettings }: { filter: FilterId; counts: Record<FilterId, number>; onFilter: (f: FilterId) => void; onSettings: () => void }) {
  return (
    <div className="flex items-center gap-1.5" role="tablist" aria-label="Filter copies">
      {FILTERS.map((f) => {
        const on = f.id === filter;
        return (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onFilter(f.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${on ? 'bg-shelf-accent text-shelf-onaccent' : 'text-shelf-text hover:opacity-70'}`}
          >
            {f.label}<span className={`ml-1.5 text-[11px] ${on ? 'text-shelf-onaccent/80' : 'text-shelf-muted'}`}>{counts[f.id]}</span>
          </button>
        );
      })}
      <button type="button" onClick={onSettings} className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg text-shelf-muted hover:opacity-70 transition-colors" title="Settings" aria-label="Settings">
        <Icon name="gear" size={16} />
      </button>
    </div>
  );
}
