import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Hosted by the native shell, the window itself is the translucent (Mica) surface, so the page must not paint an opaque background over it.
if (window.shelfNative) document.documentElement.dataset.hosted = 'true';

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><App /></StrictMode>);
