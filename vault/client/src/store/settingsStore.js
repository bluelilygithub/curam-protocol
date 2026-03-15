import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useSettingsStore = create(
  persist(
    (set) => ({
      font: 'DM Sans',
      theme: 'warm-sand',
      iconPack: 'lucide',
      sessionBudget: null, // null = off; number = USD limit per session
      budgetAlertThreshold: 80,     // % — amber warning appears at this level
      budgetCriticalThreshold: 100, // % — red critical alert appears at this level
      budgetReAlertFrequency: 'session', // 'session' | 'every10' | 'every20' | 'at95'
      allowedFileTypes: '.pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.php,.py,.css,.html,.sql,.sh,.env.example,image/*',
      setFont: (font) => set({ font }),
      setTheme: (theme) => set({ theme }),
      setIconPack: (iconPack) => set({ iconPack }),
      setSessionBudget: (budget) => set({ sessionBudget: budget }),
      setBudgetAlertThreshold: (v) => set({ budgetAlertThreshold: v }),
      setBudgetCriticalThreshold: (v) => set({ budgetCriticalThreshold: v }),
      setBudgetReAlertFrequency: (v) => set({ budgetReAlertFrequency: v }),
      setAllowedFileTypes: (v) => set({ allowedFileTypes: v }),
    }),
    {
      name: 'vault-settings',
    }
  )
);

export default useSettingsStore;
