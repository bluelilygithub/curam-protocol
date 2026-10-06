import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, loadDraft } from './App';
import { analyseApp, testCaseProject } from './app/model';
import { createAppStore } from './app/store';
import { createUiStore } from './app/uiStore';
import './styles.css';

// Embedded in Vault's shell (?embedded=1): Vault's own nav already names the page.
if (new URLSearchParams(window.location.search).has('embedded')) document.documentElement.dataset.embedded = '1';

// the first visit opens the ready-made Test case (best-guess racks, every value marked estimated), so there is never an empty screen to puzzle over;
// after that, the saved draft comes back
const store = createAppStore(loadDraft() ?? testCaseProject());
const ui = createUiStore(store.getState().project.enclosure.door.wall);
// a handle for the browser tests, as the other planners have
(window as unknown as { cellar?: unknown }).cellar = { store, ui, analyse: () => analyseApp(store.getState().project) };

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><App store={store} ui={ui} /></StrictMode>);
