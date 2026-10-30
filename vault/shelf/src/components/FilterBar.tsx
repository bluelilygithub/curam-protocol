import { FILTERS, type FilterId } from '../lib/describe';
import { FILTER_TIPS, TIPS } from '../lib/tips';
import Icon from './Icon';
import Tooltip from './Tooltip';

export default function FilterBar({ filter, counts, onFilter, onSettings, onHelp }: { filter: FilterId; counts: Record<FilterId, number>; onFilter: (f: FilterId) => void; onSettings: () => void; onHelp: () => void }) {
  return (
    <div className="flex items-center gap-1.5" role="tablist" aria-label="Filter copies" data-tour="filters">
      {FILTERS.map((f) => {
        const on = f.id === filter;
        return (
          <Tooltip key={f.id} text={FILTER_TIPS[f.id]}>
          <button
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onFilter(f.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${on ? 'bg-shelf-accent text-shelf-onaccent' : 'text-shelf-text hover:opacity-70'}`}
          >
            {f.label}<span className={`ml-1.5 text-[11px] ${on ? 'text-shelf-onaccent/80' : 'text-shelf-muted'}`}>{counts[f.id]}</span>
          </button>
          </Tooltip>
        );
      })}
      <Tooltip text={TIPS.help}><button type="button" onClick={onHelp} data-tour="help" className="ml-auto inline-flex items-center px-2 py-1 rounded-lg text-shelf-muted hover:opacity-70 transition-opacity" aria-label="Help"><Icon name="info" size={16} /></button></Tooltip>
      <Tooltip text={TIPS.settings}><button type="button" onClick={onSettings} data-tour="settings" className="inline-flex items-center px-2 py-1 rounded-lg text-shelf-muted hover:opacity-70 transition-opacity" aria-label="Settings"><Icon name="gear" size={16} /></button></Tooltip>
    </div>
  );
}
