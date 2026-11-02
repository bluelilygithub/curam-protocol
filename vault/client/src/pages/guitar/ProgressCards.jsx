import React, { useState, useEffect, useCallback } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';

const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const btnLine = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const small = 'text-xs px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity duration-200';

/** "Is this normal?" reassurance, shown only when it fits what the person's practice looks like. Gentle: no counting, no guilt. */
export function GentleTips({ refreshKey }) {
  const addToast = useToastStore(s => s.addToast);
  const [tips, setTips] = useState([]);

  const load = useCallback(() => {
    api.get('/api/guitar-play/tips').then(r => r.json()).then(d => setTips(Array.isArray(d.tips) ? d.tips : [])).catch(() => setTips([]));
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const dismiss = async (id) => {
    setTips(t => t.filter(x => x.id !== id));
    try {
      const res = await api.post(`/api/guitar-play/tips/${id}/dismiss`);
      if (!res.ok) throw new Error('Could not save that');
      load(); // the next note that fits, if there is one
    } catch (e) { addToast(e.message, 'error'); load(); }
  };

  if (!tips.length) return null;
  return (
    <div className="flex flex-col gap-2" data-tour="guitar-reassure">
      {tips.map(t => (
        <section key={t.id} className="rounded-xl border p-4 flex flex-col gap-2" style={{ ...card, borderColor: 'var(--color-primary)' }} aria-label={`Is this normal? ${t.title}`}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-primary)' }}>Is this normal?</p>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t.title}</p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{t.text}</p>
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-xs flex-1" style={{ color: 'var(--color-muted)' }}>Shown because it fits: {t.when}.</p>
            <Tooltip text={GT.tipDismiss}>
              <button onClick={() => dismiss(t.id)} className={small} style={btnLine}>Got it, do not show again</button>
            </Tooltip>
          </div>
        </section>
      ))}
    </div>
  );
}

function Bar({ have, goal }) {
  const pct = Math.max(0, Math.min(100, Math.round((have / goal) * 100)));
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(have, goal)} className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--color-primary)' }} />
    </div>
  );
}

/** Milestones worked out from what the person has done, the next ones with how close they are, and every tip to browse. */
export function MilestonesCard({ refreshKey, onTipsChange }) {
  const [data, setData] = useState(null);
  const [tips, setTips] = useState(null);
  const [open, setOpen] = useState(false);
  const [showTips, setShowTips] = useState(false);
  const [cheer, setCheer] = useState(null);   // the message about newly reached milestones, until closed

  const loadTips = useCallback(() => {
    api.get('/api/guitar-play/tips').then(r => r.json()).then(d => setTips(Array.isArray(d.all) ? d.all : [])).catch(() => setTips([]));
  }, []);
  useEffect(() => {
    api.get('/api/guitar-play/milestones').then(r => r.json()).then((d) => {
      setData(d);
      const fresh = (d.milestones || []).filter(m => m.isNew);
      if (fresh.length === 0) return;
      // Someone who already has many gets one calm sentence, not a pile of banners
      setCheer(fresh.length > 3
        ? { title: `You already have ${fresh.length} milestones`, text: 'They are worked out from everything you have already done. Well done.' }
        : { title: fresh.length === 1 ? `New milestone: ${fresh[0].title}` : `New milestones: ${fresh.map(m => m.title).join(', ')}`, text: fresh.map(m => m.text).join(' ') });
    }).catch(() => setData({ milestones: [] }));
  }, [refreshKey]);
  useEffect(() => { if (showTips) loadTips(); }, [showTips, loadTips]);

  const setAway = async (id, away) => {
    try {
      const res = away ? await api.post(`/api/guitar-play/tips/${id}/dismiss`) : await api.delete(`/api/guitar-play/tips/${id}/dismiss`);
      if (!res.ok) throw new Error('Could not save that');
      loadTips();
      onTipsChange?.(); // the note at the top of Today looks again
    } catch (_) { loadTips(); }
  };

  if (!data) return null;
  const list = data.milestones;
  const done = list.filter(m => m.achieved);
  const next = list.filter(m => !m.achieved).sort((a, b) => (b.progress.have / b.progress.goal) - (a.progress.have / a.progress.goal)).slice(0, 3);
  const groups = [...new Set(list.map(m => m.group))];

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border p-4 flex flex-col gap-3" style={card} data-tour="guitar-milestones">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Milestones</h2>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{done.length} of {list.length}</span>
        </div>

        {cheer && (
          <div className="rounded-lg border p-3 flex flex-col gap-1" style={{ borderColor: 'var(--color-primary)', background: 'var(--color-bg)' }} role="status">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{cheer.title}</p>
            <p className="text-xs" style={{ color: 'var(--color-text)' }}>{cheer.text}</p>
            <Tooltip text={GT.milestoneClose}>
              <button onClick={() => setCheer(null)} className={`${small} self-start mt-1`} style={btnLine}>Thanks</button>
            </Tooltip>
          </div>
        )}

        {next.length > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Next up</p>
            {next.map(m => (
              <div key={m.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{m.title}</p>
                  <span className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{m.progress.have} of {m.progress.goal} {m.progress.unit}</span>
                </div>
                <Bar have={m.progress.have} goal={m.progress.goal} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>You have reached every milestone. That is a lot of guitar.</p>
        )}

        <Tooltip text={GT.milestoneAll}>
          <button onClick={() => setOpen(o => !o)} className={`${small} self-start`} style={btnLine} aria-expanded={open}>
            {open ? 'Hide all milestones' : 'Show all milestones'}
          </button>
        </Tooltip>
        {open && groups.map(g => (
          <div key={g} className="flex flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{g}</p>
            {list.filter(m => m.group === g).map(m => (
              <p key={m.key} className="text-sm flex gap-2" style={{ color: m.achieved ? 'var(--color-text)' : 'var(--color-muted)' }}>
                <span aria-hidden="true" className="w-4">{m.achieved ? '✓' : '·'}</span>
                <span><strong style={{ fontWeight: m.achieved ? 600 : 400 }}>{m.title}</strong>{m.achieved && m.achievedAt ? ` · ${new Date(m.achievedAt).toLocaleDateString()}` : ''}
                  <span className="sr-only">{m.achieved ? ' (reached)' : ' (not yet)'}</span></span>
              </p>
            ))}
          </div>
        ))}
      </section>

      <section className="rounded-xl border p-4 flex flex-col gap-2" style={card}>
        <Tooltip text={GT.tipsAll}>
          <button onClick={() => setShowTips(s => !s)} className={`${small} self-start`} style={btnLine} aria-expanded={showTips}>
            {showTips ? 'Hide: Is this normal?' : 'Is this normal? Common worries when learning'}
          </button>
        </Tooltip>
        {showTips && (tips || []).map(t => (
          <div key={t.id} className="rounded-lg border p-3 flex flex-col gap-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', opacity: t.dismissed ? 0.6 : 1 }}>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t.title}</p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{t.text}</p>
            <div className="flex items-center gap-3">
              <p className="text-xs flex-1" style={{ color: 'var(--color-muted)' }}>Appears when: {t.when}.</p>
              {t.dismissed ? (
                <Tooltip text={GT.tipRestore}>
                  <button onClick={() => setAway(t.id, false)} className={small} style={btnLine}>Show it again</button>
                </Tooltip>
              ) : (
                <Tooltip text={GT.tipDismiss}>
                  <button onClick={() => setAway(t.id, true)} className={small} style={btnLine}>Do not show this</button>
                </Tooltip>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
