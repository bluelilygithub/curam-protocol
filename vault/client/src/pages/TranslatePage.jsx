import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import Tooltip from '../components/Tooltip';
import ToolSidebar from '../components/ToolSidebar';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { JobStart, JobBar, BackToJobs } from '../components/JobStart';
import { startTranslateTour, TOUR_KEY as TRANSLATE_TOUR_KEY } from '../utils/tours/translateTour';
import { TRANSLATE_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS } from './translate/translateTools.mjs';
import { TRANSLATE_GOALS } from './translate/translateGoals.mjs';
import TranslationsWorkspace from './translate/TranslationsWorkspace';
import GlossariesPanel from './translate/GlossariesPanel';
import LearnedPanel from './translate/LearnedPanel';
import HouseStylesPanel from './translate/HouseStylesPanel';
import useAuthStore from '../store/authStore';
import TranslateTutorChat from './translate/TranslateTutorChat';

// The Translate page: a left-hand list of four screens (translate/translateTools.mjs), a "What do you want to do?" job screen that
// fills New translation in (translate/translateGoals.mjs), the (i) box, the compass tour and the Translate guide. The screens
// themselves live in ./translate/. New translation and My translations are one component that stays mounted on every screen, so a
// translation that is running is never dropped when the person looks at another screen.

// "Open on the screen I used last" instead of the job screen: off unless ticked on the job screen (same as the Style editor and PDF Tools).
const OPEN_ON_LAST_KEY = 'vault_translate_open_on_last';
const LAST_TOOL_KEY = 'vault_translate_last_tool';
const readLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window: it just will not be remembered */ } };
const toolLabel = (id) => TRANSLATE_TOOLS.find((t) => t.id === id)?.label || id;
const isTool = (id) => TRANSLATE_TOOLS.some((t) => t.id === id);
// 'start' is the job screen (not a tool); every other value is an id from TRANSLATE_TOOLS.
function initialTool() {
  if (readLocal(OPEN_ON_LAST_KEY) !== '1') return 'start';
  const last = readLocal(LAST_TOOL_KEY);
  return isTool(last) ? last : 'start';
}

