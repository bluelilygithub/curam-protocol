import React, { useRef, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import { CARD, PrimaryButton, SecondaryButton, Badge, formatDate } from './shared';

// The rounds of one job, newest first. Since milestone 4b a round reads every page of the job: each round lists its pages with when and
// how each was read (plain fetch, real browser, saved copy), whether it worked, and its changes. A page's first good read is its starting
// point. A round where every page failed is replaced by the next check; a page that failed can be filled in with a saved copy.
const VIA = { plain: 'Plain fetch', browser: 'Real browser', upload: 'Saved copy' };

const real = (s) => s.total - (s.volatile || 0);
function countLine(s, since) {
  const n = real(s);
  const self = s.volatile ? ` (and ${s.volatile} that may have changed by itself)` : '';
  return n || s.volatile ? `${n} change${n === 1 ? '' : 's'} ${since}${self}` : `No changes ${since}`;
}

export default function RoundsView({ job, busy, checkAgain, uploadCopy, onShowChanges }) {
  const fileRef = useRef(null);
  const [uploadFor, setUploadFor] = useState(null); // the page a chosen file is for
  const pages = job.pages || [];
  const pageName = (id) => { const i = pages.findIndex((p) => p.id === id); return i < 0 ? 'A removed page' : (pages[i].label || `Page ${i + 1}`); };
  const pageUrl = (id) => pages.find((p) => p.id === id)?.url;
  const numbers = [...new Set(job.rounds.map((r) => r.number))].sort((a, b) => b - a);
  const rowsOf = (n) => job.rounds.filter((r) => r.number === n).sort((a, b) => pages.findIndex((p) => p.id === a.pageId) - pages.findIndex((p) => p.id === b.pageId));
  const viaOf = (pageId, n) => job.rounds.find((x) => x.pageId === pageId && x.number === n)?.fetchedVia;
  const firstRead = (pageId) => Math.min(...job.rounds.filter((x) => x.pageId === pageId && x.status === 'ready').map((x) => x.number));
  const pick = (pageId) => { setUploadFor(pageId); fileRef.current?.click(); };
  const multi = pages.length > 1;

  return (
    <section className="rounded-2xl border p-6 space-y-4" style={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Rounds ({numbers.length}){multi ? ` · ${pages.length} pages` : ''}</h2>
        <div className="flex flex-wrap gap-2">
          {!multi && <SecondaryButton tip="For a staging site, a page behind a login, or one that refuses to be fetched: open it in your browser, save it with File > Save Page As (Webpage, HTML only), then choose the file here." disabled={busy} onClick={() => pick(pages[0]?.id)}>Upload a saved copy</SecondaryButton>}
          <span data-guide="check-again"><PrimaryButton tip={multi ? `Read all ${pages.length} pages again now and keep them as the next round. Pages are read one after another, so this can take a minute.` : 'Read the page again now and keep it as the next round. A real browser is used if the plain copy has almost no text.'} disabled={busy} onClick={checkAgain}>Check again</PrimaryButton></span>
          <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="hidden" aria-label="Saved copy of the page"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadCopy(f, uploadFor); }} />
        </div>
      </div>
      {numbers.length === 0 && <EmptyState icon="history" title="No rounds yet" body="Press Check again to read the pages as their starting point, or upload a saved copy." />}
      <ol className="space-y-3">
        {numbers.map((n) => (
          <li key={n} className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{n === 0 ? 'Round 0: the starting point' : `Round ${n}`}</span>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{formatDate(rowsOf(n)[0]?.fetchedAt)}</span>
              {n > 0 && rowsOf(n).some((r) => r.sincePrevious) && <SecondaryButton tip="Show what changed in this round, word by word, page by page." onClick={() => onShowChanges(n, null)}>Show changes</SecondaryButton>}
            </div>
            <ul className="space-y-2">
              {rowsOf(n).map((r) => (
                <li key={r.id} className={multi ? 'rounded-lg border p-3 space-y-1' : 'space-y-1'} style={multi ? { borderColor: r.status === 'failed' ? '#fca5a5' : 'var(--color-border)' } : undefined}>
                  <div className="flex flex-wrap items-center gap-2">
                    {multi && <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{pageName(r.pageId)}</span>}
                    <Badge>{VIA[r.fetchedVia] || r.fetchedVia}</Badge>
                    {multi && r.status === 'ready' && firstRead(r.pageId) === n && n > 0 && <Badge>This page&apos;s starting point</Badge>}
                    {multi && r.sincePrevious && <SecondaryButton tip="Show this page's changes in this round." onClick={() => onShowChanges(n, r.pageId)}>Show</SecondaryButton>}
                    {multi && r.status === 'failed' && <SecondaryButton tip="This page could not be read. Save it from your browser (File > Save Page As, Webpage HTML only) and choose the file: it takes this page's place in this round." disabled={busy} onClick={() => pick(r.pageId)}>Upload a saved copy</SecondaryButton>}
                  </div>
                  {r.status === 'failed'
                    ? <p className="text-sm" style={{ color: '#991b1b' }}>Failed: {r.error}</p>
                    : <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{r.title ? `"${r.title}" · ` : ''}{(r.words || 0).toLocaleString('en-AU')} words in {r.blocks} blocks</p>}
                  {r.finalUrl && r.finalUrl !== pageUrl(r.pageId) && <p className="text-xs break-all" style={{ color: 'var(--color-muted)' }}>Read from {r.finalUrl}</p>}
                  {r.sincePrevious && (
                    <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                      {countLine(r.sincePrevious, r.previousNumber === firstRead(r.pageId) ? 'since the starting point' : `since round ${r.previousNumber}`)}
                      {r.previousNumber !== firstRead(r.pageId) && r.sinceBaseline ? `; ${real(r.sinceBaseline)} since the starting point` : ''}
                    </p>
                  )}
                  {r.sincePrevious && viaOf(r.pageId, r.previousNumber) && viaOf(r.pageId, r.previousNumber) !== r.fetchedVia && (
                    <p className="text-xs" style={{ color: '#b45309' }}>Read differently from round {r.previousNumber} ({VIA[viaOf(r.pageId, r.previousNumber)]}), so some differences may come from that, not from edits.</p>
                  )}
                  {r.fetchNote?.lessText && (
                    <p className="text-xs" style={{ color: '#b45309' }}>
                      Far less text than the starting point ({r.fetchNote.lessText.got.toLocaleString('en-AU')} words against {r.fetchNote.lessText.expected.toLocaleString('en-AU')}){r.fetchNote.retriedInBrowser ? ', even in a real browser' : ''}. The site may have been rebuilt or be blocking the check: check the page yourself before trusting the removals.
                    </p>
                  )}
                  {r.fetchNote?.retriedInBrowser && !r.fetchNote.lessText && (
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>A plain fetch found far less text than the starting point, so this page was read in a real browser.</p>
                  )}
                  {r.sincePrevious?.rough && <p className="text-xs" style={{ color: '#b45309' }}>So much changed that the changes were lined up roughly.</p>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>An unchanged page is still kept, so a check that found nothing done is on record. A round where every page failed is replaced by the next check. Each page is read the same way as its starting point where possible, so the way of reading does not show up as changes.</p>
    </section>
  );
}
