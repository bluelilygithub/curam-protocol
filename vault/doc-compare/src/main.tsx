import * as pdfjs from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

// the pdf.js worker is bundled into the page (blob URL), so nothing is fetched at runtime, even from disk
pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

createRoot(document.getElementById('root')!).render(<App />);
