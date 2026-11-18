import { useEffect, useRef } from 'react';
import api from '../utils/apiClient';
import useToastStore from '../store/toastStore';
import { isWatching, stopWatching, isToolOpen, alreadyToasted, markToasted, WATCH_EVENT } from '../pages/pdf/pdfHtmlWatch';

// App-wide "your web page is ready" alert for PDF Tools → PDF → HTML, which runs in the background (server/services/pdfToHtmlJobs.js).
// Renders nothing. It checks GET /api/pdf/to-html/jobs/alerts every POLL_MS, but only while a job started in this browser may still be
// running (a flag the tool sets), and once when Vault opens. A finished run that has not been opened is announced once with a toast that
// links to the tool; while the tool itself is on screen it stays quiet. The dashboard's Needs attention list also shows unopened pages.
const POLL_MS = 15000;

export default function PdfHtmlWatcher() {
  const addToast = useToastStore((s) => s.addToast);
  const timer = useRef(null);

  useEffect(() => {
    let stopped = false;

    const check = async () => {
      try {
        const r = await api.get('/api/pdf/to-html/jobs/alerts');
        if (!r.ok || stopped) return;
        const { running = 0, finished = [] } = await r.json();
        for (const job of finished) {
          const key = `${job.id}:${job.finishedAt || ''}`;
          if (alreadyToasted(key)) continue;
          markToasted(key);
          if (isToolOpen()) continue;
          const name = job.filename ? `"${job.filename}"` : 'Your web page';
          if (job.status === 'done') {
            addToast(`${job.kind === 'revise' ? `The change to ${name} is done.` : `${name} is ready as a web page.`}`, 'success', 15000, { label: 'Open', href: '/pdf?tool=pdftohtml' });
          } else {
            addToast(`${name} did not finish as a web page.`, 'error', 15000, { label: 'See why', href: '/pdf?tool=pdftohtml' });
          }
        }
        if (!running) stopWatching();
      } catch { /* try again on the next check */ }
    };

    const schedule = () => {
      clearInterval(timer.current);
      if (isWatching()) timer.current = setInterval(() => { if (!isWatching()) { clearInterval(timer.current); return; } check(); }, POLL_MS);
    };

    check(); // once on arrival: a page that finished while Vault was closed
    schedule();
    const onStart = () => schedule();
    window.addEventListener(WATCH_EVENT, onStart);
    return () => { stopped = true; clearInterval(timer.current); window.removeEventListener(WATCH_EVENT, onStart); };
  }, [addToast]);

  return null;
}
