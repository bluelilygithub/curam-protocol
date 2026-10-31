import { create } from 'zustand';

// Which self-appearing popups currently want to show (see utils/popupQueue.mjs and hooks/usePopupSlot.js).
const usePopupStore = create((set) => ({
  wanting: [],
  want: (id) => set((s) => (s.wanting.includes(id) ? s : { wanting: [...s.wanting, id] })),
  unwant: (id) => set((s) => (s.wanting.includes(id) ? { wanting: s.wanting.filter((x) => x !== id) } : s)),
}));

export default usePopupStore;
