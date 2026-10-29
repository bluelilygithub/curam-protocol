import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './fonts';
import './index.css';
import { applyLook, lookFromSearch } from './lib/theme';

// the shell passes the chosen theme and font in the page address, so the very first paint already wears Vault's look (no flash of the default)
applyLook(lookFromSearch(window.location.search));

// Hosted by the native shell, the window itself is the translucent (Mica) surface, so the page must not paint an opaque background over it.
if (window.shelfNative) document.documentElement.dataset.hosted = 'true';

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><App /></StrictMode>);
