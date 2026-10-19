import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as opentype from 'opentype.js';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import Tooltip from '../components/Tooltip';
import ToolSidebar from '../components/ToolSidebar';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import FontPicker from './fonts/FontPicker';
import FontTransformControls, { DEFAULT_TRANSFORMS } from './fonts/FontTransformControls';
import FontKerningPanel, { DEFAULT_KERNING } from './fonts/FontKerningPanel';
import FontPresetsPanel from './fonts/FontPresetsPanel';
import FontProofingText from './fonts/FontProofingText';
import { PROOFING_PRESETS, DEFAULT_PROOFING_TEXT } from './fonts/proofingPresets';
import { loadPresets, savePreset, deletePreset } from './fonts/fontPresetsStorage';
import { findUncoveredChars } from './fonts/coverageCheck';
import { startFontsTour, TOUR_KEY as FONTS_TOUR_KEY } from '../utils/tours/fontsTour';
import FontTutorialModal, { DRAMATIC_DEMO, TUTORIAL_SEEN_KEY } from './fonts/FontTutorialModal';
import { FONT_EFFECTS, effectClassName, ensureEffectLoaded } from './fonts/fontEffects';
import FontsTutorChat from './fonts/FontsTutorChat';
import { FONT_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS } from './fonts/fontsTools.mjs';

const PREVIEW_SCOPE_SELECTOR = '.font-customizer-preview-text';

const PREVIEW_DEBOUNCE_MS = 700;
let previewFontFaceCounter = 0; // each preview gets its OWN font-family name — never reuse one, to rule out any browser repaint-caching-by-family-name ambiguity

const FORMAT_MIME = { ttf: 'font/ttf', otf: 'font/otf', woff2: 'font/woff2' };

