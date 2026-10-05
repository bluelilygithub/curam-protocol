import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Embedded in Vault's shell (?embedded=1): Vault's own nav already names the page.
if (new URLSearchParams(window.location.search).has('embedded')) document.documentElement.dataset.embedded = '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
