import React from 'react';
import { useNavigate } from 'react-router-dom';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Settings and Admin guide. The chat itself is the shared component (components/tutor/TutorChat.jsx); this file only supplies the
 * wording and what each Open button does. It cannot see any setting, key, password or user. Settings section ids are the page's own
 * (utils/settingsGroups.mjs); ids starting `admin-` are parts of the Admin page.
 *
 * On /settings pass `onOpenSection(id)` (the page's own tab switch). Anywhere else the chat remembers the section and goes to /settings
 * (Settings reads `settingsTab` when it opens); an `admin-` id goes to /admin.
 */

const CONFIG = {
  endpoint: '/api/settings-tutor',
  guideId: 'settings',
  payloadKey: 'currentTool',
  name: 'Settings guide',
  shortName: 'guide',
  subtitle: 'Find the setting you need',
  intro: 'Tell me what you want to change or check, in your own words: the look of Vault, the AI model, who can use what, a new user, backups. I will point you to the right section. I cannot see any setting, key or password. Many sections are for the admin only.',
  starters: [
    'How do I add a new user?',
    'How do I stop one member seeing Finance?',
    'Where do I change the default AI model?',
    'How do I get back something I deleted?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not a setting yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Settings', color: null },
  },
  buttonTip: 'Ask the Settings guide where to find a setting or an admin tool. It cannot see any setting, key or user.',
  openTip: (label) => `Take me to ${label}. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Settings…',
  placeholder: 'Type or tap the mic: what do you want to change? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Settings guide',
  errorText: 'The Settings guide could not answer just now.',
  wideKey: 'vault:settings-guide:wide',
};

export default function SettingsTutorChat({ currentTab, onOpenSection }) {
  const navigate = useNavigate();
  const open = (id) => {
    if (String(id).startsWith('admin-')) { navigate('/admin'); return; }
    if (onOpenSection) { onOpenSection(id); return; }
    try { localStorage.setItem('settingsTab', id); } catch { /* private window: opens on the usual section */ }
    navigate('/settings');
  };
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTab} onOpen={open} />
    </VoiceInputProvider>
  );
}
