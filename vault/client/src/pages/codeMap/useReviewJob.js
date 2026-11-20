import { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';

// One AI review of a kind (server/services/codeMap/aiReview.js): the latest finished review, the estimate for a new one, the review in progress
// (polled every 3 seconds, picked up again when the page reloads), and start(). Used by the AI review tab ('plainCode') and the Security tab
// ('security'). Only one AI review runs at a time across both kinds: a 409 for the other kind is shown as a message, not followed.

const POLL_MS = 3000;
const toast = (message, type = 'error') => useToastStore.getState().addToast(message, type);

async function json(res, fallback) {
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error || fallback), { status: res.status, body: d });
  return d;
}

export default function useReviewJob(kind, { doneMessage } = {}) {
  const qs = kind === 'plainCode' ? '' : `?kind=${kind}`;
  const [review, setReview] = useState(undefined); // latest finished review (null before the first)
  const [estimate, setEstimate] = useState(null);
  const [active, setActive] = useState(null); // { id, progress }
  const [starting, setStarting] = useState(false);
  const [lastFailed, setLastFailed] = useState(null);

  const load = useCallback(async () => {
    try {
      const [l, list, e] = await Promise.all([
        api.get(`/api/code-map/ai-reviews/latest${qs}`).then((r) => json(r, 'Could not load the review.')),
        api.get(`/api/code-map/ai-reviews${qs}`).then((r) => json(r, 'Could not load the reviews.')),
        api.get(`/api/code-map/ai-reviews/estimate${qs}`).then((r) => json(r, 'Could not count what to review.')),
      ]);
      setReview(l.review || null);
      setEstimate(e);
      const newest = (list.reviews || [])[0];
      if (newest && newest.status === 'running') setActive({ id: newest.id, progress: newest.progress });
      setLastFailed(newest && newest.status === 'failed' ? newest : null);
    } catch (err) {
      setReview((r) => (r === undefined ? null : r));
      toast(err.message);
    }
  }, [qs]);
  useEffect(() => { load(); }, [load]);

  const activeId = active?.id;
  useEffect(() => {
    if (!activeId) return undefined;
    let stop = false;
    let timer;
    const tick = async () => {
      try {
        const { review: r } = await json(await api.get(`/api/code-map/ai-reviews/${activeId}`), 'Lost track of the review.');
        if (stop) return;
        if (r.status === 'running') { setActive({ id: r.id, progress: r.progress }); timer = setTimeout(tick, POLL_MS); return; }
        setActive(null);
        if (r.status === 'done') toast(doneMessage ? doneMessage(r) : 'Review finished.', 'success');
        else toast(r.error ? `The review failed: ${r.error}` : 'The review failed.');
        load();
      } catch (err) {
        if (!stop) { setActive(null); toast(err.message); }
      }
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { stop = true; clearTimeout(timer); };
  }, [activeId, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setStarting(true);
    try {
      const r = await api.post(`/api/code-map/ai-reviews${qs}`, {});
      const d = await r.json().catch(() => ({}));
      if (r.status === 202) setActive({ id: d.id, progress: null });
      else if (r.status === 409 && d.runningId && (d.runningKind || 'plainCode') === kind) { setActive({ id: d.runningId, progress: null }); toast('This review is already running; showing its progress.', 'warn'); }
      else toast(d.error || 'Could not start the review.');
    } catch (_) {
      toast('Could not start the review.');
    } finally {
      setStarting(false);
    }
  };

  return { review, estimate, active, starting, lastFailed, busy: starting || !!active, start, reload: load };
}
