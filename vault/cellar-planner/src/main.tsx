import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, loadDraft } from './App';
import { analyseApp } from './app/model';
import { createAppStore } from './app/store';
import './styles.css';

const store = createAppStore(loadDraft() ?? undefined);
// a handle for the browser tests, as the other planners have
(window as unknown as { cellar?: unknown }).cellar = { store, analyse: () => analyseApp(store.getState().project) };

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><App store={store} /></StrictMode>);
