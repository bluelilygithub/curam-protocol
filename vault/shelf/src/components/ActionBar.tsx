import type { ActionId } from '../bridge/types';
import type { ActionState } from '../lib/settings';

/** The quick-action buttons under the preview: only the ones switched on in Settings, greyed (with the reason on hover) when the key cannot do them. */
export default function ActionBar({ actions, busy, onAction }: { actions: ActionState[]; busy: ActionId | null; onAction: (a: ActionId) => void }) {
  if (actions.length === 0) return <div className="text-[11px] text-shelf-muted">All quick actions are switched off in Settings.</div>;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Send to Vault">
      {actions.map((a) => {
        const working = busy === a.id;
        return (
          <button
            key={a.id}
            type="button"
            disabled={!a.enabled || busy !== null}
            onClick={() => onAction(a.id)}
            title={a.enabled ? undefined : a.reason}
            aria-disabled={!a.enabled}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-[opacity,background-color] ${a.enabled ? 'border-shelf-line bg-shelf-card/80 text-shelf-text hover:opacity-70' : 'border-shelf-line text-shelf-muted opacity-60 cursor-not-allowed'} ${working ? 'opacity-70' : ''}`}
          >
            {working ? 'Sending…' : a.label}
          </button>
        );
      })}
    </div>
  );
}
