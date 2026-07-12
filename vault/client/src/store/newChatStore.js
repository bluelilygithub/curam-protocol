import { create } from 'zustand';

/**
 * Global New chat modal state.
 *
 * Usage:
 *   import { openNewChatModal } from '../utils/openNewChatModal';
 *   openNewChatModal({ defaultMode: 'project', defaultProjectId: '12' });
 *
 * NewChatModalHost (rendered once in App.jsx) reads this store.
 */
const useNewChatStore = create((set) => ({
  options: null,
  openNewChatModal: (detail = {}) => set({ options: detail }),
  closeNewChatModal: () => set({ options: null }),
}));

export default useNewChatStore;
