import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { Pill, SEV_COLOR, card, fmtSecs, fmtWhen } from './shared';

// Code Map → Models, test set (server/services/codeMap/models/testSet.js): replay saved News digest topics through the current model and a
// candidate, score both with code checks and a judge model, and say whether the candidate gives the same quality. Button only; polled
// every 3 seconds while running (picked up again after a reload). The next Run check attaches the newest result to the report.

const POLL_MS = 3000;
const toast = (message, type = 'error') => useToastStore.getState().addToast(message, type);
const BTN = 'text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:opacity-80 transition-opacity duration-200 disabled:opacity-50';
const field = { borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' };
const VERDICT = {
  same: { text: 'Same quality', color: 'var(--color-success, #16a34a)' },
  worse: { text: 'Worse quality', color: SEV_COLOR.high },
  notEnough: { text: 'Not enough evidence', color: 'var(--color-muted)' },
};
const RATING = { better: 'Better', same: 'Same', worse: 'Worse' };

async function json(res, fallback) {
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error || fallback), { status: res.status });
  return d;
}

const checksText = (side) => (side?.checks?.total ? `${side.checks.passed}/${side.checks.total}` : 'failed');

export default function ModelTestPanel() {
  const getIcon = useIcon();
  const [est, setEst] = useState(null);
  const [candidate, setCandidate] = useState('');
  const [cases, setCases] = useState(10);
  const [latest, setLatest] = useState(null);
  const [lastFailed, setLastFailed] = useState(null);
  const [active, setActive] = useState(null); // { id, progress }
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);

  const loadEstimate = useCallback(async (cand, n) => {
    try {
      const qs = new URLSearchParams({ cases: String(n), ...(cand ? { candidate: cand } : {}) });
      const e = await json(await api.get(`/api/code-map/models/tests/estimate?${qs}`), 'Could not count the saved cases.');
      setEst(e);
      if (!cand && e.candidate) setCandidate(e.candidate);
    } catch (err) { toast(err.message); }
  }, []);

  const loadTests = useCallback(async () => {
    try {
      const { tests } = await json(await api.get('/api/code-map/models/tests'), 'Could not load the tests.');
      const newest = tests[0];
      if (newest && newest.status === 'running') setActive({ id: newest.id, progress: newest.progress });
      setLastFailed(newest && newest.status === 'failed' ? newest : null);
      const done = tests.find((t) => t.status === 'done');
      setLatest(done ? (await json(await api.get(`/api/code-map/models/tests/${done.id}`), 'Could not load the test.')).test : null);
    } catch (err) { toast(err.message); }
  }, []);

  useEffect(() => { loadTests(); }, [loadTests]);
  useEffect(() => { loadEstimate(candidate, cases); }, [candidate, cases]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeId = active?.id;
  useEffect(() => {
    if (!activeId) return undefined;
    let stop = false;
    let timer;
    const tick = async () => {
      try {
        const { test } = await json(await api.get(`/api/code-map/models/tests/${activeId}`), 'Lost track of the test.');
        if (stop) return;
        if (test.status === 'running') { setActive({ id: test.id, progress: test.progress }); timer = setTimeout(tick, POLL_MS); return; }
        setActive(null);
        if (test.status === 'done') toast(`Test done: ${VERDICT[test.summary?.label]?.text || 'finished'}. Run check to add it to the report.`, 'success');
        else toast(test.error ? `The test failed: ${test.error}` : 'The test failed.');
        loadTests();
      } catch (err) {
        if (!stop) { setActive(null); toast(err.message); }
      }
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { stop = true; clearTimeout(timer); };
  }, [activeId, loadTests]);

  const start = async () => {
    setConfirming(false);
    setStarting(true);
    try {
      const r = await api.post('/api/code-map/models/tests', { candidate, cases });
      const d = await r.json().catch(() => ({}));
      if (r.status === 202) setActive({ id: d.id, progress: null });
      else if (r.status === 409 && d.runningId) { setActive({ id: d.runningId, progress: null }); toast(d.error, 'warn'); }
      else toast(d.error || 'Could not start the test.');
    } catch (_) {
      toast('Could not start the test.');
    } finally {
      setStarting(false);
    }
  };

  const s = latest?.summary;
  const v = s && VERDICT[s.label];
  const canRun = est && est.current && est.judge && candidate && est.cases >= est.minCases && !active && !starting;
  const cost = est?.approxCostUsd == null ? '' : `, about $${est.approxCostUsd.toFixed(est.approxCostUsd < 1 ? 3 : 2)}`;

  return (
    <section className="rounded-2xl border p-5 space-y-3" style={card} data-guide="run-model-test">
      <div className="max-w-3xl">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Test set: News digest</h3>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          Replays topics from your past digests through the current model and a candidate, checks both answers in code, and asks the standard model to judge them blind. Same quality needs the candidate to pass as many code checks and be rated good or better on at least 80% of at least 5 judged cases. Nothing in Settings changes.
        </p>
      </div>

      {!est ? <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Counting the saved cases…</p> : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="text-xs" style={{ color: 'var(--color-text)' }}>
            <span style={{ color: 'var(--color-muted)' }}>Current</span><br /><span className="font-mono">{est.current || 'not set'}</span>
          </div>
          <Tooltip text="The model to compare with the current one. Any text model in the model list.">
            <label className="text-xs flex flex-col gap-1" style={{ color: 'var(--color-muted)' }}>Candidate
              <select value={candidate} onChange={(e) => setCandidate(e.target.value)} disabled={!!active} className="text-xs px-2 py-1 rounded-lg border font-mono" style={field}>
                {est.candidates.map((m) => <option key={m} value={m}>{m}{m === est.suggested ? ' (light)' : ''}</option>)}
              </select>
            </label>
          </Tooltip>
          <Tooltip text="How many saved topics to replay (each makes about 3 model calls).">
            <label className="text-xs flex flex-col gap-1" style={{ color: 'var(--color-muted)' }}>Cases
              <select value={cases} onChange={(e) => setCases(Number(e.target.value))} disabled={!!active} className="text-xs px-2 py-1 rounded-lg border" style={field}>
                {[5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </Tooltip>
          {confirming ? (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
              <span>About {est.calls} model calls{cost}. Run it?</span>
              <button type="button" onClick={start} className={BTN} style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>Yes, run</button>
              <button type="button" onClick={() => setConfirming(false)} className={BTN} style={{ ...field, border: '1px solid var(--color-border)' }}>Cancel</button>
            </div>
          ) : (
            <Tooltip text={active ? 'The test is running.' : `Replays ${est.cases} saved topics: about ${est.calls} model calls${cost}. Counts towards the AI rate limit and shows in Usage as code_map_models_test.`}>
              <button type="button" onClick={() => setConfirming(true)} disabled={!canRun} className={BTN} style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
                {getIcon(active ? 'loader' : 'play', { size: 14, className: active ? 'animate-spin' : undefined })}
                {active ? (active.progress ? `Case ${active.progress.done} of ${active.progress.total}` : 'Starting…') : 'Run test'}
              </button>
            </Tooltip>
          )}
        </div>
      )}

      {est && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {est.casesAvailable} saved topics with 3 or more articles in the last 60 days{est.cases < est.minCases ? `: at least ${est.minCases} are needed` : ''}. Judge: <span className="font-mono">{est.judge || 'no standard model set'}</span>
          {est.judgeIsTested ? ' (it is also one of the models being tested, so it may favour itself)' : ''}.
        </p>
      )}
      {lastFailed && !active && <p className="text-xs" style={{ color: SEV_COLOR.high }}>The last test failed: {lastFailed.error}</p>}

      {latest && s && (
        <div className="space-y-2 pt-1">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
            <Pill color={v?.color}>{v?.text || s.label}</Pill>{' '}{s.text}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {fmtWhen(latest.finishedAt)} · {latest.result?.modelCalls ?? '?'} model calls · ${Number(latest.costUsd || 0).toFixed(3)} · took {fmtSecs(latest.durationMs)}
          </p>
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ color: 'var(--color-muted)', background: 'var(--color-surface)' }}>
                  {['Topic', 'Date', `Checks: ${s.current}`, `Checks: ${s.candidate}`, 'Judge on the candidate'].map((h) => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(latest.result?.cases || []).map((c, i) => (
                  <tr key={i} className="border-t align-top" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <td className="px-3 py-2">{c.topic}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.date}</td>
                    <td className="px-3 py-2"><Tooltip text={(c.current.checks.problems || []).join('; ') || 'All checks passed.'}><span tabIndex={0}>{checksText(c.current)}</span></Tooltip></td>
                    <td className="px-3 py-2"><Tooltip text={(c.candidate.checks.problems || []).join('; ') || 'All checks passed.'}><span tabIndex={0}>{checksText(c.candidate)}</span></Tooltip></td>
                    <td className="px-3 py-2">{c.rating ? <><b>{RATING[c.rating]}</b>{c.judge?.reason ? ` · ${c.judge.reason}` : ''}</> : <span style={{ color: 'var(--color-muted)' }}>not judged</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
