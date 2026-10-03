import { createContext, useContext, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { App } from '../createApp';
import type { FeedbackBus, FeedbackState } from '../state/feedbackBus';
import type { ProjectActions, ProjectState } from '../state/projectStore';
import type { UiActions, UiState } from '../state/uiStore';
import type { ViewActions, ViewState } from '../state/viewStore';

export const AppContext = createContext<App | null>(null);

export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error('AppContext missing');
  return app;
}

export const useProject = <T,>(sel: (s: ProjectState & ProjectActions) => T): T => useStore(useApp().project, sel);
export const useUi = <T,>(sel: (s: UiState & UiActions) => T): T => useStore(useApp().ui, sel);
export const useView = <T,>(sel: (s: ViewState & ViewActions) => T): T => useStore(useApp().view, sel);

/** Feedback bus as an external store: only components that read it re-render, and only at the bus's own (throttled) cadence. */
export function useBus<T>(sel: (s: FeedbackState) => T, bus?: FeedbackBus): T {
  const b = bus ?? useApp().bus;
  return useSyncExternalStore(
    (cb) => b.subscribe(() => cb()),
    () => sel(b.get()),
  );
}
