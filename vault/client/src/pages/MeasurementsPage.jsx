import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import Tooltip from '../components/Tooltip';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { startMeasurementsTour, TOUR_KEY as MEASUREMENTS_TOUR_KEY } from '../utils/tours/measurementsTour';
import { unitsOfGroup } from '../utils/units/registry.mjs';
import { useMeasurementPrefs } from './measurements/prefs';
import ConverterTab from './measurements/ConverterTab';
import FormulasTab from './measurements/FormulasTab';
import ScannerTab from './measurements/ScannerTab';
import { FOCUS_RING } from './measurements/shared';

const TABS = [
  { id: 'convert', label: 'Converter', tour: 'measure-tab-convert' },
  { id: 'formulas', label: 'Formulas', tour: 'measure-tab-formulas' },
  { id: 'scan', label: 'Document scanner', tour: 'measure-tab-scan' },
];

function HowItWorks({ onClose }) {
  const H = ({ children }) => <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{children}</h3>;
  const P = ({ children }) => <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>{children}</p>;
  return (
    <ToolInfoModal title="How Measurements works" onClose={onClose}>
      <div className="space-y-1"><H>Converter</H><P>Pick a kind of measurement, type or say a value, choose the two units. The result updates as you go, shows the formula used, and lists the value in every unit of that kind. Cups and spoons follow the cup standard you pick (Australian by default: 250 ml cup, 20 ml tablespoon). Converting cups or spoons to grams needs an ingredient.</P></div>
      <div className="space-y-1"><H>Formulas</H><P>Every conversion comes from one list: the exact factor, the source, a worked example, and a warning where look-alike units differ (US vs imperial gallons, KB vs KiB). Each result links back to its entry. Ingredient densities are typical baking-chart values and are approximate.</P></div>
      <div className="space-y-1"><H>Document scanner</H><P>Drop a PDF, photo or screenshot, or paste text. Vault reads the text (running text recognition on scanned pages), finds measurements — fractions, ranges, sizes like 1200 × 600 × 18 mm, feet and inches, table columns with the unit in the heading — and proposes conversions. Unclear ones are flagged for you (a ” could be inches or a quote mark; m could be metres or minutes; oz weight or fluid). Nothing is converted until you accept it.</P></div>
      <div className="space-y-1"><H>Voice</H><P>Every input has a microphone. Say a number (“one and a half”), a unit (“kilometres per hour”) or a whole conversion (“five feet eleven in centimetres”). You see what was understood before it is used. Voice needs a browser with speech recognition (Chrome, Edge, Safari); typing always works.</P></div>
      <div className="space-y-1"><H>Privacy</H><P>Documents are read on this device. Nothing you scan is uploaded. Text recognition downloads its language data once, then is cached by the browser. Only your preferences and recent conversions are saved to your Vault account — never document contents.</P></div>
      <div className="space-y-1"><H>Not included yet</H><P>Currency, time zones, clothing sizes, and measuring drawn lines on plans (that needs a scale you set, like 1:100).</P></div>
    </ToolInfoModal>
  );
}

export default function MeasurementsPage() {
  const getIcon = useIcon();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'convert';
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

  // Settings → Measurements Tour opens /measurements?tour=1
  useEffect(() => {
    if (params.get('tour')) {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(() => startMeasurementsTour(setTab), 300);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTab = useCallback((id, extra = {}) => {
    const next = new URLSearchParams();
    if (id !== 'convert') next.set('tab', id);
    Object.entries(extra).forEach(([k, v]) => v && next.set(k, v));
    setParams(next);
  }, [setParams]);

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

  if (!canUse) return <Navigate to="/" replace />;

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col min-h-[calc(100dvh-3rem)]" style={{ background: 'var(--color-bg)' }}>
        <header className="px-4 sm:px-6 pt-5 pb-3 border-b flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>{getIcon('ruler', { size: 16 })}</div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Measurements</h1>
          <Tooltip text="Take the guided tour">
            <button type="button" aria-label="Take the Measurements tour" onClick={() => { try { localStorage.removeItem(MEASUREMENTS_TOUR_KEY); } catch (_) { /* ignore */ } startMeasurementsTour(setTab); }} className={`hover:opacity-60 transition-opacity duration-200 ${FOCUS_RING}`} style={{ color: 'var(--color-muted)' }}>{getIcon('compass', { size: 15 })}</button>
          </Tooltip>
          <Tooltip text="How this works">
            <button type="button" aria-label="How Measurements works" onClick={info.open} className={`hover:opacity-60 transition-opacity duration-200 ${FOCUS_RING}`} style={{ color: 'var(--color-muted)' }}>{getIcon('info', { size: 15 })}</button>
          </Tooltip>
          <nav className="flex gap-1 ml-auto" role="tablist" aria-label="Measurements sections" data-tour="measure-tabs">
            {TABS.map((t) => {
              const active = t.id === tab;
              return (
                <Tooltip key={t.id} text={t.id === 'convert' ? 'Convert one value between units' : t.id === 'formulas' ? 'Browse every formula, factor and source' : 'Find and convert measurements in a PDF, photo or text'}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-tour={t.tour}
                    onClick={() => setTab(t.id)}
                    className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 hover:opacity-70 ${FOCUS_RING}`}
                    style={{ background: active ? 'var(--color-primary)' : 'transparent', color: active ? '#fff' : 'var(--color-text)' }}
                  >
                    {t.label}
                  </button>
                </Tooltip>
              );
            })}
          </nav>
        </header>

        <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-5">
          {!loaded && <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>Loading your saved choices…</p>}
          {/* All three stay mounted (just hidden) so a typed value or a scanned document survives switching tabs */}
          <div style={{ display: tab === 'convert' ? 'block' : 'none' }}><ConverterTab prefs={prefs} update={update} history={history} addHistory={addHistory} clearHistory={clearHistory} onOpenFormula={openFormula} /></div>
          <div style={{ display: tab === 'formulas' ? 'block' : 'none' }}><FormulasTab prefs={prefs} focusUnit={focusUnit} onUseInConverter={useInConverter} /></div>
          <div style={{ display: tab === 'scan' ? 'block' : 'none' }}><ScannerTab prefs={prefs} update={update} /></div>
        </main>
      </div>
      {info.show && <HowItWorks onClose={info.close} />}
    </VoiceInputProvider>
  );
}
