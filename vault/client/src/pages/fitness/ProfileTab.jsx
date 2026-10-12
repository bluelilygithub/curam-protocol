import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { Card, Notice, PrimaryButton, formatDate } from './ui';
import {
  draftFromState, profilePayload, ratingsPayload,
  AboutSection, ActivitySection, RatingsSection, LifestyleSection, WorkAroundSection,
} from './sections';

function History({ meta }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.get('/api/fitness/ratings/history').then((r) => r.json()).then((d) => setRows(d.history || [])).catch(() => setRows([]));
  }, []);
  if (!rows || rows.length < 2) return null;
  return (
    <Card title="Your ratings over time" hint="Each time you re-rate, it is added here. A chart arrives with the dashboard.">
      <ul className="space-y-1.5 text-sm" style={{ color: 'var(--color-text)' }}>
        {[...rows].reverse().map((r) => (
          <li key={r.id}>
            <span style={{ color: 'var(--color-muted)' }}>{formatDate(r.ratedOn)}</span>{' '}
            {meta.domains.map((d) => `${d.label.split(' ')[0]} ${r.scores[d.id]}`).join(' · ')}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Edit profile and lifestyle, and re-rate (which keeps history). Opens straight to the re-rate card when asked. */
export default function ProfileTab({ meta, state, onChanged, focusRerate }) {
  const addToast = useToastStore((s) => s.addToast);
  const [draft, setDraft] = useState(() => draftFromState(state));
  const [saving, setSaving] = useState('');
  const rerateRef = useRef(null);
  const set = useCallback((key, value) => setDraft((d) => ({ ...d, [key]: value })), []);

  useEffect(() => {
    if (focusRerate && rerateRef.current) rerateRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusRerate]);

  const save = async (what) => {
    setSaving(what);
    try {
      let r;
      if (what === 'profile') r = await api.put('/api/fitness/profile', profilePayload(draft));
      else r = await api.post('/api/fitness/ratings', ratingsPayload(draft, 'rerate'));
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save');
      addToast(what === 'profile' ? 'Profile saved' : 'New ratings saved', 'success');
      onChanged(d);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving('');
    }
  };

  return (
    <div className="max-w-3xl mx-auto w-full space-y-5">
      <AboutSection meta={meta} draft={draft} set={set} timezoneInfo={state.timezone} />
      <ActivitySection draft={draft} set={set} />
      <LifestyleSection meta={meta} draft={draft} set={set} />
      <WorkAroundSection draft={draft} set={set} />
      <div className="flex justify-end">
        <PrimaryButton onClick={() => save('profile')} disabled={saving !== ''}>{saving === 'profile' ? 'Saving…' : 'Save profile'}</PrimaryButton>
      </div>

      <div ref={rerateRef} data-tour="fitness-rerate">
        <RatingsSection
          meta={meta}
          draft={draft}
          set={set}
          title="Re-rate my fitness"
          hint="Worth doing every 4-6 weeks, or any time something has changed. Your earlier ratings are kept, so you can see progress."
        />
        {state.ratingDue.due && (
          <div className="mt-3"><Notice>It has been {state.ratingDue.weeks} weeks since your last rating.</Notice></div>
        )}
        <div className="flex justify-end mt-3">
          <PrimaryButton onClick={() => save('rerate')} disabled={saving !== ''}>{saving === 'rerate' ? 'Saving…' : 'Save new ratings'}</PrimaryButton>
        </div>
      </div>

      <History meta={meta} />
    </div>
  );
}
