import React, { useRef } from 'react';
import EmptyState from '../../components/EmptyState';
import { CARD, PrimaryButton, SecondaryButton, Badge, formatDate } from './shared';

// The rounds of one job, newest first: when, how (plain fetch, real browser, saved copy) and whether it worked. Round 0 is the starting
// point every later round is compared with (milestone 3). A failed round keeps its reason until the next check replaces it.
const VIA = { plain: 'Plain fetch', browser: 'Real browser', upload: 'Saved copy' };

const real = (s) => s.total - (s.volatile || 0);
function countLine(s, since) {
  const n = real(s);
  const self = s.volatile ? ` (and ${s.volatile} that may have changed by itself)` : '';
  return n || s.volatile ? `${n} change${n === 1 ? '' : 's'} ${since}${self}` : `No changes ${since}`;
}

export default function RoundsView({ job, busy, checkAgain, uploadCopy, onShowChanges }) {
  const fileRef = useRef(null);
  const rounds = [...job.rounds].reverse();
  const viaOf = (n) => job.rounds.find((x) => x.number === n)?.fetchedVia;
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
            {r.sincePrevious && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                  {countLine(r.sincePrevious, r.previousNumber === 0 ? 'since the starting point' : `since round ${r.previousNumber}`)}
                  {r.previousNumber !== 0 && r.sinceBaseline ? `; ${real(r.sinceBaseline)} since the starting point` : ''}
                </p>
                <SecondaryButton tip="Show what changed in this round, word by word." onClick={() => onShowChanges(r.number)}>Show changes</SecondaryButton>
              </div>
            )}
            {r.sincePrevious && viaOf(r.previousNumber) && viaOf(r.previousNumber) !== r.fetchedVia && (
              <p className="text-xs" style={{ color: '#b45309' }}>Read differently from round {r.previousNumber} ({VIA[viaOf(r.previousNumber)]}), so some differences may come from that, not from edits.</p>
            )}
          </li>
        ))}
      </ol>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>An unchanged page is still kept as a round, so a check that found nothing done is on record. A failed round is replaced by the next check. Later rounds are read the same way as the starting point where possible, so the way of reading does not show up as changes.</p>
    </section>
  );
}
