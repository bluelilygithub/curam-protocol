import { HELP_SECTIONS } from '../lib/help';
import { TIPS } from '../lib/tips';
import Icon from './Icon';
import Tooltip from './Tooltip';

/** Plain-words help, the shelf's version of the (i) box in Video Tools. Opens by itself the first time, then from the (i) button. */
export default function HelpView({ onBack, onTour }: { onBack: () => void; onTour: () => void }) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-3">
        <Tooltip text={TIPS.back}><button type="button" onClick={onBack} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm hover:opacity-70 transition-opacity"><Icon name="back" size={16} /> Back</button></Tooltip>
        <h1 className="m-0 text-base font-semibold">How Vault Shelf works</h1>
        <Tooltip text={TIPS.tour}><button type="button" onClick={onTour} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs border border-shelf-line hover:opacity-70 transition-opacity"><Icon name="compass" size={14} /> Take the tour</button></Tooltip>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="grid gap-3 lg:grid-cols-2 pb-3">
          {HELP_SECTIONS.map((s) => (
            <section key={s.id} className="rounded-card border border-shelf-line bg-shelf-card/60 p-4 space-y-2" aria-labelledby={`help-${s.id}`}>
              <h2 id={`help-${s.id}`} className="m-0 text-sm font-semibold">{s.title}</h2>
              {s.body.map((p, i) => <p key={i} className="m-0 text-xs leading-relaxed text-shelf-text/90">{p}</p>)}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
