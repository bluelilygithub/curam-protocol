import { useEffect, useMemo, useRef, useState } from 'react';
import { MicButton } from '@planner-core/speech/VoiceInput';
import { botanicalLabel, PLANTS, plantLabel } from '../plants/plants';
import { siteOf, unsuitableReasons, UNSUITABLE_TEXT } from '../plants/suitability';
import { weedStatus, weedStatusText } from '../plants/weeds';
import { compareFacts, isAmbiguous, matchTag, parseTagFacts, type MatchConfidence, type TagFacts } from '../plants/tagMatch';
import { LOW_CONFIDENCE } from '../state/tagScan';
import { useApp, useProject, useUi } from './AppContext';
import { Icon } from './icons';
import { PlantSwatch } from './PlantLibrary';

const CONF_LABEL: Record<MatchConfidence, string> = { strong: 'Strong match', possible: 'Possible', weak: 'Weak hint' };

/** "On the tag: 1 to 1.5 m high, 1 m wide, full sun". */
export function describeFacts(f: TagFacts): string {
  const r = (a: [number, number]): string => (a[0] === a[1] ? `${a[0]} m` : `${a[0]} to ${a[1]} m`);
  const parts: string[] = [];
  if (f.height) parts.push(`${r(f.height)} high`);
  if (f.spread) parts.push(`${r(f.spread)} wide`);
  if (f.sun) parts.push(f.sun.map((s) => s.replace('_', ' ')).join(' or '));
  return parts.join(', ');
}

/**
 * Scan a nursery plant tag: take or choose a photo, read it on this device, and see which library plants it could be. Nothing is added
 * for you: you choose, and "Add to plan" then arms the plant tool. The text that was read is shown and can be corrected, and you can type
 * the name instead of using a photo. The photo never leaves the device.
 */
export function TagScanModal() {
  const app = useApp();
  const open = useUi((s) => s.tagScanOpen);
  if (!open) return null;
  return <TagScan close={() => { void app.tagScanner.dispose(); app.ui.getState().set({ tagScanOpen: false }); }} />;
}

function TagScan({ close }: { close: () => void }) {
  const app = useApp();
  const project = useProject((s) => s.project);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ stage: string; progress?: number } | null>(null);
  const [conf, setConf] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);

  const site = project ? siteOf(project) : null;
  // with a strong match in hand, same-genus "weak hints" would only bury it; with no strong match they are all there is
  const matches = useMemo(() => { const all = matchTag(text, PLANTS); return all[0]?.confidence === 'strong' ? all.filter((m) => m.confidence !== 'weak') : all; }, [text]);
  const facts = useMemo(() => parseTagFacts(text), [text]);
  const factText = describeFacts(facts);
  const searched = text.trim().length > 0;

  const read = async (file: File): Promise<void> => {
    setError(null); setConf(null); setScanned(false);
    setPhoto((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
    try {
      const r = await app.tagScanner.scan(file, (s) => setBusy({ stage: s.stage, progress: s.progress }));
      setText(r.text);
      setConf(r.meanConf);
      setScanned(true);
    } catch (e) {
      setError(e instanceof Error && e.message ? `That photo could not be read: ${e.message}` : 'That photo could not be read. Try another, or type the name below.');
    } finally { setBusy(null); }
  };

  const addToPlan = (id: string): void => { app.ui.getState().placePlant(id); close(); };
  const stageText = busy?.stage === 'model' ? 'Loading the reader (the first time only, about 10 MB)…' : busy?.stage === 'prepare' ? 'Getting the photo ready…' : `Reading the tag… ${Math.round((busy?.progress ?? 0) * 100)}%`;

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Scan a plant tag" onClick={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
      <div className="modal wide tagscan">
        <div className="modal-head"><h2>Scan a plant tag</h2><button type="button" className="icon-btn" title="Close" onClick={close}><Icon name="close" size={16} /></button></div>
        <div className="modal-body">
          <p className="note">Photograph the tag that came with the plant. The reading happens on this device and the photo is not uploaded. Then pick the plant it is: nothing is added for you.</p>

          <div className="row">
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Photo of a plant tag" data-testid="tag-file"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f); }} />
            <button type="button" className="btn primary" disabled={!!busy} onClick={() => fileRef.current?.click()}><Icon name="camera" size={15} /> Take or choose a photo</button>
          </div>

          {busy && <p className="note" role="status" data-testid="tag-progress">{stageText}</p>}
          {error && <p className="note warn" role="alert" data-testid="tag-error">{error}</p>}

          {photo && <img className="tag-photo" src={photo} alt="Your photo of the tag" />}
          {scanned && conf !== null && conf < LOW_CONFIDENCE && <p className="note warn" data-testid="tag-lowconf">The photo was hard to read. Check the words below and correct anything wrong, or take another photo with more light and the tag filling the frame.</p>}
          {scanned && !text.trim() && <p className="note warn" data-testid="tag-empty">No words were found in that photo. Try again with the tag flat, in good light, or type the name below.</p>}

          <label className="field">
            <span className="field-label">{scanned ? 'What was read (you can correct it)' : 'Or type the name from the tag'}</span>
            <div className="vi-wrap tag-text">
              <textarea className="vi-input" rows={3} value={text} aria-label="Text from the tag" placeholder="e.g. Lavandula angustifolia, English lavender" onChange={(e) => setText(e.target.value)} disabled={!!busy} />
              <MicButton onFinal={(t) => setText((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t))} />
            </div>
          </label>

          {factText && <p className="note" data-testid="tag-facts">On the tag: {factText}.</p>}

          {searched && !busy && (
            <section aria-label="Plants it could be" data-testid="tag-results">
              <h3>{matches.length ? 'Which plant is it?' : 'No plant matched'}</h3>
              {matches.length === 0 && <p className="note" data-testid="tag-none">Nothing in the library matches that. Check the spelling above, or search the library by part of the name. If the plant is not in the library yet, it cannot be added from a tag.</p>}
              {isAmbiguous(matches) && <p className="note warn" data-testid="tag-ambiguous">Several plants fit what was read. Choose the right one, or add more of the name (the botanical name is best).</p>}
              <ul className="tag-matches">
                {matches.map((m) => {
                  const notes = compareFacts(m.plant, facts);
                  const reasons = site ? unsuitableReasons(m.plant, site) : [];
                  const weed = project ? weedStatus(m.plant, project.location.state) : null;
                  return (
                    <li key={m.plant.id} className="tag-match" data-testid="tag-match" data-plant={m.plant.id}>
                      <PlantSwatch p={m.plant} size={44} />
                      <div className="tag-match-body">
                        <p className="tag-match-name"><strong>{plantLabel(m.plant)}</strong> <em>{botanicalLabel(m.plant)}</em> <span className={`chip conf-${m.confidence}`}>{CONF_LABEL[m.confidence]}</span></p>
                        <p className="note">{m.reasons.join('. ')}.</p>
                        {notes.map((n) => <p key={n} className="note warn">{n}</p>)}
                        {site && reasons.length > 0 && <ul className="warnlist">{reasons.map((r) => <li key={r}>{UNSUITABLE_TEXT[r](m.plant, site)}</li>)}</ul>}
                        {project && weed === 'unknown' && <p className="note">{weedStatusText(m.plant, project.location.state)}. Not the same as safe.</p>}
                        <button type="button" className="btn primary" onClick={() => addToPlan(m.plant.id)}><Icon name="plus" size={15} /> Add to plan</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {matches.length > 0 && <p className="note">Our plant data is a draft, unverified. Where the tag disagrees with it, trust the tag and check with the nursery.</p>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
