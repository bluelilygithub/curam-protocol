import React from 'react';
import Dialog from './Dialog';

const SHORTCUTS = [
  { keys: ['⌘', 'K'], desc: 'Open search' },
  { keys: ['⌘', 'N'], desc: 'New chat' },
  { keys: ['⌘', 'B'], desc: 'Toggle sidebar' },
  { keys: ['⌘', '/'], desc: 'Keyboard shortcuts' },
  { keys: ['Enter'], desc: 'Send message' },
  { keys: ['Shift', 'Enter'], desc: 'New line in message' },
  { keys: ['Esc'], desc: 'Close modal / cancel' },
];

function KeyboardShortcutsModal({ onClose }) {
  return (
    <Dialog title="Keyboard Shortcuts" size="sm" onClose={onClose}>
        <div className="space-y-3">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{s.desc}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((k, j) => (
                  <kbd
                    key={j}
                    className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-mono border"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', minWidth: '24px' }}
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Leaving a chat without a reply</p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            Nothing is sent until you press <kbd className="font-mono">Enter</kbd> (or Send), so you can walk away from a chat at any
            time — open another with <kbd className="font-mono">⌘</kbd> <kbd className="font-mono">N</kbd> or just navigate elsewhere,
            and no reply is requested. If a reply is already on its way, the Stop button cancels it.
          </p>
        </div>
    </Dialog>
  );
}

export default KeyboardShortcutsModal;
