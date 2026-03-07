import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useSettingsStore = create(
  persist(
    (set) => ({
      font: 'DM Sans',
      theme: 'warm-sand',
      iconPack: 'lucide',
      sessionBudget: null, // null = off; number = USD limit per session
      allowedFileTypes: '.pdf,.txt,.md,.csv,.json,image/*',
      setFont: (font) => set({ font }),
      setTheme: (theme) => set({ theme }),
      setIconPack: (iconPack) => set({ iconPack }),
      setSessionBudget: (budget) => set({ sessionBudget: budget }),
      setAllowedFileTypes: (v) => set({ allowedFileTypes: v }),
    }),
    {
      name: 'vault-settings',
    }
  )
);

export default useSettingsStore;
