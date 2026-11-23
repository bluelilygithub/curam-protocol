import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// After a deploy, an open tab asks for chunks that no longer exist. Reload once to get the new build;
// the sessionStorage stamp stops a reload loop if the chunk is genuinely broken.
window.addEventListener('vite:preloadError', (event) => {
  let last = 0;
  try { last = Number(sessionStorage.getItem('chunkReloadAt')) || 0; } catch {}
  if (Date.now() - last < 10000) return;
  try { sessionStorage.setItem('chunkReloadAt', String(Date.now())); } catch {}
  event.preventDefault();
  window.location.reload();
});

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
