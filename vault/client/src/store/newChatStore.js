import { create } from 'zustand';

/**
 * Global new-chat routing state (navigation only — no modal UI).
 *
 * Usage:
 *   import { openNewChatModal } from '../utils/openNewChatModal';
 *   openNewChatModal({ defaultMode: 'project', defaultProjectId: '12' });
 *
 * NewChatModalHost (rendered once in App.jsx) navigates and dispatches vault:new-chat.
 */
const useNewChatStore = create((set) => ({
  options: null,
  openNewChatModal: (detail = {}) => set({ options: detail }),
  closeNewChatModal: () => set({ options: null }),
}));

export default useNewChatStore;
