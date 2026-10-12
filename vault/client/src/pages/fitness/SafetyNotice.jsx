import React, { useContext, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { Notice, PrimaryButton, SecondaryButton } from './ui';
import FitnessNav from './FitnessNav';

/**
 * A calm notice after a note that mentions pain, dizziness or chest symptoms. It offers a gentler next week, and only
 * does it if you say yes. Chest and dizziness also suggest seeing your GP (that is in the message itself).
 */
export default function SafetyNotice({ safety }) {
  const addToast = useToastStore((s) => s.addToast);
  const nav = useContext(FitnessNav);
  const [state, setState] = useState('ask'); // ask | saving | done | declined
  if (!safety?.message) return null;

  const confirm = async () => {
    setState('saving');
    try {
      const r = await api.post('/api/fitness/ease', { confirm: true });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not do that');
      setState('done');
      addToast('Next week will be gentler.', 'success');
    } catch (err) {
      addToast(err.message, 'error');
      setState('ask');
    }
  };

  return (
    <Notice tone="care">
      <p>{safety.message}</p>
      {safety.offerEase && state !== 'declined' && (
        state === 'done'
          ? <p className="mt-2 font-medium">Done. Next week will be gentler: fewer minutes and easier versions.</p>
          : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PrimaryButton onClick={confirm} disabled={state === 'saving'}>Yes, keep next week gentle</PrimaryButton>
              <SecondaryButton onClick={() => setState('declined')} disabled={state === 'saving'}>No thanks</SecondaryButton>
            </div>
          )
      )}
      {safety.offerEase && (
        <p className="mt-3 text-sm">
          A gentler week does not remove specific exercises.{' '}
          <button
            type="button"
            onClick={() => nav.goTo('library', { hint: 'hide' })}
            className="underline font-medium hover:opacity-60 transition-opacity duration-200"
          >
            Hide any exercises that bother it
          </button>
          {' '}and your program will skip them.
        </p>
      )}
    </Notice>
  );
}
