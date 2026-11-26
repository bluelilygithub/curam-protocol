'use strict';

// HTML Content Check limits (docs/html-content-check.md). A page over a limit fails its round with a plain message; nothing is ever cut,
// because cut text would look removed.
module.exports = {
  MAX_SNAPSHOT_CHARS: 500000, // extracted text per round (owner, 2026-11-26)
  MAX_FETCH_BYTES: 5 * 1024 * 1024, // the page's HTML, as DocCompare
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024, // a saved copy
  FETCH_TIMEOUT_MS: 10000, // silence
  FETCH_TOTAL_MS: 20000, // in all
  USER_AGENT: 'Mozilla/5.0 (compatible; CuramVault-ContentCheck/1.0; checks a page the user asked for)',
};
