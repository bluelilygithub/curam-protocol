import useNewChatStore from '../store/newChatStore';

/** Open a new chat in the given context (routes immediately; no modal). */
export function openNewChatModal(detail = {}) {
  useNewChatStore.getState().openNewChatModal(detail);
}
