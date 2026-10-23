import api from './apiClient';
import useToastStore from '../store/toastStore';

// After deleting something that went to the shared recycle bin (30 days): a toast with Undo that restores it.
// `binIds` are the ids the delete returned; `after` reloads the screen's list once they are back.
export function offerUndo({ message, binIds, restoredMessage = 'Restored ✓', after }) {
  const ids = (Array.isArray(binIds) ? binIds : [binIds]).filter(Boolean);
  const { addToast } = useToastStore.getState();
  if (!ids.length) { addToast(message, 'success'); return; }
  addToast(message, 'success', undefined, {
    label: 'Undo',
    onClick: async () => {
      try {
        for (const id of ids) {
          const res = await api.post(`/api/recycle-bin/${id}/restore`);
          if (!res.ok) throw new Error('restore failed');
        }
        after?.();
        addToast(restoredMessage, 'success');
      } catch {
        after?.();
        addToast('That could not be restored. Look in Settings → Recycle bin.', 'error');
      }
    },
  });
}
