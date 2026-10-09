import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LiteApp } from './LiteApp';
import '../styles.css';
import './lite.css';

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><LiteApp /></StrictMode>);
