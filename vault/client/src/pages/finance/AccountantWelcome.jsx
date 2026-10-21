import React, { useEffect } from 'react';
import { useIcon } from '../../providers/IconProvider';

export const ACCOUNTANT_WELCOME_SEEN_KEY = 'vault_finance_accountant_welcome_seen';

// Each card jumps straight to a real Finance tab (`tab` must be one of FinancePage's TABS).
const GUIDE = [
  { emoji: '📦', title: 'Everything for the year in one go', tab: 'Reports',
    text: 'Reports, then Export FY pack: the whole financial year as a PDF, an Excel workbook and a zip, ready to file.' },
  { emoji: '🔍', title: 'What needs a second look', tab: 'Reports',
    text: 'The Things to Review report lists entries that may need your judgement before you sign off.' },
  { emoji: '🧾', title: 'Receipts and statements', tab: 'Documents',
    text: 'Every receipt, bank statement and invoice the owner has kept, linked to the entries they support.' },
  { emoji: '🗂️', title: 'Your account and tax codes', tab: 'Accounts',
    text: 'The chart of accounts, with your own labels mapped on. The Codes tab shows the income and expense codes.' },
  { emoji: '🏛️', title: 'GST and BAS', tab: 'BAS',
    text: 'Each quarter from open to paid, with the BAS worksheet figures (G1 to G14, T7, W2) behind it.' },
  { emoji: '📒', title: 'The journal itself', tab: 'Journal',
    text: 'Every double-entry posting, in date order. Balanced by construction: an unbalanced entry cannot be saved.' },
  { emoji: '🕵️', title: 'Who changed what', tab: 'Reports',
    text: 'The Audit Trail report shows every change made to the books: what, when and the old and new values.' },
];

export default function AccountantWelcome({ onClose, onOpenTab, ownerEmail }) {
  const getIcon = useIcon();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const go = (tab) => { onOpenTab(tab); onClose(); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-2xl max-h-[92dvh] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
        role="dialog"
        aria-label="Welcome, accountant"
      >
        <div
          className="px-6 pt-6 pb-5 relative"
          style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
        >
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
          >
            {getIcon('x', { size: 16 })}
          </button>
          <div className="text-3xl mb-2">👋</div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Welcome to the books</h2>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            You have a read-only view of this business's Finance. Here is where to find what you usually need. Pick a card to jump straight there.
          </p>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-5">
          <div className="grid sm:grid-cols-2 gap-3">
            {GUIDE.map((g) => (
              <button
                key={g.title}
                type="button"
                onClick={() => go(g.tab)}
                className="text-left rounded-xl border p-4 hover:opacity-70 transition-opacity"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{g.emoji}</span>
                  <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{g.title}</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{g.text}</p>
                <span className="inline-block mt-2 text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
                  Open {g.tab} →
                </span>
              </button>
            ))}
          </div>

          <div
            className="rounded-xl border p-4 space-y-2"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Good to know</div>
            <ul className="text-xs leading-relaxed space-y-1 list-disc pl-4" style={{ color: 'var(--color-muted)' }}>
              <li><strong style={{ color: 'var(--color-text)' }}>Read-only.</strong> You can look at everything in Finance and download exports, but nothing can be added, changed or deleted. Save and Delete buttons will be refused.</li>
              <li><strong style={{ color: 'var(--color-text)' }}>Activity is recorded.</strong> Your sign-ins, the pages you open and the files you download are logged for the owner, as is any action that was refused.</li>
              <li><strong style={{ color: 'var(--color-text)' }}>Need a change made?</strong> Ask the owner and they will make it. Everything they change goes into the Audit Trail.</li>
              <li><strong style={{ color: 'var(--color-text)' }}>Come back any time.</strong> The "Accountant guide" button at the top of the page opens this again.</li>
            </ul>
          </div>
        </div>

        <div
          className="flex items-center justify-between gap-2 px-6 py-4 border-t flex-wrap"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {ownerEmail ? (
            <a
              href={`mailto:${ownerEmail}?subject=${encodeURIComponent('Finance: question from your accountant')}`}
              className="text-sm hover:opacity-70 transition-opacity"
              style={{ color: 'var(--color-primary)' }}
            >
              ✉️ Email the owner
            </a>
          ) : <span />}
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-80 transition-opacity"
            style={{ background: 'var(--color-primary)' }}
          >
            Start looking around
          </button>
        </div>
      </div>
    </div>
  );
}
