import { FETCHED_TYPE, FETCH_TYPE } from '@vault-client/pages/docCompare/docCompareTools.mjs';
import { decodeHtml, htmlReader } from '../readers/html';
import type { NormalizedDoc } from '../readers/types';

/**
 * "Fetch a web page" (inside Vault only). The app never makes a network request itself: it posts the typed address, and nothing else,
 * to Vault's page around it, which calls POST /api/doc-compare/fetch (server/routes/docCompareFetch.js) and posts the page's bytes
 * back. The page is kept as a dated snapshot file, exactly like a page saved with File > Save Page As, and read by the HTML reader.
 * The standalone build has no Vault page around it, so it has no URL option (canFetchPages is false).
 */

export const canFetchPages = () => typeof window !== 'undefined' && window.parent !== window;

/** What people type: "example.com/page" means https. Returns a normalised http(s) address or throws a message to show. */
export function normaliseUrl(raw: string): string {
  const text = raw.trim();
  if (!text) throw new Error('Type or paste the address of a web page.');
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`); } catch { throw new Error(`"${text}" is not a web address.`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only web addresses (http or https) can be fetched.');
  return u.toString();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The fetched page as a snapshot file: UTF-8, with the browser's "saved from url" comment recording where and a charset line first. */
export function snapshotFile(bytes: Uint8Array, contentType: string, finalUrl: string, at = new Date()): File {
  const label = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  let html: string;
  try { html = label ? new TextDecoder(label).decode(bytes) : decodeHtml(bytes); } catch { html = decodeHtml(bytes); }
  html = html.replace(/^﻿/, '');
  // written first, so the page's own (now wrong) charset declaration further down is ignored when the snapshot is read
  const head = `<!-- saved from url=(${String(finalUrl.length).padStart(4, '0')})${finalUrl} -->\n<meta charset="utf-8">\n`;
  const u = new URL(finalUrl);
  const where = `${u.hostname}${u.pathname}`.replace(/\/+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 80);
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}${pad(at.getMinutes())}`;
  return new File([head + html], `${where}_${stamp}.html`, { type: 'text/html', lastModified: at.getTime() });
}

export interface FetchedPage { file: File; doc: NormalizedDoc; url: string }

/**
 * Asks Vault's page to fetch `rawUrl`, then reads the snapshot. Rejects with a message to show: the server's (not allowed, not a web page,
 * timed out …) or the reader's (almost no text: built with JavaScript, upload a saved copy instead).
 */
export function requestPage(rawUrl: string, { target = window.parent, timeoutMs = 45000, now = () => new Date() }: { target?: Pick<Window, 'postMessage'>; timeoutMs?: number; now?: () => Date } = {}): Promise<FetchedPage> {
  let url: string;
  try { url = normaliseUrl(rawUrl); } catch (e) { return Promise.reject(e); }
  const id = crypto.randomUUID();
  return new Promise<FetchedPage>((resolve, reject) => {
    const done = () => { window.removeEventListener('message', onMessage); clearTimeout(timer); };
    const timer = setTimeout(() => { done(); reject(new Error('Vault did not answer in time. Check your connection and try again.')); }, timeoutMs);
    async function onMessage(ev: MessageEvent) {
      const d = ev.data as { type?: string; id?: string; ok?: boolean; bytes?: ArrayBuffer; finalUrl?: string; contentType?: string; error?: string } | null;
      if (ev.origin !== window.location.origin || d?.type !== FETCHED_TYPE || d.id !== id) return;
      done();
      if (!d.ok || !d.bytes) { reject(new Error(d.error || 'The page could not be fetched.')); return; }
      try {
        const file = snapshotFile(new Uint8Array(d.bytes), d.contentType ?? '', d.finalUrl || url, now());
        const doc = await htmlReader.read(file); // almost no text: a GateError saying to upload a saved copy instead
        resolve({ file, doc, url: d.finalUrl || url });
      } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
    }
    window.addEventListener('message', onMessage);
    // the only thing that leaves the app: the address, to Vault's own page in this tab
    target.postMessage({ type: FETCH_TYPE, id, url }, window.location.origin);
  });
}
