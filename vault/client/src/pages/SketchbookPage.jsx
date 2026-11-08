import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { startSketchbookTour, TOUR_KEY as SKETCHBOOK_TOUR_KEY } from '../utils/tours/sketchbookTour';
import SketchList from './sketchbook/SketchList';
import SketchEditor from './sketchbook/SketchEditor';
import SketchbookTutorChat from './sketchbook/SketchbookTutorChat';
import { TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS } from './sketchbook/sketchbookTools.mjs';

/**
 * Sketchbook: describe a scene and it is drawn as a cartoon. /sketchbook is the collection, /sketchbook/:id is one sketch.
 * Docs: docs/sketchbook.md.
 */
export default function SketchbookPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const getIcon = useIcon();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const info = useToolInfoModal('vault_sketchbook_info_seen');
  const view = id ? 'editor' : 'list';

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const [accessKnown, setAccessKnown] = useState(false);
  const canUse = isAdmin || featureAccess.sketchbook !== false;
  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {})
      .finally(() => setAccessKnown(true));
  }, []);

  // Settings -> Sketchbook Tour opens /sketchbook?tour=1 (also used by the tour button while a sketch is open: it goes to the list first).
  useEffect(() => {
    if (params.get('tour') && view === 'list') {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(() => startSketchbookTour(), 300);
    }
  }, [params, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const startTour = () => {
    try { localStorage.removeItem(SKETCHBOOK_TOUR_KEY); } catch (_) { /* ignore */ }
    if (view !== 'list') { navigate('/sketchbook?tour=1'); return; }
    startSketchbookTour();
  };

  // The guide's "Open" buttons: switch to the view that holds the control. A sketch needs to be opened first, so from the list this says so.
  const openToolById = (toolId) => {
    const target = GUIDE_TOOLS.find((t) => t.id === toolId);
    if (!target) return;
    if (target.tool === 'list' && view !== 'list') navigate('/sketchbook');
  };

  if (accessKnown && !canUse) return <Navigate to="/" replace />;

  const iconBtn = { color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer' };

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="min-h-[calc(100dvh-3rem)]" style={{ background: 'var(--color-bg)' }}>
        <div className="flex items-center gap-2 px-6 pt-4 pb-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-surface)', color: 'var(--color-primary)' }}>
            {getIcon('pencil-line', { size: 16 })}
          </div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Sketchbook</h1>
          <Tooltip text="How Sketchbook works, and what it does not do yet.">
            <button type="button" onClick={info.open} aria-label="How Sketchbook works" className="transition-opacity duration-200 hover:opacity-60" style={iconBtn}>{getIcon('info', { size: 13 })}</button>
          </Tooltip>
          <Tooltip text="Take the guided tour of Sketchbook.">
            <button type="button" onClick={startTour} aria-label="Take the Sketchbook tour" className="transition-opacity duration-200 hover:opacity-60" style={iconBtn}>{getIcon('compass', { size: 13 })}</button>
          </Tooltip>
          {view === 'list' && <p className="text-sm ml-2" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS.list}</p>}
        </div>
        {view === 'list' ? <SketchList /> : <SketchEditor key={id} id={Number(id)} />}
      </div>

      {info.show && (
        <ToolInfoModal title="How Sketchbook Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Describe a scene, a theory or a possibility and Sketchbook draws it as a cartoon. Your sketches are saved to your account and nobody else can see them. Not sure where to start? Press the round guide button at the bottom right and say what you want to do.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      <SketchbookTutorChat currentTool={view} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}
