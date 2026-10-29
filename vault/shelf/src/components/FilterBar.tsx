import { FILTERS, type FilterId } from '../lib/describe';

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
            className={`px-3 py-1 rounded-full text-[12.5px] font-medium transition-colors duration-150 ${on ? 'bg-shelf-accent text-white' : 'text-shelf-text hover:bg-shelf-text/10'}`}
          >
            {f.label}<span className={`ml-1.5 text-[11px] ${on ? 'text-white/80' : 'text-shelf-muted'}`}>{counts[f.id]}</span>
          </button>
        );
      })}
      <button type="button" onClick={onSettings} className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-shelf-muted hover:text-shelf-text hover:bg-shelf-text/10 transition-colors" title="Settings" aria-label="Settings">
        <span aria-hidden="true" className="text-[15px] leading-none">⚙</span>
      </button>
    </div>
  );
}
