import React, { useEffect, useRef, useState } from 'react';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import EmptyState from '../../components/EmptyState';
import { CARD, FIELD_CLASS, FIELD_STYLE, PrimaryButton, SecondaryButton, IconButton } from './shared';

// The change request as numbered lines. Edits are made on a draft and saved together (PUT /items), so a half-finished split or join
// never reaches the server. Until the first client report, the server renumbers R1, R2 ... in list order on every save.
let nextKey = 1;
const toDraft = (items) => items.map((it) => ({ key: `i${it.id}`, id: it.id, ref: it.ref, lineText: it.lineText }));
const fresh = (lineText = '') => ({ key: `n${nextKey++}`, id: null, ref: null, lineText });

export default function LinesView({ job, getIcon, saveItems, resplit }) {
  const [draft, setDraft] = useState(() => toDraft(job.items));
  const [confirmResplit, setConfirmResplit] = useState(false);
  const boxes = useRef({}); // key -> that line's text box; Split reads its cursor (kept after the box loses focus)
  useEffect(() => { setDraft(toDraft(job.items)); }, [job.items]);

  const saved = JSON.stringify(job.items.map((i) => [i.id, i.lineText]));
  const dirty = JSON.stringify(draft.map((d) => [d.id, d.lineText])) !== saved;
  const blank = draft.some((d) => !d.lineText.trim());
  const locked = Boolean(job.refsLockedAt);

  const update = (i, patch) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i, by) => setDraft((d) => { const n = [...d]; [n[i], n[i + by]] = [n[i + by], n[i]]; return n; });
  const remove = (i) => setDraft((d) => d.filter((_, j) => j !== i));
  const join = (i) => setDraft((d) => {
    const n = [...d];
    n[i] = { ...n[i], lineText: `${n[i].lineText.trim()} ${n[i + 1].lineText.trim()}` };
    n.splice(i + 1, 1);
    return n;
  });
  const split = (i) => setDraft((d) => {
    const at = boxes.current[d[i].key]?.selectionStart;
    const text = d[i].lineText;
    if (!(at > 0 && at < text.length)) return d;
    const n = [...d];
    n.splice(i, 1, { ...d[i], lineText: text.slice(0, at).trim() }, fresh(text.slice(at).trim()));
    return n;
  });

  return (
    <div className="flex flex-col xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start gap-4">
      <section className="rounded-2xl border p-6 space-y-4" style={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Request lines ({draft.length})</h2>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton tip="Throw away the changes you have not saved." disabled={!dirty} onClick={() => setDraft(toDraft(job.items))}>Discard</SecondaryButton>
            <PrimaryButton tip={blank ? 'A line is empty: type something in it or remove it.' : 'Save the lines. Until a client report is made, the R numbers follow the order of the list.'} disabled={!dirty || blank} onClick={() => saveItems(draft)}>Save</PrimaryButton>
          </div>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {locked
            ? 'A client report has been made, so each line keeps its R number. A new line gets the next number, and a removed line\'s number is not used again.'
            : 'Put the cursor where a line should break and press Split, or join a line with the one below. The R numbers follow the order when you save.'}
        </p>
        {draft.length === 0 && <EmptyState icon="clipboard-list" title="No request lines" body="Add a line for each edit that was asked for, or split the request again." />}
        <ol className="space-y-2">
          {draft.map((d, i) => (
            <li key={d.key} className="rounded-xl border p-3 flex gap-3 items-start" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <span className="text-xs font-semibold w-9 pt-2.5 shrink-0" style={{ color: d.ref ? 'var(--color-primary)' : 'var(--color-muted)' }}>{d.ref || 'new'}</span>
              <div className="flex-1 min-w-0">
                <VoiceInput type="textarea" append rows={2} value={d.lineText} onChange={(v) => update(i, { lineText: v })} label={`Request line ${d.ref || i + 1}`}
                  inputRef={(el) => { boxes.current[d.key] = el; }} className={FIELD_CLASS} style={FIELD_STYLE} />
              </div>
              <div className="flex flex-wrap gap-1 w-[72px] shrink-0 justify-end">
                <IconButton tip="Move this line up." label="Move up" icon={getIcon('chevron-up', { size: 14 })} disabled={i === 0} onClick={() => move(i, -1)} />
                <IconButton tip="Move this line down." label="Move down" icon={getIcon('chevron-down', { size: 14 })} disabled={i === draft.length - 1} onClick={() => move(i, 1)} />
                <IconButton tip="Split this line in two where the cursor is (click in the text first)." label="Split line" icon={getIcon('scissors', { size: 14 })} onClick={() => split(i)} />
                <IconButton tip="Join this line with the one below it." label="Join with next line" icon={getIcon('combine', { size: 14 })} disabled={i === draft.length - 1} onClick={() => join(i)} />
                <IconButton tip="Remove this line (nothing is saved until you press Save)." label="Remove line" icon={getIcon('trash', { size: 14 })} onClick={() => remove(i)} />
              </div>
            </li>
          ))}
        </ol>
        <SecondaryButton tip="Add an empty line at the end, for an edit the request did not list." onClick={() => setDraft((d) => [...d, fresh()])}>Add a line</SecondaryButton>
      </section>

      <section className="rounded-2xl border p-6 space-y-3" style={CARD}>
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>The request as pasted</h2>
        <pre className="text-sm whitespace-pre-wrap break-words rounded-xl border p-3 max-h-[60vh] overflow-y-auto font-sans" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}>{job.requestText}</pre>
        {!locked && (confirmResplit ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
            Replace the lines with a fresh split of the request?
            <SecondaryButton tip="Yes: replace every line, including your edits, with a fresh split." danger onClick={() => { setConfirmResplit(false); resplit(); }}>Yes</SecondaryButton>
            <SecondaryButton tip="No: keep the lines as they are." onClick={() => setConfirmResplit(false)}>No</SecondaryButton>
          </div>
        ) : (
          <SecondaryButton tip="Split the request into lines again, for example after changing it in Job details. Replaces the current lines." onClick={() => setConfirmResplit(true)}>Split the request again</SecondaryButton>
        ))}
      </section>
    </div>
  );
}
