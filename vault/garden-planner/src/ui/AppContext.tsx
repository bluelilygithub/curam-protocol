import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { App } from '../createApp';
import type { ProjectActions, ProjectState } from '../state/projectStore';
import type { UiActions, UiState } from '../state/uiStore';

export const AppContext = createContext<App | null>(null);

export function useApp(): App {
  const a = useContext(AppContext);
  if (!a) throw new Error('AppContext missing');
  return a;
}

export function useUi<T>(sel: (s: UiState & UiActions) => T): T {
  return useStore(useApp().ui, sel);
}
export function useProject<T>(sel: (s: ProjectState & ProjectActions) => T): T {
  return useStore(useApp().project, sel);
}
