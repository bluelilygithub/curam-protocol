'use strict';

// SERP Tracker: reading a search more than once. Idea taken from OpenSEO (open-seo, MIT, read 7 Nov 2026): Google sometimes serves a scraper a
// results page that looks normal but leaves out sites that really rank, and nothing in the answer says so. Our own tests agreed: the same search for
// the same site was found at #1, at #2 and not found on different reads. So:
//   - a read that FINDS the site is trusted (a page cannot invent a ranking the site does not have);
//   - a read that MISSES it is not: read again, up to a limit, and say "not found" only when every read missed;
//   - the best position wins.
// Pure: no database, no network. `parsed` is the result of serpParse.parseSerp (`mine` is null when no site was given).

const isFound = (parsed) => Boolean(parsed && parsed.mine && parsed.mine.status === 'ranked');
const positionOf = (parsed) => (isFound(parsed) ? parsed.mine.bestPosition : null);

/** The short record kept for each read: where the site was (null = not found) and how many ordinary results the read had. */
function readRecord(parsed) {
  return { position: positionOf(parsed), organic: parsed ? Number(parsed.organicCount) || 0 : 0 };
}

/** True when `candidate` should replace `current` as the read that is kept: a found read beats a miss, the better position beats a worse one, and between equals the fuller answer wins. */
function betterRead(candidate, current) {
  if (!current) return true;
  const a = positionOf(candidate);
  const b = positionOf(current);
  if (a != null && b == null) return true;
  if (a == null && b != null) return false;
  if (a != null && b != null && a !== b) return a < b;
  return (Number(candidate.organicCount) || 0) > (Number(current.organicCount) || 0);
}

/** Make another read? Only when there is a site to look for, none of the reads has found it yet, and the limit is not reached. */
function needsAnotherRead({ hasSite, reads, maxReads }) {
  if (!hasSite) return false;
  if (reads.some((r) => r.position != null)) return false;
  return reads.length < maxReads;
}

/** { total, found, best, firm, text } for the page. `firm` is true for a "not found" that every one of several reads agreed on. */
function summariseReads(reads) {
  const list = Array.isArray(reads) ? reads : [];
  const found = list.filter((r) => r.position != null);
  const best = found.length ? Math.min(...found.map((r) => r.position)) : null;
  const total = list.length;
  let text = '';
  if (total > 1) {
    text = found.length
      ? `Read ${total} times: found on ${found.length}, best position #${best}.`
      : `Read ${total} times: not found on any of them.`;
  }
  return { total, found: found.length, best, firm: total > 1 && found.length === 0, text };
}

module.exports = { isFound, positionOf, readRecord, betterRead, needsAnotherRead, summariseReads };
