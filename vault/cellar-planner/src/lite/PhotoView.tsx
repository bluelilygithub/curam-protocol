import { useEffect, useRef, useState } from 'react';
import { buildScene, type SceneInput } from './cellarScene';
import { makeRenderImage } from './thumbnail';
import type { FinishKey } from './finishes';
import type { DoorStyle } from './settings';
import { apiBase } from './config';

// The "Photo" tab: asks Vault to turn the planner's own 3D picture into a photo-style image (an AI image model), on request. It never starts by
// itself (each photo costs money), says plainly that it is an artist's impression, and explains every refusal in words. Photos already made for this
// design and finish are remembered for the visit, so coming back to the tab costs nothing. The limits and the on/off switch are Vault's business.

const MEMORY_KEY = 'cellar-lite:photos:v1';
const TIMEOUT_MS = 110 * 1000;

type Made = { key: string; url: string };
const readMemory = (): Record<string, Made> => { try { const r = JSON.parse(sessionStorage.getItem(MEMORY_KEY) || '{}') as Record<string, Made>; return r && typeof r === 'object' ? r : {}; } catch { return {}; } };
const writeMemory = (k: string, m: Made): void => { try { const all = readMemory(); all[k] = m; const keys = Object.keys(all); while (keys.length > 8) delete all[keys.shift() as string]; sessionStorage.setItem(MEMORY_KEY, JSON.stringify(all)); } catch { /* fine */ } };

/** What each refusal means to the visitor, in plain words (the server also sends its own sentence; these are the fallbacks). */
export function photoMessage(status: number, code: string | undefined, fromServer: string | undefined): string {
  if (fromServer && typeof fromServer === 'string' && fromServer.length < 200) return fromServer;
  if (code === 'off' || status === 403) return 'The photo view is not available right now.';
  if (status === 429) return 'We have made a lot of photos for now. Please try again a little later.';
  return 'We could not make your photo this time. Please try again in a moment.';
}

export function PhotoView({ input, finish, doorStyle, code, canMake, onMade }: { input: Omit<SceneInput, 'yawDeg' | 'dims'>; finish: FinishKey; doorStyle: DoorStyle; code: string; canMake: boolean; onMade?: () => void }) {
  const designKey = `${code}|${finish}`;
  const [phase, setPhase] = useState<'idle' | 'working' | 'error'>('idle');
  const [made, setMade] = useState<(Made & { forKey: string }) | null>(() => { const m = readMemory()[designKey]; return m ? { ...m, forKey: designKey } : null; });
  const [error, setError] = useState('');
  const [imgOk, setImgOk] = useState(true);
  const abort = useRef<AbortController | null>(null);

  // a photo already made for this exact design and finish is shown again straight away
  useEffect(() => {
    const m = readMemory()[designKey];
    if (m && made?.forKey !== designKey) setMade({ ...m, forKey: designKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designKey]);
  useEffect(() => () => abort.current?.abort(), []);

  const make = async (): Promise<void> => {
    if (phase === 'working') return;
    setPhase('working'); setError(''); setImgOk(true);
    const ctl = new AbortController();
    abort.current = ctl;
    const timer = window.setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const image = makeRenderImage(buildScene({ ...input, yawDeg: 0 }), finish);
      const res = await fetch(`${apiBase()}/api/cellar-lite/photo`, {
        method: 'POST', credentials: 'omit', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design: code, finish: finish.toLowerCase(), door: doorStyle.toLowerCase(), image }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; key?: string; error?: string; code?: string };
      if (!res.ok || !data.url || !data.key) throw new Error(photoMessage(res.status, data.code, data.error));
      const m = { key: data.key, url: `${apiBase()}${data.url}` };
      writeMemory(designKey, m);
      setMade({ ...m, forKey: designKey });
      setPhase('idle');
      onMade?.();
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      setError(aborted ? 'This is taking longer than usual. Please try again in a moment.' : e instanceof Error && e.message && !/fetch|network/i.test(e.message) ? e.message : 'We could not reach the photo service. Please check your connection and try again.');
      setPhase('error');
    } finally {
      window.clearTimeout(timer);
    }
  };

  const stale = !!made && made.forKey !== designKey; // never true while the memory effect is current; kept for a design changed after a photo was made
  const showing = made && made.forKey === designKey ? made : null;

  return (
    <div className="photoview" data-testid="lite-photo">
      {phase === 'working' && (
        <div className="photoview-center" role="status" data-testid="lite-photo-status">
          <span className="photoview-spinner" aria-hidden="true" />
          <strong>Making your photo…</strong>
          <span>This takes about 20 seconds. Please keep this page open.</span>
        </div>
      )}
      {phase !== 'working' && showing && (
        <figure className="photoview-figure">
          {imgOk
            ? <img src={showing.url} alt="An artist's impression of your cellar as a photograph" className="photoview-img" onError={() => setImgOk(false)} data-testid="lite-photo-img" />
            : <p className="photoview-center" role="alert">The photo could not be shown. Please make it again.</p>}
          <figcaption className="lite-note" data-testid="lite-photo-caption">Artist&apos;s impression made by AI from your design. The racks, bottles and finishes are approximate; your cellar is confirmed after a site measure.</figcaption>
        </figure>
      )}
      {phase !== 'working' && !showing && (
        <div className="photoview-center" data-testid="lite-photo-idle">
          <strong>See your cellar as a photo</strong>
          <span>We turn your design into a realistic-looking picture. It takes about 20 seconds. It is an artist&apos;s impression made by AI, so the racks and bottles will not be exact.</span>
          <button type="button" className="btn primary" disabled={!canMake} onClick={() => void make()} title={canMake ? 'Make a photo-style picture of your cellar. This takes about 20 seconds.' : 'Fix the size problem first, then make a photo.'} data-testid="lite-photo-make">Create my photo</button>
          {!canMake && <span className="lite-note">Your design needs a change before a photo can be made.</span>}
        </div>
      )}
      {phase === 'error' && (
        <div className="photoview-error" role="alert" data-testid="lite-photo-error">
          <span>{error}</span>
          <button type="button" className="btn small" onClick={() => void make()} title="Try making the photo again." data-testid="lite-photo-retry">Try again</button>
        </div>
      )}
      {phase !== 'working' && showing && !stale && (
        <div className="photoview-actions">
          <a className="btn small" href={showing.url} target="_blank" rel="noreferrer" title="Opens the photo on its own, full size, in a new tab." data-testid="lite-photo-open">Open full size</a>
        </div>
      )}
    </div>
  );
}
