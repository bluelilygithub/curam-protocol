import type { ToastState } from '../hooks';
import Icon from './Icon';

/** A short confirmation that slides up over the bottom of the preview and fades away by itself. */
export default function Toast({ toast }: { toast: ToastState | null }) {
  return (
    // sits over the right half, above the row of buttons, so it never covers a button you may want next
    <div className="pointer-events-none absolute right-5 bottom-[76px] z-20" aria-live="polite" role="status">
      {toast && (
        <div
          key={toast.id}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-medium shadow-lg border transition-all duration-200 ${toast.leaving ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0 animate-[toastIn_.2s_ease-out]'} ${toast.kind === 'error' ? 'bg-shelf-danger text-white border-transparent' : 'bg-shelf-card text-shelf-text border-shelf-line/15'}`}
        >
          <Icon name={toast.kind === 'error' ? 'x' : 'check'} size={14} className={toast.kind === 'error' ? '' : 'text-shelf-ok'} />
          {toast.text}
        </div>
      )}
    </div>
  );
}
