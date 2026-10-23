import React, { useEffect } from 'react';
import { useIcon } from '../../providers/IconProvider';
import RecycleBinPanel from '../../components/RecycleBinPanel';

/** Notes' window onto the shared recycle bin: only notes and note templates, so it stays about Notes. Everything else is in Settings. */
export default function RecentlyDeletedModal({ mobile, onRestored, onClose }) {
  const getIcon = useIcon();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`fixed inset-0 z-50 flex ${mobile ? 'items-end' : 'items-center'} justify-center`} style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        className={`w-full max-w-lg flex flex-col shadow-xl ${mobile ? 'rounded-t-2xl' : 'rounded-2xl m-4'}`}
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: '85dvh', paddingBottom: mobile ? 'max(16px, env(safe-area-inset-bottom))' : undefined }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Recently deleted"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Recently deleted</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)', minWidth: 40, minHeight: 40 }}>{getIcon('x', { size: 18 })}</button>
        </div>
        <div className="px-4 pb-4 overflow-y-auto flex-1 min-h-0">
          <RecycleBinPanel types={['note', 'note-template']} onRestored={onRestored} emptyHint="No deleted notes or templates. They wait here for 30 days after you delete them." />
        </div>
      </div>
    </div>
  );
}
