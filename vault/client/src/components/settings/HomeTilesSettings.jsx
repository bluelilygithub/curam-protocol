import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/apiClient';
import NavLayoutEditor from './NavLayoutEditor';

/**
 * Settings → Navigation → Home page tiles (admin): arrange the /home tiles in groups with the same drag-and-drop editor as the Apps menu,
 * and make /home where Vault opens for everyone (the workspace landing page, also under Members). See docs/home.md.
 */
export default function HomeTilesSettings() {
  const [landing, setLanding] = useState(null); // the workspace default; null while loading
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/api/admin/landing').then((r) => (r.ok ? r.json() : {})).then((d) => setLanding(d.workspaceDefault || '')).catch(() => setLanding(''));
  }, []);
  const openOnHome = async () => {
    setError('');
    try {
      const r = await api.put('/api/admin/landing', { path: '/home' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not change where Vault opens');
      setLanding(d.workspaceDefault);
    } catch (e) { setError(e.message); }
  };

  return (
    <NavLayoutEditor
      endpoint="/api/settings/home-tiles" field="homeTiles" setCount={1}
      intro="The tiles on the Home page, in groups. Make a group, drag apps from the pool below into it, and drag tiles or group handles to put them in order. Everyone sees the same page, but only the apps they can use; a group with none of them is hidden."
      notSetUp="The Home page is empty until you save."
      saveLabel="Save tiles" resetLabel="Remove all tiles" resetConfirm="Empty the Home page for everyone?"
    >
      <Link to="/home" className="text-xs hover:opacity-60" style={{ color: 'var(--color-primary)' }}>Open Home →</Link>
      {landing !== null && (landing === '/home'
        ? <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Vault opens on Home for everyone (unless a member has their own start page under Members).</span>
        : (
          <button type="button" onClick={openOnHome} className="text-xs underline hover:opacity-60" style={{ color: 'var(--color-primary)' }}
            title="Sets the workspace start page to /home. Members with their own start page under Members keep it.">
            Open Vault on Home for everyone{landing ? ` (now ${landing})` : ''}
          </button>
        ))}
      {error && <span className="text-xs" role="alert" style={{ color: '#ef4444' }}>{error}</span>}
    </NavLayoutEditor>
  );
}
