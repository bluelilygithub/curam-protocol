import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { useIcon } from '../providers/IconProvider';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import Tooltip from '../components/Tooltip';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import { VoiceInputProvider, VoiceInput } from '../components/voiceInput/VoiceInput';
import CaseView from './emailFollowUp/CaseView';
import EmailFollowUpTutorChat from './emailFollowUp/EmailFollowUpTutorChat';
import { HOW_IT_WORKS, GUIDE_TOOLS } from './emailFollowUp/emailFollowUpTools.mjs';
import { EF_TIPS } from './emailFollowUp/efTips.mjs';
import { startEmailFollowUpTour, TOUR_KEY as EF_TOUR_KEY } from '../utils/tours/emailFollowUpTour';

const FIELD = 'px-3 py-2.5 rounded-xl border text-sm outline-none';
const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const KINDS = [
  ['accounting', 'Accounting: chasing documents for BAS, tax or year end'],
  ['freelance', 'Freelance: scope and deliverables'],
  ['job-search', 'Job search'],
  ['other', 'Something else'],
];
const TABS = ['ledger', 'mail', 'drafts', 'coverage'];

export default function EmailFollowUpPage() {
  const getIcon = useIcon();
  const toast = useToastStore((s) => s.addToast);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin);
  const info = useToolInfoModal('vault_email_follow_up_info_seen');
  const [params, setParams] = useSearchParams();
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const [flagsLoaded, setFlagsLoaded] = useState(false);
  const [cases, setCases] = useState(null);
  const [creating, setCreating] = useState(false);
  const [clients, setClients] = useState([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [form, setForm] = useState({ title: '', obligation: '', kind: 'accounting', profile: 'soft', aliases: '', clientId: '' });
  const canUse = isAdmin || featureAccess.emailFollowUp === true;
  const openId = Number(params.get('case')) || null;
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'ledger';

  useEffect(() => {
    api.get('/api/settings/feature-access').then((r) => r.json()).then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); }).catch(() => {}).finally(() => setFlagsLoaded(true));
  }, []);

  // Settings -> Email Follow-Up Tour opens /email-follow-up?tour=1
  useEffect(() => {
    if (params.get('tour') && canUse) {
      const next = new URLSearchParams(params); next.delete('tour');
      setParams(next, { replace: true });
      setTimeout(startEmailFollowUpTour, 300);
    }
  }, [canUse]); // eslint-disable-line react-hooks/exhaustive-deps

  const startTour = () => {
    try { localStorage.removeItem(EF_TOUR_KEY); } catch (_) { /* ignore */ }
    startEmailFollowUpTour();
  };

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/email-follow-up');
      const d = await r.json();
      if (r.ok) setCases(d.cases);
    } catch { setCases([]); }
  }, []);
  useEffect(() => { if (canUse) load(); }, [canUse, load]);
  useEffect(() => {
    if (!canUse) return;
    api.get('/api/clients').then((r) => r.json()).then((d) => {
      const list = Array.isArray(d) ? d : (d.clients || []);
      setClients(list.filter((c) => c && c.id && c.name).slice(0, 300));
    }).catch(() => {}).finally(() => setClientsLoaded(true));
  }, [canUse]);

  // The CRM client page's "New case for this client" arrives as /email-follow-up?new=1&clientId=N: open the form with that client chosen.
  useEffect(() => {
    if (!canUse || !params.get('new') || !clientsLoaded) return;
    const id = Number(params.get('clientId'));
    const client = clients.find((c) => c.id === id);
    const next = new URLSearchParams(params); next.delete('new'); next.delete('clientId');
    setParams(next, { replace: true });
    setCreating(true);
    if (client) setForm((f) => ({ ...f, clientId: String(client.id), title: f.title || `${client.name}: follow-up` }));
  }, [canUse, clientsLoaded, clients, params]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canUse) return flagsLoaded ? <Navigate to="/" replace /> : null;

  // The guide's Open buttons: switch to the tab, or back to the case list. Tabs only exist inside an open case.
  const openToolById = (id) => {
    const target = GUIDE_TOOLS.find((t) => t.id === id)?.tool || id;
    if (target === 'cases') { setParams({}); return; }
    if (openId) setParams({ case: String(openId), tab: target });
    else toast('Open a case first, then I can show you that.', 'info');
  };

  const create = async () => {
    try {
      const r = await api.post('/api/email-follow-up', {
        ...form,
        aliases: form.aliases.split(',').map((x) => x.trim()).filter(Boolean),
        clientId: form.clientId ? Number(form.clientId) : null,
      });
      const d = await r.json();
      if (!r.ok) { toast(d.error || 'Could not open the case.', 'error'); return; }
      setCreating(false);
      setForm({ title: '', obligation: '', kind: 'accounting', profile: 'soft', aliases: '', clientId: '' });
      setParams({ case: String(d.case.id) });
      load();
    } catch { toast('Could not reach the server.', 'error'); }
  };

  return (
    <VoiceInputProvider lang="en-AU">
      <div className="h-full overflow-y-auto" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold flex items-center gap-2">{getIcon('list-checks', { size: 20 })} Email Follow-Up</h1>
                <Tooltip text="How Email Follow-Up works, in plain words.">
                  <button type="button" aria-label="How Email Follow-Up works" onClick={info.open} className="opacity-60 hover:opacity-100 transition-opacity" style={{ color: 'var(--color-muted)' }}>{getIcon('info', { size: 16 })}</button>
                </Tooltip>
                <Tooltip text="Take a short guided tour of this page.">
                  <button type="button" aria-label="Take the guided tour of Email Follow-Up" onClick={startTour} className="opacity-60 hover:opacity-100 transition-opacity" style={{ color: 'var(--color-muted)' }}>{getIcon('compass', { size: 16 })}</button>
                </Tooltip>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                Keeps track of what has been promised or is owed in a matter, shows the exact words it came from, and writes follow-up text for you to copy.
                It reads Gmail but never sends, files or changes anything. You open each case yourself.
              </p>
            </div>
            {!openId && (
              <Tooltip text={EF_TIPS.newCase}>
                <button type="button" onClick={() => setCreating(!creating)} data-tour="ef-new" className="shrink-0 rounded-lg px-3.5 py-1.5 text-sm font-medium hover:opacity-70 transition-opacity" style={{ background: 'var(--color-primary)', color: '#fff' }}>
                  {getIcon('plus', { size: 14 })} New case
                </button>
              </Tooltip>
            )}
          </div>

          {openId ? (
            <CaseView caseId={openId} tab={tab} onTab={(t) => setParams({ case: String(openId), tab: t })} onBack={() => { setParams({}); load(); }} />
          ) : (
            <div data-guide="cases" className="space-y-5">
              {creating && (
                <div className="rounded-2xl border p-6 space-y-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                  <h2 className="text-base font-semibold">Open a case</h2>
                  <Tooltip text={EF_TIPS.caseTitle}><div><VoiceInput value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Name it (for example: Acme Q3 BAS documents)" /></div></Tooltip>
                  <Tooltip text={EF_TIPS.caseObligation}><div><VoiceInput value={form.obligation} onChange={(v) => setForm({ ...form, obligation: v })} placeholder="What is owed? (for example: Acme owes bank statements and the Q3 ledger)" /></div></Tooltip>
                  <Tooltip text={EF_TIPS.caseAliases}>
                    <input className={`${FIELD} w-full`} style={FIELD_STYLE} aria-label="Email addresses of the people involved" placeholder="Email addresses of the people involved, comma separated" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
                  </Tooltip>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <Tooltip text={EF_TIPS.caseKind}>
                      <select className={FIELD} style={FIELD_STYLE} aria-label="Kind of matter" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                        {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </Tooltip>
                    <Tooltip text={EF_TIPS.caseProfile}>
                      <select className={FIELD} style={FIELD_STYLE} aria-label="How strictly to check" value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value })}>
                        <option value="soft">Relaxed checking</option>
                        <option value="professional">Strict checking</option>
                      </select>
                    </Tooltip>
                    <Tooltip text={EF_TIPS.caseClient}>
                      <select className={FIELD} style={FIELD_STYLE} aria-label="CRM client" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                        <option value="">No CRM client</option>
                        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </Tooltip>
                  </div>
                  <div className="flex gap-2">
                    <Tooltip text={EF_TIPS.openCase}>
                      <button type="button" onClick={create} disabled={!form.title.trim() || !form.obligation.trim()} className="rounded-lg px-3.5 py-1.5 text-sm font-medium hover:opacity-70 disabled:opacity-40 transition-opacity" style={{ background: 'var(--color-primary)', color: '#fff' }}>Open case</button>
                    </Tooltip>
                    <Tooltip text={EF_TIPS.cancelCase}>
                      <button type="button" onClick={() => setCreating(false)} className="rounded-lg px-3.5 py-1.5 text-sm border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)' }}>Cancel</button>
                    </Tooltip>
                  </div>
                </div>
              )}

              {cases === null && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
              {cases && !cases.length && !creating && (
                <div className="rounded-2xl border p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                  <p className="text-sm leading-relaxed">No cases yet. Press <strong>New case</strong>, say what is owed and by whom, then attach the email threads about it.</p>
                </div>
              )}
              <div className="space-y-3">
                {(cases || []).map((c) => (
                  <Tooltip key={c.id} text={EF_TIPS.caseCard}>
                    <button type="button" onClick={() => setParams({ case: String(c.id) })} className="w-full text-left rounded-xl border p-4 hover:opacity-70 transition-opacity" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{c.title}</span>
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{c.status}</span>
                        {c.pendingDrafts > 0 && <span className="text-xs" style={{ color: '#f59e0b' }}>{c.pendingDrafts} draft{c.pendingDrafts === 1 ? '' : 's'} waiting</span>}
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{c.clientName ? `${c.clientName} · ` : ''}{c.obligation} · {c.rowCount} in the ledger · {c.sourceCount} message{c.sourceCount === 1 ? '' : 's'}</p>
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}
        </div>

        {info.show && (
          <ToolInfoModal title="How Email Follow-Up Works" onClose={info.close}>
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              Keep track of what is owed in a matter, with the exact words it came from, and get follow-up text to copy. Not sure where to start? Press the round button at the bottom right and tell the guide what you want to do.
            </p>
            <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              {HOW_IT_WORKS.map(([heading, text]) => (
                <p key={heading} style={{ color: 'var(--color-text)' }}><strong>{heading}</strong> — {text}</p>
              ))}
            </div>
          </ToolInfoModal>
        )}

        <EmailFollowUpTutorChat currentTool={openId ? tab : 'cases'} onOpenTool={openToolById} />
      </div>
    </VoiceInputProvider>
  );
}
