import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The PDF Tools guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by Video Tools and
 * Finance); this file only supplies PDF Tools' wording and endpoint. `onOpenTool(id)` opens a tool in the page. It cannot see
 * your files: it only knows what each tool does. The PDF page has no microphone provider of its own, so this wrapper supplies one.
 */

const CONFIG = {
  endpoint: '/api/pdf-tutor',
  payloadKey: 'currentTool',
  name: 'PDF guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to do with your PDF',
  intro: 'Hi! Tell me what you want to do with your PDF, in your own words. I will check the tools we have and give you the steps in order. If a tool is missing, or the job is outside PDF Tools, I will say so. I cannot see your files.',
  starters: [
    'Make a scanned PDF searchable',
    'Join three PDFs and add page numbers',
    'Make a PDF smaller to email',
    'Put my signature on a contract',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'A tool is missing', color: '#f59e0b' },
    beyond: { label: 'Beyond PDF Tools', color: null },
  },
  buttonTip: 'Ask the PDF guide. Tell it what you want to do with your PDF, by typing or talking, and it tells you which tools to use and in what order. It cannot see your files.',
  openTip: (label) => `Open ${label} in the PDF Tools list. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking the tools…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the PDF guide',
  errorText: 'The PDF guide could not answer just now.',
  wideKey: 'vault:pdf-guide:wide',
};

export default function PdfTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
