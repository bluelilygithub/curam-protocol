import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Password Vault guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video
 * Tools, Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` switches the page to the tool
 * that holds the control (see passwordVaultTools.mjs). It cannot see any password, title or client name: it only knows what each control
 * does, and it asks people not to type a password into it.
 */

const CONFIG = {
  endpoint: '/api/password-vault-tutor',
  guideId: 'password-vault',
  payloadKey: 'currentTool',
  name: 'Password Vault guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to do with your logins',
  intro: 'Hi! Tell me what you want to do, in your own words: save a login for a client, make a strong password, find one, or sort out a forgotten master password. I will check what the Password Vault can do and give you the steps. If something is missing, I will say so. I cannot see your passwords, and please do not type one here.',
  starters: [
    'How do I save a login for a client?',
    'Make me a strong password',
    'A site will not accept symbols. What do I do?',
    'I forgot my master password',
    'Which of my passwords are weak?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in the Password Vault yet', color: '#f59e0b' },
    beyond: { label: 'Beyond the Password Vault', color: null },
  },
  buttonTip: 'Ask the Password Vault guide. Tell it what you want to do, by typing or talking, and it tells you which controls to use and in what order. It cannot see your passwords, and you should never type one into it.',
  openTip: (label) => `Show ${label} in the Password Vault. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking the Password Vault…',
  placeholder: 'Type or tap the mic: what do you want to do? Never type a password here. (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Password Vault guide',
  errorText: 'The Password Vault guide could not answer just now.',
  wideKey: 'vault:password-vault-guide:wide',
};

export default function PasswordVaultTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
