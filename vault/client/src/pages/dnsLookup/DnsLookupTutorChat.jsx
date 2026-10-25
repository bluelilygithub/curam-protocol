import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The DNS Lookup guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video
 * Tools, Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` scrolls the page to the
 * box that holds the control (see dnsLookupTools.mjs). It cannot see any name or answer: it only knows what each control does.
 */

const CONFIG = {
  endpoint: '/api/dns-lookup-tutor',
  guideId: 'dns-lookup',
  payloadKey: 'currentTool',
  name: 'DNS Lookup guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to find out',
  intro: 'Hi! Tell me what you want to know, in your own words: where a website points, whether a DNS change has spread, or whether your email records look right. I will check what DNS Lookup can do and give you the steps. If something is missing, I will say so. I cannot see the names you type or the answers.',
  starters: [
    'Has my DNS change spread yet?',
    'Is my domain set up to receive email?',
    'Where does this website point?',
    'What is an MX or TXT record?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in DNS Lookup yet', color: '#f59e0b' },
    beyond: { label: 'Beyond DNS Lookup', color: null },
  },
  buttonTip: 'Ask the DNS Lookup guide. Tell it what you want to find out, by typing or talking, and it tells you which controls to use and in what order. It cannot see the names you type or the answers.',
  openTip: (label) => `Show ${label} in DNS Lookup. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking DNS Lookup…',
  placeholder: 'Type or tap the mic: what do you want to find out? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the DNS Lookup guide',
  errorText: 'The DNS Lookup guide could not answer just now.',
  wideKey: 'vault:dns-lookup-guide:wide',
};

export default function DnsLookupTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
