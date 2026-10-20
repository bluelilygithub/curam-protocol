import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import ToolSidebar from '../components/ToolSidebar';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { startPcHealthTour, TOUR_KEY as PC_HEALTH_TOUR_KEY } from '../utils/tours/pcHealthTour';
import PcHealthTutorChat from './pcHealth/PcHealthTutorChat';
import {
  OverviewPanel, ScanPanel, DiskPanel, FilesPanel, LogsPanel, GrowthPanel, PerformancePanel, HistoryPanel, HelperPanel,
} from './pcHealth/Panels';
import {
  PC_HEALTH_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS,
} from './pcHealth/pcHealthTools.mjs';

const MENU = GROUPS.map((label) => ({
  label,
  tip: GROUP_TIPS[label],
  tools: PC_HEALTH_TOOLS.filter((t) => t.group === label).map((t) => ({ ...t, tip: TOOL_TIPS[t.id] })),
}));

const toast = (message, type = 'error') => useToastStore.getState().addToast(message, type);

/**
 * PC Health (/pc-health, admin only). Reports on the admin's OWN computer: a small read-only helper running on that PC picks up a
 * queued scan and posts the report; this page shows it. Nothing here deletes, moves or changes anything. docs/pc-health.md.
 */
export default function PcHealthPage() {
  const { user } = useAuthStore();
  const isAdmin = !!user?.isAdmin;
  const [params, setParams] = useSearchParams();
  const tab = PC_HEALTH_TOOLS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview';
  const info = useToolInfoModal('vault_pc_health_info_seen');

  const [status, setStatus] = useState(null);
  const [scans, setScans] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [scan, setScan] = useState(null);
  const pinnedRef = useRef(false);     // true once the person opened an older scan on purpose
  const lastDoneRef = useRef(null);

  const setTab = useCallback((id) => {
    const next = new URLSearchParams();
    if (id !== 'overview') next.set('tab', id);
    setParams(next);
  }, [setParams]);

  const loadScans = useCallback(async () => {
    try { const r = await api.get('/api/pc-health/scans'); if (r.ok) setScans(await r.json()); } catch (_) { /* shown next poll */ }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const r = await api.get('/api/pc-health/status');
      if (!r.ok) return null;
      const d = await r.json();
      setStatus(d);
      return d;
    } catch (_) { return null; }
  }, []);

  // Poll quickly while a scan is waiting or running, slowly otherwise.
  useEffect(() => {
    if (!isAdmin) return undefined;
    let stop = false; let timer;
    const tick = async () => {
      const d = await loadStatus();
      if (stop) return;
      if (d && d.latestDoneId !== lastDoneRef.current) {
        const first = lastDoneRef.current === null;
        lastDoneRef.current = d.latestDoneId;
        if (d.latestDoneId && !pinnedRef.current) setOpenId(d.latestDoneId);
        loadScans();
        if (!first && d.latestDoneId) { toast('Your PC Health scan has finished.', 'success'); }
      }
      timer = setTimeout(tick, d?.active ? 4000 : 20000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [isAdmin, loadStatus, loadScans]);

  useEffect(() => {
    if (!openId) { setScan(null); return undefined; }
    let stop = false;
    api.get(`/api/pc-health/scans/${openId}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!stop) setScan(d); }).catch(() => {});
    return () => { stop = true; };
  }, [openId]);

  // Settings → PC Health Tour opens /pc-health?tour=1
  useEffect(() => {
    if (params.get('tour')) {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(() => startPcHealthTour(setTab), 300);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startScan = async (options) => {
    const r = await api.post('/api/pc-health/scans', options);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) toast(d.error || 'Could not ask for a scan.');
    await loadStatus();
    await loadScans();
  };
  const cancelScan = async (id) => {
    const r = await api.post(`/api/pc-health/scans/${id}/cancel`, {});
    if (!r.ok) toast('That scan had already finished.');
    await loadStatus();
    await loadScans();
  };
  const createKey = async () => {
    const r = await api.post('/api/pc-health/helper-token', {});
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.token) { toast('Could not make a key.'); return null; }
    await loadStatus();
    return d.token;
  };
  const removeKey = async () => {
    await api.delete('/api/pc-health/helper-token');
    await loadStatus();
  };
  const downloadHelper = async () => {
    try {
      const r = await api.get('/api/pc-health/helper-script');
      if (!r.ok) throw new Error('failed');
      const blob = new Blob([await r.text()], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'pc-health-helper.ps1';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (_) { toast('Could not download the helper.'); }
  };

  const openScan = (id) => { pinnedRef.current = id !== lastDoneRef.current; setOpenId(id); setTab('overview'); };

  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    if (target) setTab(target.tool);
  };

  const startTour = () => {
    try { localStorage.removeItem(PC_HEALTH_TOUR_KEY); } catch (_) { /* ignore */ }
    startPcHealthTour(setTab);
  };

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        <ToolSidebar
          title="PC Health"
          icon="cpu"
          groups={MENU}
          current={tab}
          onSelect={setTab}
          onInfo={info.open}
          infoTip="How PC Health works, and what it does not do."
          onTour={startTour}
          tourTip="Take the guided tour of PC Health."
        />

        <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-4 max-w-5xl" style={{ background: 'var(--color-bg)' }}>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS[tab]}</p>
          {tab === 'overview' && <OverviewPanel scan={scan} goTo={setTab} />}
          {tab === 'scan' && <ScanPanel status={status} onStart={startScan} onCancel={cancelScan} goTo={setTab} />}
          {tab === 'disk' && <DiskPanel scan={scan} goTo={setTab} />}
          {tab === 'files' && <FilesPanel scan={scan} goTo={setTab} />}
          {tab === 'logs' && <LogsPanel scan={scan} goTo={setTab} />}
          {tab === 'growth' && <GrowthPanel scan={scan} goTo={setTab} />}
          {tab === 'performance' && <PerformancePanel scan={scan} goTo={setTab} />}
          {tab === 'history' && <HistoryPanel scans={scans} openId={openId} onOpen={openScan} />}
          {tab === 'helper' && <HelperPanel status={status} onCreateKey={createKey} onRemoveKey={removeKey} onDownload={downloadHelper} />}
        </div>
      </div>

      {info.show && (
        <ToolInfoModal title="How PC Health Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Check your own computer for a full disk, memory or processor problems, and large, growing or left-behind files. It only reports; it never deletes or changes anything. Pick a tool in the list on the left; hover any tool for a plain explanation. Not sure where to start? Press the round button at the bottom right and tell the guide what you want to know.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, body]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {body}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      <PcHealthTutorChat currentTool={tab} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}
