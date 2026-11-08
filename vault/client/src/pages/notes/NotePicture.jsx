import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import { NOTE_TIPS } from './noteTips.mjs';

/**
 * One attached picture shown inside a note's text (Preview), from a `{picture:41}` marker (see notePictures.mjs). The picture is fetched
 * with the sign-in header (an <img src> cannot carry it) and dropped when the view goes. Clicking opens it full size in a new tab. If the
 * file has been removed or is not the person's, a quiet line says so instead of a broken picture.
 */
export default function NotePicture({ id }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true; // set inside the effect: a development double-mount must not leave it false
    let objectUrl = null;
    setUrl(null); setFailed(false);
    api.get(`/api/attachments/${id}/download`)
      .then((r) => { if (!r.ok) throw new Error('missing'); return r.blob(); })
      .then((blob) => {
        if (!alive) return;
        if (!/^image\//.test(blob.type)) throw new Error('not a picture');
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]);

  if (failed) return <span className="text-xs" style={{ color: 'var(--color-muted)' }}>This picture is no longer attached to the note.</span>;
  if (!url) return <span className="text-xs" style={{ color: 'var(--color-muted)' }} role="status">Loading the picture…</span>;
  return (
    <Tooltip text={NOTE_TIPS.picture}>
      <button
        type="button"
        onClick={() => window.open(url, '_blank', 'noopener')}
        className="block max-w-full rounded-lg border transition-opacity duration-200 hover:opacity-80"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', padding: 0, cursor: 'zoom-in' }}
        aria-label="Open the picture full size"
      >
        <img src={url} alt="Picture saved with this note" className="block max-w-full h-auto rounded-lg" style={{ maxHeight: 520 }} />
      </button>
    </Tooltip>
  );
}
