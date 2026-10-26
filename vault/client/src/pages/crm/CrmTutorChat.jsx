import React from 'react';
import { useNavigate } from 'react-router-dom';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';
import useToastStore from '../../store/toastStore';
import { byId } from './crmGuideTools.mjs';

/**
 * The CRM guide. The chat itself is the shared component (components/tutor/TutorChat.jsx); this file only supplies the wording and
 * what each Open button does. It sits on the client list, a client's page and the Pipeline page. It cannot see any client, deal or
 * note. `where` is the page it is on ('list' | 'detail' | 'pipeline'); `onSection(key)` opens a section on a client's page and
 * `onNewClient()` opens the New client form on the list.
 */

const CONFIG = {
  endpoint: '/api/crm-tutor',
  guideId: 'crm',
  payloadKey: 'currentTool',
  name: 'CRM guide',
  shortName: 'guide',
  subtitle: 'Where to do things with your clients',
  intro: 'Tell me what you want to do with your clients, in your own words: log a call, set a follow-up, track a deal, link a project. I will point you to the right place and say so plainly if the CRM cannot do it. I cannot see your clients or notes.',
  starters: [
    'How do I log a phone call with a client?',
    'How do I remind myself to follow up?',
    'Where can I see all my open deals?',
    'How do I link a project to a client?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in the CRM yet', color: '#f59e0b' },
    beyond: { label: 'Beyond the CRM', color: null },
  },
  buttonTip: 'Ask the CRM guide where to do something with your clients. It cannot see your clients, deals or notes.',
  openTip: (label) => `Take me to ${label}. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking the CRM…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the CRM guide',
  errorText: 'The CRM guide could not answer just now.',
  wideKey: 'vault:crm-guide:wide',
};

export default function CrmTutorChat({ where, currentTool, onSection, onNewClient }) {
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);

  const open = (id) => {
    const t = byId(id);
    if (!t) return;
    if (t.where === 'pipeline') { navigate('/pipeline'); return; }
    if (t.where === 'list') {
      if (where !== 'list') { navigate('/clients'); return; }
      if (id === 'new-client' && onNewClient) onNewClient();
      return;
    }
    // a section of a client's page: only possible once a client is open
    if (where === 'detail' && onSection) onSection(t.section);
    else addToast('Open a client from the CRM list first, then press this again.', 'info');
  };

  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={open} />
    </VoiceInputProvider>
  );
}
