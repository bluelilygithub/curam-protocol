import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { startDrawingsTour, TOUR_KEY as DRAWINGS_TOUR_KEY } from '../utils/tours/drawingsTour';
import DrawingsList from './drawings/DrawingsList';
import DrawingEditor from './drawings/DrawingEditor';
import DrawingsTutorChat from './drawings/DrawingsTutorChat';
import { TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS } from './drawings/drawingsTools.mjs';

/**
 * Drawings: the person's saved Excalidraw drawings. /drawings is the list, /drawings/:id is one drawing on the editor. The editor is a
 * large library, so it is loaded only when a drawing is opened (see drawings/loadExcalidraw.js). Docs: docs/drawings.md.
 */
export default function DrawingsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const getIcon = useIcon();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const info = useToolInfoModal('vault_drawings_info_seen');
  const view = id ? 'editor' : 'list';

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const [accessKnown, setAccessKnown] = useState(false);
  const canUse = isAdmin || featureAccess.drawings !== false;
  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {})
      .finally(() => setAccessKnown(true));
  }, []);

  // Settings -> Drawings Tour opens /drawings?tour=1 (also used by the tour button while a drawing is open: it goes to the list first).
  // The page is the same one for the list and for a drawing, so this runs whenever ?tour appears, not only on the first load.
  useEffect(() => {
    if (params.get('tour') && view === 'list') {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(() => startDrawingsTour(), 300);
    }
  }, [params, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const startTour = () => {
    try { localStorage.removeItem(DRAWINGS_TOUR_KEY); } catch (_) { /* ignore */ }
    if (view !== 'list') { navigate('/drawings?tour=1'); return; }
    startDrawingsTour();
  };

  // The guide's "Open" buttons: switch to the view that holds the control. An editor needs a drawing, so from the list this says so.
  const openToolById = (toolId) => {
    const target = GUIDE_TOOLS.find((t) => t.id === toolId);
    if (!target) return;
    if (target.tool === 'list' && view !== 'list') navigate('/drawings');
  };

  if (accessKnown && !canUse) return <Navigate to="/" replace />;

  const iconBtn = { color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' };

  return (
    <VoiceInputProvider lang="en-AU">
      {/* The drawing board takes exactly the height that is left under the page's own top bar, so the page itself never scrolls */}
      <div style={{ background: 'var(--color-bg)', ...(view === 'editor' ? { height: 'calc(100dvh - 3rem)' } : {}) }} className={view === 'editor' ? 'flex flex-col' : 'min-h-[calc(100dvh-3rem)]'}>
        <div className="flex items-center gap-2 px-6 pt-4 pb-2 shrink-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}>
            {getIcon('pen-tool', { size: 16 })}
          </div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Drawings</h1>
          <Tooltip text="How Drawings works, and what it does not do yet.">
            <button type="button" onClick={info.open} aria-label="How Drawings works" className="transition-opacity duration-200 hover:opacity-60" style={iconBtn}>{getIcon('info', { size: 13 })}</button>
          </Tooltip>
          <Tooltip text="Take the guided tour of Drawings.">
            <button type="button" onClick={startTour} aria-label="Take the Drawings tour" className="transition-opacity duration-200 hover:opacity-60" style={iconBtn}>{getIcon('compass', { size: 13 })}</button>
          </Tooltip>
          {view === 'list' && <p className="text-sm ml-2" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS.list}</p>}
        </div>
        {view === 'list' ? <DrawingsList /> : <DrawingEditor key={id} id={Number(id)} />}
      </div>

      {info.show && (
        <ToolInfoModal title="How Drawings Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Sketch ideas, diagrams and plans on an endless page. Drawings are saved to your account by themselves and nobody else can see them. Not sure where to start? Press the round guide button at the bottom right and say what you want to do.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      <DrawingsTutorChat currentTool={view} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}