export default function TranslatePage() {
  const getIcon = useIcon();
  const isAdmin = !!useAuthStore((s) => s.user?.isAdmin);
  const info = useToolInfoModal('vault_translate_info_seen');
  const [searchParams, setSearchParams] = useSearchParams();

  const [tool, setToolRaw] = useState(initialTool);
  const [openJobId, setOpenJobId] = useState(null); // one translation open on My translations (ResultScreen), or null for the list
  // Choosing a screen from the list (or the guide, the tour, a job step) shows that screen; for My translations, the list itself.
  const setTool = (id) => { setOpenJobId(null); setToolRaw(id); };
  const openJob = (id) => { setToolRaw('jobs'); setOpenJobId(id ? Number(id) : null); };
  const [goal, setGoal] = useState(null);     // the job picked on the job screen
  const [preset, setPreset] = useState(null); // { nonce, title, values }: what New translation is filled in with
  const nonce = useRef(0);
  const [openOnLast, setOpenOnLast] = useState(() => readLocal(OPEN_ON_LAST_KEY) === '1');
  useEffect(() => { if (openOnLast && tool !== 'start') writeLocal(LAST_TOOL_KEY, tool); }, [tool, openOnLast]);
  const toggleOpenOnLast = (on) => { setOpenOnLast(on); writeLocal(OPEN_ON_LAST_KEY, on ? '1' : '0'); };
  const backToStart = () => { setGoal(null); setTool('start'); };
  const startGoal = (g) => {
    nonce.current += 1;
    setGoal(g);
    setPreset({ nonce: nonce.current, title: g.title, values: g.preset });
    setTool(g.steps[0].tool);
  };

  const [configured, setConfigured] = useState(true);
  const [glossaries, setGlossaries] = useState([]);
  const loadGlossaries = () => api.get('/api/translate/glossaries').then((r) => (r.ok ? r.json() : [])).then((d) => setGlossaries(Array.isArray(d) ? d : [])).catch(() => {});

  useEffect(() => {
    api.get('/api/translate/config').then((r) => r.json()).then((d) => {
      setConfigured(d.configured !== false);
    }).catch(() => {});
    loadGlossaries();
  }, []);
  // The learned glossaries grow after each translation, so the list is read again whenever the Glossaries screen is opened.
  useEffect(() => { if (tool === 'glossaries') loadGlossaries(); }, [tool]);

  const startTour = () => {
    try { localStorage.removeItem(TRANSLATE_TOUR_KEY); } catch { /* private window */ }
    startTranslateTour((id) => { if (id === 'start') backToStart(); else setTool(id); });
  };
  // Settings → Tours opens /translate?tour=1; ?tool=<id> opens one screen (links from other pages).
  useEffect(() => {
    const wantedTool = searchParams.get('tool');
    const wantsTour = searchParams.get('tour') === '1';
    const wantedJob = Number(searchParams.get('job')) || null;
    if (!wantedTool && !wantsTour && !wantedJob) return;
    if (isTool(wantedTool)) setTool(wantedTool);
    if (wantedJob) openJob(wantedJob);
    setSearchParams({}, { replace: true });
    if (wantsTour) { info.close(); setTimeout(startTour, 300); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const menu = GROUPS.map((label) => ({
    label,
    tip: GROUP_TIPS[label],
    tools: TRANSLATE_TOOLS.filter((t) => t.group === label && (!t.adminOnly || isAdmin)).map((t) => ({ ...t, tip: TOOL_TIPS[t.id] })),
  }));

  // The guide's "Open" buttons: switch to the screen that holds the control, exactly as clicking it in the list would.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    if (target) setTool(target.tool);
  };

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        <ToolSidebar
          title="Translate" icon="languages" groups={menu} current={tool} onSelect={setTool}
          onInfo={info.open} infoTip="How Translate works, and what it does not do."
          onTour={startTour} tourTip="Take the guided tour of Translate. Nothing is translated during the tour."
        >
          <Tooltip text="Go back to the list of jobs (a quick draft, a document to send, a scanned PDF and so on). Picking one fills in New translation for you.">
            <button
              type="button"
              onClick={backToStart}
              className="w-full flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-opacity duration-200 hover:opacity-70"
              style={{
                borderColor: tool === 'start' ? 'var(--color-primary)' : 'var(--color-border)',
                color: tool === 'start' ? 'var(--color-primary)' : 'var(--color-text)',
                background: 'var(--color-bg)',
              }}
            >
              {getIcon('layout-grid', { size: 13 })}
              What do you want to do?
            </button>
          </Tooltip>
        </ToolSidebar>

        <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col gap-3" style={{ background: 'var(--color-bg)' }}>
          <div className="w-full flex flex-col gap-3" style={{ maxWidth: 1700 }}>
            {!configured && (
              <div role="alert" className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: '#ef4444', color: 'var(--color-text)', background: 'var(--color-surface)' }}>
                <strong style={{ color: '#ef4444' }}>Translate is not set up yet.</strong>{' '}
                No translator is available, so a translation cannot be started. An admin can choose the AI model in Settings, AI &amp; Chat, Translate agent.
              </div>
            )}

            {tool === 'start' && (
              <JobStart
                goals={TRANSLATE_GOALS}
                appName="Translate"
                tourId="translate-goals"
                intro="Pick a job and New translation opens with the options already filled in; you can still change any of them. Or use the list on the left, or ask the guide (round button, bottom right)."
                onPick={startGoal}
                labelFor={toolLabel}
                openOnLast={openOnLast}
                onToggleOpenOnLast={toggleOpenOnLast}
              />
            )}

            {tool !== 'start' && <BackToJobs onBack={backToStart} toolLabel={null} goal={null} />}
            <JobBar goal={goal} mode={tool} onStep={setTool} labelFor={toolLabel} carry={<>go to</>} />

            {tool !== 'start' && !(tool === 'jobs' && openJobId) && (
              <div>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{toolLabel(tool)}</h2>
                <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS[tool]}</p>
              </div>
            )}

            {/* Always mounted: it owns the running translation. It shows nothing unless the screen is 'new' or 'jobs'. */}
            <TranslationsWorkspace
              glossaries={glossaries}
              view={tool}
              preset={preset}
              onShowJobs={() => setTool('jobs')}
              onNewTranslation={() => setTool('new')}
              onOpenGlossaries={() => setTool('glossaries')}
              openJobId={openJobId}
              onOpenJob={openJob}
            />
            {tool === 'glossaries' && <GlossariesPanel glossaries={glossaries} setGlossaries={setGlossaries} onOpenLearned={() => setTool('learned')} onReload={loadGlossaries} />}
            {tool === 'learned' && <LearnedPanel onOpenGlossaries={() => setTool('glossaries')} />}
            {tool === 'styles' && <HouseStylesPanel isAdmin={isAdmin} />}

            {tool !== 'start' && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                AI translation, for reference only. It is not legally certified; have a person who reads both languages check anything that matters.
              </p>
            )}
          </div>
        </div>
      </div>

      {info.show && (
        <ToolInfoModal title="How Translate works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Translate a document or some text into another language, see what the checks found, and download the result. Hover any control for a plain explanation. Not sure where to start? Press the round button at the bottom right and tell the guide what you want.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      <TranslateTutorChat currentTool={tool} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}
