import useNewChatStore from '../store/newChatStore';

/** Open the global New chat modal (Quick chat vs project). */
export function openNewChatModal(detail = {}) {
  useNewChatStore.getState().openNewChatModal(detail);
}