function slugify(name) {
  return (name || 'custom-font').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function dataUrlToArrayBuffer(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Single-screen Font Customizer: search a Google Font, adjust real
 * structural properties, see the real transformed font (not a
 * client-side approximation), download the real file. That's the whole
 * tool — no separate preview-vs-export modes, no CSS effects panel, no
 * SVG print export (those still exist server-side if ever wanted back,
 * just not surfaced here).
 */
export default function FontsPage() {
  const getIcon = useIcon();
  const fontFaceRef = useRef(null); // the currently-registered FontFace, so we can remove it before adding the next preview
  const debounceRef = useRef(null);

  // Font selection / session
  const [searchValue, setSearchValue] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [sessionMeta, setSessionMeta] = useState(null); // { family, license, was_variable, original_axes, ... }
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState('');

  // Settings
  const [transforms, setTransforms] = useState(DEFAULT_TRANSFORMS);
  const [kerning, setKerning] = useState(DEFAULT_KERNING);
  const [presets, setPresets] = useState(() => loadPresets());

  // Live preview (real pipeline output)
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewReady, setPreviewReady] = useState(false);
  const [previewStale, setPreviewStale] = useState(false); // true whenever what's DISPLAYED no longer matches the current slider state (a newer preview is pending or failed)
  const [activeFontFamily, setActiveFontFamily] = useState('');
  const [parsedFont, setParsedFont] = useState(null);
  const [coverageReport, setCoverageReport] = useState(null);
  const [downloadBuffers, setDownloadBuffers] = useState({}); // { ttf?: ArrayBuffer } from the latest preview — reused for download, transform not re-run

  // Preview text
  const [activePresetId, setActivePresetId] = useState(PROOFING_PRESETS[0].id);
  const [customText, setCustomText] = useState(DEFAULT_PROOFING_TEXT);
  const previewText = activePresetId === 'custom'
    ? customText
    : (PROOFING_PRESETS.find((p) => p.id === activePresetId)?.text || DEFAULT_PROOFING_TEXT);

  // Download
  const [newFamilyName, setNewFamilyName] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [finalBuffers, setFinalBuffers] = useState({}); // { ttf?, woff2?, otf? } from the last Download-with-real-name call

  // Saved projects (server-persisted — the actual "save this font, come back to it later" feature)
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState('');
  const [savingProjectName, setSavingProjectName] = useState('');
  const [savingProject, setSavingProject] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [activeProjectId, setActiveProjectId] = useState(null); // the saved project currently loaded, if any — lets "Save" update it instead of always creating a new one
  const [loadedProjectName, setLoadedProjectName] = useState(''); // the name it had when loaded — if the user changes the name field, Save creates a new one instead of renaming the original

  // Text effect (Google's font-effect CSS classes — rendering-layer only, never touches the font file; see fontEffects.js)
  const [effect, setEffect] = useState('none');

  // Dramatic-example modal — opened from the (i) box or "Show me a dramatic example" (the (i) box is what opens by itself the first time)
  const [showTutorial, setShowTutorial] = useState(false);
  const closeTutorial = () => {
    setShowTutorial(false);
    try { localStorage.setItem(TUTORIAL_SEEN_KEY, '1'); } catch { /* private window — just won't remember */ }
  };

  const uncoveredChars = parsedFont ? findUncoveredChars(parsedFont, coverageReport, previewText) : [];

  /** @returns {Promise<object|null>} the session meta on success, or null on failure — callers that need to chain (e.g. loading a saved project's recipe) await this. */
  const createSession = useCallback(async (family, { resetSettings = true } = {}) => {
    if (!family || !family.trim()) return null;
    setSessionError('');
    setSessionLoading(true);
    setPreviewReady(false);
    setPreviewStale(false);
    setSessionMeta(null);
    setSessionId(null);
    if (fontFaceRef.current) { document.fonts.delete(fontFaceRef.current); fontFaceRef.current = null; }
    try {
      const res = await api.post('/api/fonts/session', { family: family.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load this font.');
      setSessionId(data.sessionId);
      setSessionMeta(data.meta);
      setTool((t) => (t === 'font' || t === 'my-fonts' ? 'shape' : t));
      if (resetSettings) {
        setTransforms(DEFAULT_TRANSFORMS);
        setKerning(DEFAULT_KERNING);
        setEffect('none');
      }
      setNewFamilyName('');
      setFinalBuffers({});
      return data.meta;
    } catch (err) {
      setSessionError(err.message || 'Could not load this font.');
      return null;
    } finally {
      setSessionLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError('');
    try {
      const res = await api.get('/api/fonts/projects');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load saved fonts.');
      setProjects(data.projects || []);
    } catch (err) {
      setProjectsError(err.message || 'Could not load saved fonts.');
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const saveProject = async () => {
    if (!sessionMeta?.family) return;
    if (!savingProjectName.trim()) {
      setSaveError('Give it a name to save.');
      return;
    }
    setSaveError('');
    setSavingProject(true);
    try {
      const recipe = { transforms, kerning, effect };
      const isUpdatingSameProject = activeProjectId && savingProjectName.trim() === loadedProjectName;
      const res = isUpdatingSameProject
        ? await api.put(`/api/fonts/projects/${activeProjectId}`, { name: savingProjectName.trim(), recipe })
        : await api.post('/api/fonts/projects', { name: savingProjectName.trim(), googleFont: sessionMeta.family, recipe });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save this font.');
      setActiveProjectId(data.project.id);
      setLoadedProjectName(data.project.name);
      await loadProjects();
    } catch (err) {
      setSaveError(err.message || 'Could not save this font.');
    } finally {
      setSavingProject(false);
    }
  };

  const loadProject = async (project) => {
    const meta = await createSession(project.googleFont, { resetSettings: false });
    if (!meta) return; // createSession already surfaced sessionError
    setTransforms(project.recipe?.transforms || DEFAULT_TRANSFORMS);
    setKerning(project.recipe?.kerning || DEFAULT_KERNING);
    setEffect(project.recipe?.effect || 'none');
    setActiveProjectId(project.id);
    setSavingProjectName(project.name);
    setLoadedProjectName(project.name);
  };

  const deleteProject = async (id) => {
    try {
      const res = await api.delete(`/api/fonts/projects/${id}`);
      if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
      if (activeProjectId === id) setActiveProjectId(null);
      await loadProjects();
    } catch (err) {
      setProjectsError(err.message || 'Could not delete this saved font.');
    }
  };

  // Debounced real preview — runs transform+export against the cached
  // base font (fast: no re-fetch) every time transforms/kerning settle.
  useEffect(() => {
    if (!sessionId) return undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPreviewStale(true); // the moment a slider changes, whatever's on screen is stale until the next successful preview lands

    debounceRef.current = setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError('');
      try {
        const res = await api.post(`/api/fonts/session/${sessionId}/preview`, {
          recipe: { transforms, kerning },
          rename: { familyName: `${sessionMeta?.family || 'Custom'} Draft` }, // placeholder — the real name is only required at Download
          rangeIds: ['basic-latin', 'latin-1-supplement'],
          formats: ['ttf'],
        });
        const data = await res.json();

        if (!res.ok) {
          if (data.code === 'SESSION_EXPIRED') {
            // Requirement: a missing/expired session re-triggers fetch+freeze, not a silent failure or dead end.
            setPreviewError('This session expired — reloading the font…');
            await createSession(sessionMeta?.family);
            return;
          }
          throw new Error(data.error || 'Preview failed.');
        }

        const buffer = dataUrlToArrayBuffer(data.formats.ttf);
        const parsed = opentype.parse(buffer.slice(0));
        setParsedFont(parsed);
        setCoverageReport(data.report);
        setDownloadBuffers({ ttf: buffer });

        // A fresh, never-before-used family name every time — rules out any
        // browser repaint-caching keyed on font-family (the old code reused
        // one fixed name and relied on delete-then-add, which should work
        // per spec but is a needless risk to carry when a unique name costs nothing).
        previewFontFaceCounter += 1;
        const familyForThisLoad = `FontCustomizerPreview-${previewFontFaceCounter}`;
        const fontFace = new FontFace(familyForThisLoad, buffer);
        await fontFace.load();
        document.fonts.add(fontFace);
        if (fontFaceRef.current) document.fonts.delete(fontFaceRef.current); // drop the previous one only after the new one is confirmed loaded
        fontFaceRef.current = fontFace;
        setActiveFontFamily(familyForThisLoad);

        setPreviewReady(true);
        setPreviewStale(false);
      } catch (err) {
        setPreviewError(err.message || 'Preview failed.');
        // previewStale stays true — the font shown below (if any) is from
        // an older slider state, and the banner makes that unmistakable
        // rather than silently leaving a stale render looking current.
      } finally {
        setPreviewLoading(false);
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, transforms, kerning]);

  // Load the selected effect's CSS whenever it changes.
  useEffect(() => {
    ensureEffectLoaded(effect, PREVIEW_SCOPE_SELECTOR).catch(() => { /* effect just won't render — not fatal */ });
  }, [effect]);

  const runDramaticDemo = async () => {
    setActiveProjectId(null);
    setSavingProjectName('');
    setSearchValue(DRAMATIC_DEMO.family);
    const meta = await createSession(DRAMATIC_DEMO.family, { resetSettings: false });
    if (!meta) return;
    setTransforms(DRAMATIC_DEMO.transforms);
    setKerning(DRAMATIC_DEMO.kerning);
    setEffect(DRAMATIC_DEMO.effect);
    setActivePresetId(PROOFING_PRESETS[0].id);
  };

  const handleSavePreset = (name) => setPresets(savePreset(name, { transforms, kerning }));
  const handleApplyPreset = (preset) => { setTransforms(preset.transforms); setKerning(preset.kerning); };
  const handleDeletePreset = (id) => setPresets(deletePreset(id));

  const runDownload = async (formats) => {
    if (!sessionId) return;
    if (!newFamilyName.trim()) {
      setDownloadError('A new family name is required — required by the font\'s OFL license before redistributing a modified copy.');
      return;
    }
    setDownloadError('');
    setDownloading(true);
    try {
      const res = await api.post(`/api/fonts/session/${sessionId}/preview`, {
        recipe: { transforms, kerning },
        rename: { familyName: newFamilyName.trim() },
        rangeIds: ['basic-latin', 'latin-1-supplement'],
        formats,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Download failed.');

      const buffers = {};
      for (const [fmt, url] of Object.entries(data.formats)) buffers[fmt] = dataUrlToArrayBuffer(url);
      setFinalBuffers((prev) => ({ ...prev, ...buffers }));

      // Trigger a save for whichever formats were just (re)generated.
      for (const fmt of Object.keys(buffers)) {
        const blob = new Blob([buffers[fmt]], { type: FORMAT_MIME[fmt] || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${slugify(newFamilyName)}.${fmt}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setDownloadError(err.message || 'Download failed.');
    } finally {
      setDownloading(false);
    }
  };

  const [tool, setTool] = useState('font');
  const info = useToolInfoModal('vault_fonts_info_seen');
  const currentTool = FONT_TOOLS.find((t) => t.id === tool);
  const showsPanel = tool !== 'font' && tool !== 'my-fonts';
  const menu = GROUPS.map((label) => ({
    label,
    tip: GROUP_TIPS[label],
    tools: FONT_TOOLS.filter((t) => t.group === label).map((t) => ({
      ...t, tip: TOOL_TIPS[t.id], hint: t.needsFont && !sessionId ? 'Load a font first' : undefined,
    })),
  }));

  // The guide's "Open" buttons: switch to the tool, exactly as clicking it in the list would.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    if (target) setTool(target.tool);
  };

  const startTour = () => {
    try { localStorage.removeItem(FONTS_TOUR_KEY); } catch { /* private window */ }
    startFontsTour(setTool);
  };

  const needFont = (
    <div className="rounded-xl border p-4 text-sm space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
      <p>Load a font first, then come back here.</p>
      <button
        type="button"
        onClick={() => setTool('font')}
        className="text-sm px-3 py-1.5 rounded-lg transition-opacity duration-200 hover:opacity-70"
        style={{ background: 'var(--color-primary)', color: '#fff' }}
      >
        Choose a font
      </button>
    </div>
  );

  const errorBox = { background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444', color: '#ef4444' };
  const primaryBtn = 'text-sm px-3 py-1.5 rounded-lg transition-opacity duration-200 hover:opacity-70 disabled:opacity-40';

  const renderPanel = () => {
    if (!sessionId) return needFont;
    switch (tool) {
      case 'shape':
        return <FontTransformControls transforms={transforms} onChange={setTransforms} />;
      case 'kerning':
        return <FontKerningPanel kerning={kerning} onChange={setKerning} />;
      case 'effect':
        return (
          <div data-tour="fonts-effect">
            <Tooltip text="A small set of Google's own CSS text effects (fire, neon, emboss, outline, layered shadow) applied on top of the preview — CSS only, saved with the font project, never baked into the exported file itself.">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Text effect</span>
            </Tooltip>
            <select
              value={effect}
              onChange={(e) => setEffect(e.target.value)}
              aria-label="Text effect"
              className="w-full rounded-lg px-2 py-2 text-sm mt-1"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              {FONT_EFFECTS.map((e) => (
                <option key={e.id} value={e.id}>{e.label}</option>
              ))}
            </select>
            <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Preview only. The effect is saved with “Save this font” but is not in the downloaded file.</p>
          </div>
        );
      case 'save':
        return (
          <div data-tour="fonts-save-project">
            <Tooltip text="Saves this exact font + Transforms + Kerning to your account — reopen it anytime from My Fonts, on any device. Unlike Saved settings, this remembers WHICH font too, not just the slider values.">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Save this font</span>
            </Tooltip>
            <div className="space-y-2 mt-1">
              <Tooltip text="A name to find it by later. You can say it with the microphone.">
                <div>
                  <VoiceInput
                    value={savingProjectName}
                    onChange={setSavingProjectName}
                    placeholder="e.g. Bold Roboto Draft"
                    label="Name for this saved font"
                    onKeyDown={(e) => { if (e.key === 'Enter' && savingProjectName.trim() && !savingProject) saveProject(); }}
                  />
                </div>
              </Tooltip>
              <button onClick={saveProject} disabled={savingProject || !savingProjectName.trim()} className={primaryBtn} style={{ background: 'var(--color-primary)', color: '#fff' }}>
                {savingProject ? 'Saving…' : (activeProjectId && savingProjectName.trim() === loadedProjectName ? 'Update' : 'Save')}
              </button>
            </div>
            {saveError && <p className="text-xs mt-1" style={{ color: '#ef4444' }}>{saveError}</p>}
            {activeProjectId && savingProjectName.trim() === loadedProjectName && (
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Updating "{loadedProjectName}" — or change the name to save as a separate copy instead.</p>
            )}
          </div>
        );
      case 'settings':
        return <FontPresetsPanel presets={presets} onSave={handleSavePreset} onApply={handleApplyPreset} onDelete={handleDeletePreset} />;
      case 'download':
        return (
          <div data-tour="fonts-download">
            <Tooltip text="OFL's Reserved Font Name clause requires a genuinely different name from the original before you can redistribute a modified copy.">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>New family name (required)</span>
            </Tooltip>
            <div className="mt-1">
              <VoiceInput value={newFamilyName} onChange={setNewFamilyName} placeholder="e.g. My Custom Roboto" label="New family name" />
            </div>
            {downloadError && <p className="text-xs mt-1" style={{ color: '#ef4444' }}>{downloadError}</p>}
            <div className="flex gap-2 mt-2">
              <Tooltip text="Saves the .ttf file — reuses what you're already previewing, only renames it for real. No transform is re-run.">
                <button
                  onClick={() => runDownload(['ttf'])}
                  disabled={downloading || !previewReady}
                  className="flex-1 text-xs px-2 py-2 rounded-lg transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                  style={{ background: 'var(--color-primary)', color: '#fff' }}
                >
                  .ttf
                </button>
              </Tooltip>
              <Tooltip text="Also generates .woff2 (web) and .otf (CFF conversion) with the same settings.">
                <button
                  onClick={() => runDownload(['ttf', 'woff2', 'otf'])}
                  disabled={downloading || !previewReady}
                  className="flex-1 text-xs px-2 py-2 rounded-lg transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
                >
                  All formats
                </button>
              </Tooltip>
            </div>
            {!previewReady && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Available once the preview has appeared.</p>}
            {downloading && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Generating…</p>}
            {Object.keys(finalBuffers).length > 0 && !downloading && (
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Downloaded: {Object.keys(finalBuffers).join(', ')}. Nothing is saved here — re-download if you need it again.
              </p>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        <ToolSidebar
          title="Font Customizer"
          icon="type"
          groups={menu}
          current={tool}
          onSelect={setTool}
          onInfo={info.open}
          infoTip="How the Font Customizer works, with a dramatic example you can run."
          onTour={startTour}
          tourTip="Take the guided tour of the Font Customizer."
        />

        <div className="flex-1 min-w-0 flex flex-col lg:flex-row" style={{ background: 'var(--color-bg)' }}>
          <div className="flex-1 min-w-0 p-6 space-y-5">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS[tool]}</p>

            {tool === 'my-fonts' && (
              <div data-tour="fonts-my-fonts">
                {projectsError && <p className="text-xs mb-1" style={{ color: '#ef4444' }}>{projectsError}</p>}
                {projectsLoading && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading your saved fonts…</p>}
                {!projectsLoading && projects.length === 0 && (
                  <div className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
                    Nothing saved yet. Load a font, change it, then use “Save this font”.
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {projects.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                      style={{ background: activeProjectId === p.id ? 'var(--color-primary)' : 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                    >
                      <Tooltip text="Open this font: it is fetched again and your saved settings are put back.">
                        <button
                          onClick={() => { loadProject(p); }}
                          className="text-sm transition-opacity duration-200 hover:opacity-70"
                          style={{ color: activeProjectId === p.id ? '#fff' : 'var(--color-text)' }}
                        >
                          {p.name} <span className="text-xs" style={{ color: activeProjectId === p.id ? 'rgba(255,255,255,0.7)' : 'var(--color-muted)' }}>({p.googleFont})</span>
                        </button>
                      </Tooltip>
                      <Tooltip text="Delete this saved font.">
                        <button
                          onClick={() => deleteProject(p.id)}
                          aria-label={`Delete ${p.name}`}
                          className="transition-opacity duration-200 hover:opacity-70"
                          style={{ color: activeProjectId === p.id ? '#fff' : 'var(--color-muted)' }}
                        >
                          {getIcon('trash', { size: 12 })}
                        </button>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tool === 'font' && (
              <div data-tour="fonts-search">
                <Tooltip text="Search Google Fonts (OFL-licensed only) — click a result or press Enter to load it. Variable fonts are automatically frozen to a static instance before editing. You can say the name with the microphone.">
                  <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Google Font</span>
                </Tooltip>
                <div className="flex items-start gap-2 mt-1 max-w-xl">
                  <div className="flex-1">
                    <FontPicker value={searchValue} onChange={setSearchValue} onSelect={(f) => { setActiveProjectId(null); setSavingProjectName(''); createSession(f); }} />
                  </div>
                  <Tooltip text="Fetch this font from Google Fonts and load it for editing.">
                    <button
                      onClick={() => { setActiveProjectId(null); setSavingProjectName(''); createSession(searchValue); }}
                      disabled={!searchValue.trim() || sessionLoading}
                      className={primaryBtn}
                      style={{ background: 'var(--color-primary)', color: '#fff' }}
                    >
                      {sessionLoading ? 'Loading…' : 'Load'}
                    </button>
                  </Tooltip>
                </div>
                {sessionError && <p className="text-xs mt-1" style={{ color: '#ef4444' }}>{sessionError}</p>}
                {sessionMeta && (
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                    {sessionMeta.family} — {sessionMeta.license}
                    {sessionMeta.was_variable ? ' — variable font, frozen to a static instance for editing.' : ' — static font.'}
                  </p>
                )}
                <Tooltip text="Load Roboto with every setting turned well up, so you can see at a glance what the tool does.">
                  <button
                    type="button"
                    onClick={() => setShowTutorial(true)}
                    className="text-xs mt-2 inline-flex items-center gap-1 transition-opacity duration-200 hover:opacity-60"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    {getIcon('sparkles', { size: 12 })} Show me a dramatic example
                  </button>
                </Tooltip>
              </div>
            )}

            {!sessionId && !sessionLoading && (
              <div className="rounded-xl p-10 flex items-center justify-center text-sm text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>
                Search and load a font to get started.
              </div>
            )}

            {sessionId && (
              <>
                <FontProofingText
                  activePresetId={activePresetId}
                  customText={customText}
                  onSelectPreset={setActivePresetId}
                  onCustomTextChange={setCustomText}
                />

                {uncoveredChars.length > 0 && (
                  <div className="rounded-lg p-3 text-sm" style={errorBox}>
                    <strong>Character coverage issue:</strong>{' '}
                    {uncoveredChars.map((u, i) => (
                      <span key={u.char + i}>
                        {i > 0 && ', '}
                        "{u.char}" {u.reason === 'skipped_at_export' ? `(skipped — ${u.detail})` : '(not in this font\'s subset)'}
                      </span>
                    ))}
                    . These characters won't render correctly.
                  </div>
                )}

                {previewError && (
                  <div className="rounded-lg p-3 text-sm" style={errorBox}>
                    <strong>Preview failed to update:</strong> {previewError} The text below is from an older setting,
                    not what the sliders currently show — it will not match until a preview succeeds.
                  </div>
                )}

                <div
                  className="rounded-xl flex items-center justify-center p-10 overflow-hidden relative"
                  style={{
                    background: 'var(--color-surface)',
                    border: previewStale && previewReady ? '1px dashed #f59e0b' : '1px solid var(--color-border)',
                    minHeight: 160,
                    opacity: previewStale && previewReady ? 0.55 : 1,
                  }}
                  data-tour="fonts-preview"
                >
                  {previewLoading && (
                    <div className="absolute top-2 right-3 text-xs px-2 py-1 rounded" style={{ background: 'var(--color-primary)', color: '#fff' }}>
                      Updating preview…
                    </div>
                  )}
                  {!previewLoading && previewStale && previewReady && !previewError && (
                    <div className="absolute top-2 right-3 text-xs px-2 py-1 rounded" style={{ background: '#f59e0b', color: '#fff' }}>
                      Out of date
                    </div>
                  )}
                  {previewReady ? (
                    <span
                      className={`font-customizer-preview-text ${effectClassName(effect)}`}
                      style={{
                        fontSize: 56,
                        lineHeight: 1.2,
                        fontFamily: `'${activeFontFamily}', sans-serif`,
                        // An active effect supplies its own color/background-clip — don't fight it with an inline color.
                        ...(effect === 'none' ? { color: 'var(--color-text)' } : {}),
                      }}
                    >
                      {previewText || DEFAULT_PROOFING_TEXT}
                    </span>
                  ) : (
                    <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
                      {previewLoading ? 'Generating first preview…' : 'Adjust a setting to generate a preview.'}
                    </span>
                  )}
                </div>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  This is the real exported font, rendered via an actual @font-face — not an approximation. Every
                  change runs the real structural transform on the server.
                </p>
              </>
            )}
          </div>

          {showsPanel && (
            <div className="lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l p-5 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{currentTool?.label}</h2>
              {renderPanel()}
            </div>
          )}
        </div>
      </div>

      {showTutorial && <FontTutorialModal onClose={closeTutorial} onRunDemo={runDramaticDemo} />}
      {info.show && (
        <ToolInfoModal title="How the Font Customizer Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Start from a Google Font, reshape it, and download your own renamed copy. Pick a tool in the list on the left; hover any tool for a plain explanation. Not sure what to do? Press the round button at the bottom right and tell the guide.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { info.close(); setShowTutorial(true); }}
            className="text-sm px-3 py-1.5 rounded-lg transition-opacity duration-200 hover:opacity-70"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-primary)' }}
          >
            Show me a dramatic example
          </button>
        </ToolInfoModal>
      )}

      <FontsTutorChat currentTool={tool} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}
