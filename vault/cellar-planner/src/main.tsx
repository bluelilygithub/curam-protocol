import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { analyseApp, testCaseProject } from './app/model';
import { createDesigns, loadDraft } from './app/designs';
import { createAppStore } from './app/store';
import { createCatalogueStore } from './app/catalogue';
import { createUiStore } from './app/uiStore';
import type { FetchLike } from './app/designLibrary';
import './styles.css';

// Embedded in Vault's shell (?embedded=1): Vault's own nav already names the page.
if (new URLSearchParams(window.location.search).has('embedded')) document.documentElement.dataset.embedded = '1';

// the first visit opens the ready-made Test case (best-guess racks, every value marked estimated), so there is never an empty screen to puzzle over;
// after that, the saved draft comes back
const store = createAppStore(loadDraft() ?? testCaseProject());
const ui = createUiStore(store.getState().project.enclosure.door.wall);
// the saved designs: the Vault account when signed in (the planner runs on Vault's origin, so it reads Vault's token), else this browser
// the rack catalogue and prices from Vault (Settings -> Cellar Planner): rack types to choose from, and the staff price breakdown
const catalogue = createCatalogueStore();
const designs = createDesigns({
  store, storage: localStorage, catalogue, newId: () => crypto.randomUUID(),
  fetch: typeof fetch === 'function' ? (((url, init) => fetch(url, init)) as FetchLike) : undefined,
  notify: (notice) => ui.getState().set({ notice }),
});
designs.start();
void catalogue.getState().load(typeof fetch === 'function' ? ((url, init) => fetch(url, init)) : undefined, localStorage);
// a handle for the browser tests, as the other planners have
(window as unknown as { cellar?: unknown }).cellar = { store, ui, designs, catalogue, analyse: () => analyseApp(store.getState().project) };

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><App store={store} ui={ui} designs={designs} catalogue={catalogue} /></StrictMode>);
