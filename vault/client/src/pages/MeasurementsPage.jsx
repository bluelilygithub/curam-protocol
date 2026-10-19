import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import ToolSidebar from '../components/ToolSidebar';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { startMeasurementsTour, TOUR_KEY as MEASUREMENTS_TOUR_KEY } from '../utils/tours/measurementsTour';
import { unitsOfGroup } from '../utils/units/registry.mjs';
import { useMeasurementPrefs } from './measurements/prefs';
import ConverterTab from './measurements/ConverterTab';
import FormulasTab from './measurements/FormulasTab';
import ScannerTab from './measurements/ScannerTab';
import MeasurementsTutorChat from './measurements/MeasurementsTutorChat';
import {
  MEASUREMENT_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS,
} from './measurements/measurementsTools.mjs';

const MENU = GROUPS.map((label) => ({
  label,
  tip: GROUP_TIPS[label],
  tools: MEASUREMENT_TOOLS.filter((t) => t.group === label).map((t) => ({ ...t, tip: TOOL_TIPS[t.id] })),
}));

export default function MeasurementsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const [params, setParams] = useSearchParams();
  const tab = MEASUREMENT_TOOLS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'convert';
  const focusUnit = params.get('unit');
  const info = useToolInfoModal('vault_measurements_info_seen');
  const { prefs, update, history, addHistory, clearHistory, loaded } = useMeasurementPrefs();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.measurements !== false;
  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  const setTab = useCallback((id, extra = {}) => {
    const next = new URLSearchParams();
    if (id !== 'convert') next.set('tab', id);
    Object.entries(extra).forEach(([k, v]) => v && next.set(k, v));
    setParams(next);
  }, [setParams]);

  // Settings → Measurements Tour opens /measurements?tour=1
  useEffect(() => {
    if (params.get('tour')) {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(() => startMeasurementsTour(setTab), 300);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openFormula = (unitId) => setTab('formulas', { unit: unitId });
  const useInConverter = (unitId) => {
    const g = unitId.split('.')[0];
    update((p) => {
      const others = unitsOfGroup(g).filter((u) => u.id !== unitId);
      const keepTo = p.group === g && p.toId && p.toId !== unitId && p.toId.startsWith(`${g}.`);
      return { group: g, fromId: unitId, toId: keepTo ? p.toId : (others.find((u) => u.system === 'metric') || others[0])?.id };
    });
    setTab('convert');
  };

  // The guide's "Open" buttons: switch to the tool that holds the control, exactly as clicking it in the list would.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    if (target) setTab(target.tool);
  };

  const startTour = () => {
    try { localStorage.removeItem(MEASUREMENTS_TOUR_KEY); } catch (_) { /* ignore */ }
    startMeasurementsTour(setTab);
  };

  if (!canUse) return <Navigate to="/" replace />;

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        <ToolSidebar
          title="Measurements"
          icon="ruler"
          groups={MENU}
          current={tab}
          onSelect={(id) => setTab(id)}
          onInfo={info.open}
          infoTip="How Measurements works, and what it does not do yet."
          onTour={startTour}
          tourTip="Take the guided tour of Measurements."
        />

        <main className="flex-1 min-w-0 overflow-y-auto p-6 space-y-4 max-w-5xl" style={{ background: 'var(--color-bg)' }} data-tour="measure-tabs">
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS[tab]}</p>
          {!loaded && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading your saved choices…</p>}
          {/* All three stay mounted (just hidden) so a typed value or a scanned document survives switching tools */}
          <div style={{ display: tab === 'convert' ? 'block' : 'none' }}><ConverterTab prefs={prefs} update={update} history={history} addHistory={addHistory} clearHistory={clearHistory} onOpenFormula={openFormula} /></div>
          <div style={{ display: tab === 'formulas' ? 'block' : 'none' }}><FormulasTab prefs={prefs} focusUnit={focusUnit} onUseInConverter={useInConverter} /></div>
          <div style={{ display: tab === 'scan' ? 'block' : 'none' }}><ScannerTab prefs={prefs} update={update} /></div>
        </main>
      </div>

      {info.show && (
        <ToolInfoModal title="How Measurements Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Convert units, see the formula behind every conversion, and scan documents for measurements. Pick a tool in the list on the left; hover any tool for a plain explanation. Not sure where to start? Press the round button at the bottom right and tell the guide what you want to do.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      <MeasurementsTutorChat currentTool={tab} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}
