import React, { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import SketchList from './sketchbook/SketchList';
import SketchEditor from './sketchbook/SketchEditor';

const HOW_IT_WORKS = [
  ['Describe', 'say or type a scene, a theory or a possibility. It is drawn as a cartoon.'],
  ['Pencil, pen or colour', 'choose pencil, an ink pen in the colour you like, or a coloured-in picture. Any sketch can be redrawn in another look, or coloured in, later.'],
  ['Change it', 'open a sketch and say what to change ("make the dog bigger, add rain"). The same picture is changed; the one it replaces is kept so you can go back.'],
  ['Keep and save', 'every sketch is saved in your collection and private to you. Save one as PNG, JPG or WebP, or copy it.'],
  ['Cost', 'each picture or change is one paid AI image request (about 2 to 3 cents). It shares the daily limit for AI pictures with Graphics.'],
  ['Not yet', 'sending a sketch to Notes, hand drawing and painting on the picture, and several pictures in a row (a comic strip).'],
];

/** Sketchbook: describe a scene and it is drawn as a cartoon. /sketchbook is the collection, /sketchbook/:id is one sketch. Docs: docs/sketchbook.md. */
export default function SketchbookPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const getIcon = useIcon();
  const { id } = useParams();
  const info = useToolInfoModal('vault_sketchbook_info_seen');

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
          {!id && <p className="text-sm ml-2" style={{ color: 'var(--color-muted)' }}>Describe a scene or an idea and have it drawn as a cartoon.</p>}
        </div>
        {id ? <SketchEditor key={id} id={Number(id)} /> : <SketchList />}
      </div>

      {info.show && (
        <ToolInfoModal title="How Sketchbook Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Describe a scene, a theory or a possibility and Sketchbook draws it as a cartoon. Your sketches are saved to your account and nobody else can see them.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}
    </VoiceInputProvider>
  );
}
