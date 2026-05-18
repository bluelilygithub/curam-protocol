import { create } from 'zustand';

/**
 * Global processing state.
 *
 * Usage:
 *   const { startProcessing, stopProcessing } = useProcessingStore();
 *   startProcessing('Generating briefing…');
 *   // ... await long operation ...
 *   stopProcessing();
 *
 * ProcessingModal (rendered once in App.jsx) reads this store and blocks
 * the UI with an overlay while a message is set.
 */
const useProcessingStore = create((set) => ({
  message: null,
  detail: null,
  startProcessing: (message, detail = null) => set({ message, detail }),
  stopProcessing: () => set({ message: null, detail: null }),
}));

export default useProcessingStore;
