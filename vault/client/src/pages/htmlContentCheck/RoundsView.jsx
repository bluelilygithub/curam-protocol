import React, { useRef } from 'react';
import EmptyState from '../../components/EmptyState';
import { CARD, PrimaryButton, SecondaryButton, Badge, formatDate } from './shared';

// The rounds of one job, newest first: when, how (plain fetch, real browser, saved copy) and whether it worked. Round 0 is the starting
// point every later round is compared with (milestone 3). A failed round keeps its reason until the next check replaces it.
const VIA = { plain: 'Plain fetch', browser: 'Real browser', upload: 'Saved copy' };

export default function RoundsView({ job, busy, checkAgain, uploadCopy }) {
  const fileRef = useRef(null);
  const rounds = [...job.rounds].reverse();
  return (
    <section className="rounded-2xl border p-6 space-y-4" style={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Rounds ({job.rounds.length})</h2>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton tip="For a staging site, a page behind a login, or one that refuses to be fetched: open it in your browser, save it with File > Save Page As (Webpage, HTML only), then choose the file here." disabled={busy} onClick={() => fileRef.current?.click()}>Upload a saved copy</SecondaryButton>
          <PrimaryButton tip={job.fetchMode === 'browser' ? 'Load the page again in a real browser and keep it as the next round.' : 'Fetch the page again and keep it as the next round. A real browser is used if the plain copy has almost no text.'} disabled={busy} onClick={checkAgain}>Check again</PrimaryButton>
          <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="hidden" aria-label="Saved copy of the page"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadCopy(f); }} />
        </div>
      </div>
      {rounds.length === 0 && <EmptyState icon="history" title="No rounds yet" body="Press Check again to fetch the page as its starting point, or upload a saved copy." />}
      <ol className="space-y-2">
        {rounds.map((r) => (
          <li key={r.id} className="rounded-xl border p-4 space-y-1.5" style={{ borderColor: r.status === 'failed' ? '#fca5a5' : 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{r.number === 0 ? 'Round 0: the starting point' : `Round ${r.number}`}</span>
              <Badge>{VIA[r.fetchedVia] || r.fetchedVia}</Badge>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{formatDate(r.fetchedAt)}</span>
            </div>
            {r.status === 'failed'
              ? <p className="text-sm" style={{ color: '#991b1b' }}>Failed: {r.error}</p>
              : <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{r.title ? `"${r.title}" · ` : ''}{(r.words || 0).toLocaleString('en-AU')} words in {r.blocks} blocks</p>}
            {r.finalUrl && r.finalUrl !== job.url && <p className="text-xs break-all" style={{ color: 'var(--color-muted)' }}>Read from {r.finalUrl}</p>}
          </li>
        ))}
      </ol>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>An unchanged page is still kept as a round, so a check that found nothing done is on record. A failed round is replaced by the next check. What changed between rounds is shown in the next update.</p>
    </section>
  );
}
