// The steps shown in the progress window while a page is loaded or scraped. The server answers once at the end, so the steps move on a
// timer (the shared runWithStepLog) and all finish when the answer arrives; they describe what is really being done, in order.
// Test: node client/src/utils/scrapeProgress.test.mjs

/** What was asked for -> the words in the window. kind: 'load' (CSS tool), 'css' (Download a page's CSS), 'exact' (Web Extractor Exact scrape). */
export function scrapeProgress(kind, { render = false, url = '' } = {}) {
  let host = '';
  try { host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { /* no address yet: no name to show */ }
  const of = host ? ` from ${host}` : '';
  const open = render
    ? ['Opening the page in a browser', 'Waiting for the page to build itself']
    : ['Asking the website for the page'];
  const title = {
    load: `Loading the page${of}…`,
    css: `Reading the page's style files${of}…`,
    exact: `Copying the page${of}…`,
  }[kind] || 'Reading the page…';
  const rest = {
    load: ['Finding its style files', 'Fetching the style files', 'Cleaning the page so it is safe to show', 'Building the preview'],
    css: ['Finding the style files it links to', 'Following their imports', 'Making every address complete', 'Summarising colours, fonts and sizes'],
    exact: ['Finding its style files', 'Fetching the style files', 'Copying the pictures in', 'Putting the copy together'],
  }[kind] || [];
  const detail = {
    load: 'Some websites are slow or turn away automatic visitors, so the tool may try a few different ways. Please do not navigate away.',
    css: 'Some websites are slow or turn away automatic visitors, so the tool may try a few different ways. Please do not navigate away.',
    exact: 'Pictures are copied in so the copy stands on its own. Big pages can take a while. Please do not navigate away.',
  }[kind] || 'Please do not navigate away.';
  return { title, detail, steps: [...open, ...rest] };
}

/** True when a failure is the person pressing Cancel rather than something going wrong. */
export function wasCancelled(err) {
  return !!err && (err.name === 'AbortError' || /aborted/i.test(String(err.message)));
}
