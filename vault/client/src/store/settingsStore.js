import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useSettingsStore = create(
  persist(
    (set) => ({
      font: 'DM Sans',
      theme: 'warm-sand',
      iconPack: 'lucide',
      setFont: (font) => set({ font }),
      setTheme: (theme) => set({ theme }),
      setIconPack: (iconPack) => set({ iconPack }),
    }),
    {
      name: 'vault-settings',
    }
  )
);

export default useSettingsStore;
