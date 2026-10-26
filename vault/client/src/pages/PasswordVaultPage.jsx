import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import usePasswordVaultStore from '../store/passwordVaultStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import ToolSidebar from '../components/ToolSidebar';
import Tooltip from '../components/Tooltip';
import { VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { startPasswordVaultTour, TOUR_KEY as VAULT_TOUR_KEY } from '../utils/tours/passwordVaultTour';
import useVault from './passwordVault/useVault';
import PasswordsTool from './passwordVault/PasswordsTool';
import GeneratorTool from './passwordVault/GeneratorTool';
import HealthTool from './passwordVault/HealthTool';
import MasterTool from './passwordVault/MasterTool';
import PasswordVaultTutorChat from './passwordVault/PasswordVaultTutorChat';
import { STATUS } from './passwordVault/shared';
import {
  VAULT_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, HOW_IT_WORKS, GUIDE_TOOLS,
} from './passwordVault/passwordVaultTools.mjs';

// A tool that needs the vault open says so under its name while it is locked.
const NEEDS_UNLOCK = new Set(['passwords', 'health']);

export default function PasswordVaultPage() {
  const getIcon = useIcon();
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const [params, setParams] = useSearchParams();
  const tab = VAULT_TOOLS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'passwords';
  const info = useToolInfoModal('vault_password_vault_info_seen');
  const vault = useVault();
  const lock = usePasswordVaultStore((s) => s.lock);

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.passwordVault === true;
  useEffect(() => {
    api.get('/api/settings/feature-access').then((r) => r.json()).then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); }).catch(() => {});
  }, []);

  const [draftPassword, setDraftPassword] = useState('');
  const [focusId, setFocusId] = useState(null);
  const [openErase, setOpenErase] = useState(false);

  const setTab = useCallback((id) => {
    const next = new URLSearchParams(params);
    next.delete('tour');
    if (id === 'passwords') next.delete('tab'); else next.set('tab', id);
    setParams(next);
  }, [params, setParams]);

  // Settings -> Password Vault Tour opens /password-vault?tour=1
  useEffect(() => {
    if (params.get('tour')) {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(() => startPasswordVaultTour(setTab), 300);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startTour = () => {
    try { localStorage.removeItem(VAULT_TOUR_KEY); } catch (_) { /* ignore */ }
    startPasswordVaultTour(setTab);
  };

  // The guide's "Open" buttons: switch to the tool that holds the control, exactly as clicking it in the list would.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id);
    if (!target) return;
    if (id === 'reset-vault') setOpenErase(true);
    setTab(target.tool);
  };

  const useGenerated = (password) => { setDraftPassword(password); setTab('passwords'); };
  const openEntry = (id) => { setFocusId(id); setTab('passwords'); };
  const forgot = () => { setOpenErase(true); setTab('master'); };

  const unlocked = vault.unlocked;
  const MENU = GROUPS.map((label) => ({
    label,
    tip: GROUP_TIPS[label],
    tools: VAULT_TOOLS.filter((t) => t.group === label).map((t) => ({
      ...t, tip: TOOL_TIPS[t.id], hint: NEEDS_UNLOCK.has(t.id) && !unlocked && vault.status ? (vault.status.setUp ? 'Locked: master password needed' : 'Make a master password first') : undefined,
    })),
  }));

  if (!canUse) return <Navigate to="/" replace />;

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
        <ToolSidebar
          title="Password Vault"
          icon="key-round"
          groups={MENU}
          current={tab}
          onSelect={setTab}
          onInfo={info.open}
          infoTip="How the Password Vault works, and what it does not do."
          onTour={startTour}
          tourTip="Take the guided tour of the Password Vault."
        >
          {vault.status?.setUp && (
            <div className="rounded-lg border p-2 flex items-center justify-between gap-2 text-xs" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }} data-tour="vault-status">
              <span className="inline-flex items-center gap-1.5" style={{ color: unlocked ? STATUS.good : 'var(--color-muted)' }}>
                {getIcon(unlocked ? 'lock-open' : 'lock', { size: 13 })}{unlocked ? 'Unlocked' : 'Locked'}
              </span>
              {unlocked && (
                <Tooltip text="Lock the vault now.">
                  <button type="button" onClick={lock} className="underline hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>Lock now</button>
                </Tooltip>
              )}
            </div>
          )}
        </ToolSidebar>

        <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-4 max-w-4xl" style={{ background: 'var(--color-bg)' }}>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>{TOOL_BLURBS[tab]}</p>
          {tab === 'passwords' && (
            <PasswordsTool
              vault={vault} focusId={focusId} onFocused={() => setFocusId(null)}
              draftPassword={draftPassword} onDraftUsed={() => setDraftPassword('')}
              initialClient={params.get('client') || ''} onForgot={forgot}
            />
          )}
          {tab === 'generator' && <GeneratorTool onUse={useGenerated} />}
          {tab === 'health' && <HealthTool vault={vault} onOpenEntry={openEntry} onForgot={forgot} />}
          {tab === 'master' && <MasterTool vault={vault} openErase={openErase} />}
        </div>
      </div>

      {info.show && (
        <ToolInfoModal title="How Password Vault Works" onClose={info.close}>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Keep your logins locked away, and link the ones that belong to a client so they are easy to find. Pick a tool in the list on the left; hover any tool for a plain explanation. Not sure where to start? Press the round button at the bottom right and tell the guide what you want to do. Never type a password into the guide.
          </p>
          <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            {HOW_IT_WORKS.map(([heading, text]) => (
              <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
            ))}
          </div>
        </ToolInfoModal>
      )}

      <PasswordVaultTutorChat currentTool={tab} onOpenTool={openToolById} />
    </VoiceInputProvider>
  );
}
