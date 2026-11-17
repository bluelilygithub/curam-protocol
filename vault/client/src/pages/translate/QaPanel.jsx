import React, { useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { downloadQaReport, resultVerdict, VERDICT_COLOURS } from './qaReport';

// The pieces of a translation's result, used by the result screen (ResultScreen.jsx): the downloads and email, what the checks found,
// and the technical details. The names of the buttons are the ones the Translate guide describes (server/services/translateTutor.js,
// ids open-result / downloads / email-documents / lessons): change both together.

export const OUTLINE_BTN = 'text-sm px-3.5 py-2 rounded-lg border font-medium inline-flex items-center gap-1.5 transition-opacity duration-200 hover:opacity-70 disabled:opacity-40';
export const OUTLINE_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };
export const PRIMARY_STYLE = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderColor: 'var(--color-primary)' };

// What the checks can list, most serious first, in the words the page uses.
export const SECTIONS = [
  ['polarityOrSentenceTypeIssues', 'Parts whose meaning may have changed', 'For example a “must not” that became a “may”, or a question that became a statement. Read these against the original first.'],
  ['garbledOrIncompleteRows', 'Garbled or unfinished parts', 'Parts that came out empty, cut short, unchanged from the original or scrambled.'],
  ['uncertainTerms', 'Unsure terms', 'Words the translator was not sure how to translate. If one is wrong, fix it in another pass (or, once kept, with Lessons learnt).'],
  ['audienceFlags', 'Wording that may not suit the reader', 'Places where the tone or level may be wrong for who you said will read it.'],
  ['restructuredSentences', 'Sentences that were reshaped', 'The sentence was rebuilt to read naturally. The meaning should be the same; check any that matter.'],
  ['dialectalChoices', 'Regional word choices', 'Where a regional word was used in place of the standard one.'],
];

export function itemText(it) {
  if (it == null) return '';
  if (typeof it === 'string') return it;
  if (it.used && it.standardForm) return `Used “${it.used}” (standard: “${it.standardForm}”)${it.context ? `: ${it.context}` : ''}`;
  const what = it.source || it.excerpt || it.term || it.target || '';
  const why = it.issue || it.why || it.reason || it.note || '';
  const became = it.renderedAs || it.proposedTarget || '';
  return [what && `“${what}”`, became && `→ “${became}”`, why && `(${why})`].filter(Boolean).join(' ') || 'An item with no description';
}

/**
 * Which parts each finding is about: { partIndex: [{ title, text }] }. A garbled row carries its part number; other findings quote
 * text, which is looked for in each part's original and translation. Used to mark parts on the reading view.
 */
export function flagsByPart(qa, parts) {
  const out = {};
  if (!qa || !Array.isArray(parts)) return out;
  const add = (i, title, item) => { (out[i] = out[i] || []).push({ title, text: itemText(item) }); };
  for (const [key, title] of SECTIONS) {
    for (const item of Array.isArray(qa[key]) ? qa[key] : []) {
      if (typeof item?.index === 'number') {
        if (parts[item.index]) add(item.index, title, item);
        continue;
      }
      const probes = [item?.source, item?.target, item?.excerpt, item?.sourceExcerpt, item?.targetExcerpt, item?.used]
        .filter((s) => typeof s === 'string' && s.trim().length > 2).map((s) => s.trim());
      if (!probes.length) continue;
      for (const p of parts) {
        if (probes.some((s) => (p.source || '').includes(s) || (p.target || '').includes(s))) { add(p.i, title, item); break; }
      }
    }
  }
  return out;
}

/** The verdict line, then each kind of finding. `onFixWord(item)` (drafts only) adds an unsure term to the requirements. */
export function CheckFindings({ qa, isMaori, onFixWord, onShowPart, partOf }) {
  const getIcon = useIcon();
  const verdict = resultVerdict(qa);
  const shown = qa ? SECTIONS.map(([key, title, help]) => [key, title, help, Array.isArray(qa[key]) ? qa[key] : []]).filter(([, , , items]) => items.length) : [];
  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }} data-tour="translate-verdict">
        <p className="font-semibold text-sm" style={{ color: VERDICT_COLOURS[verdict.level] }}>{verdict.label}</p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text)' }}>{verdict.detail}</p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
          This says which kinds of problem the checks listed. It is not an accuracy score, and the checks do not correct anything.
        </p>
      </div>
      {qa?.overallNotes && <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>{qa.overallNotes}</p>}
      {shown.map(([key, title, help, items]) => (
        <div key={key}>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title} ({items.length})</p>
          <p className="text-xs mb-1.5" style={{ color: 'var(--color-muted)' }}>{help}</p>
          <ul className="text-xs space-y-1.5 pl-4 list-disc" style={{ color: 'var(--color-text)' }}>
            {items.slice(0, 30).map((it, i) => {
              const part = partOf?.(it);
              return (
                <li key={i}>
                  {itemText(it)}
                  {part != null && onShowPart && (
                    <button type="button" onClick={() => onShowPart(part)} className="ml-1.5 underline transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>
                      Show it
                    </button>
                  )}
                  {key === 'uncertainTerms' && onFixWord && it?.source && (
                    <Tooltip text="Add this word to the requirements for the next pass, with the translation it must get.">
                      <button type="button" onClick={() => onFixWord(it)} className="ml-1.5 inline-flex items-center gap-0.5 underline transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>
                        {getIcon('edit', { size: 11 })} Fix this word
                      </button>
                    </Tooltip>
                  )}
                </li>
              );
            })}
          </ul>
          {items.length > 30 && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>And {items.length - 30} more. The check report has the full list.</p>}
        </div>
      ))}
      {qa && !shown.length && !qa.hardFail && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {qa.skipped ? 'The second-model check was not run, so only missing, empty and cut-short parts were looked for.' : 'The checks listed nothing to look at.'}
        </p>
      )}
      {isMaori && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Guidance on te reo Māori (for example from Te Taura Whiri) changes over time. Have a fluent reader check anything that matters.
        </p>
      )}
    </div>
  );
}

/** For whoever looks after Vault: models, version, counts. Closed by default. */
export function TechnicalDetails({ qa, appVersion }) {
  if (!qa) return null;
  const cc = qa.completenessCheck;
  const cv = qa.claimVerification;
  return (
    <details className="text-xs" style={{ color: 'var(--color-muted)' }}>
      <summary className="cursor-pointer transition-opacity duration-200 hover:opacity-70">Technical details (for support)</summary>
      <div className="mt-2 space-y-1 font-mono break-words">
        <p>App version: {appVersion || 'checking…'}</p>
        <p>Translated by: {qa.translateModel || 'not recorded'} · Checked by: {qa.reviewModel || 'not recorded'}{qa.glossaryTermCount != null ? ` · Glossary words: ${qa.glossaryTermCount}` : ''}</p>
        {qa.passNo ? <p>Version: pass {qa.passNo}{qa.scope === 'parts' ? ' (picked parts only)' : ''}</p> : null}
        {(qa.hardFailCode || qa.softFailCode) && <p>Code: {qa.hardFailCode || qa.softFailCode}</p>}
        {cc?.ran && (
          <p>
            Parts flagged automatically: {cc.autoFlagged ?? 0} of {cc.total ?? '?'}
            {cc.identicalCount != null ? ` · same as original: ${cc.identicalCount}` : ''}
            {cc.placeholderCount != null ? ` · placeholders: ${cc.placeholderCount}` : ''}
            {cc.emptyCount != null ? ` · empty: ${cc.emptyCount}` : ''}
          </p>
        )}
        {qa.repairStats?.attempted > 0 && (
          <p>
            Second attempts: {qa.repairStats.attempted}
            {qa.repairStats.llmRepaired != null ? ` · fixed by Vault AI: ${qa.repairStats.llmRepaired}` : ''}
            {qa.repairStats.googleRepaired != null ? ` · fixed by Google Translate: ${qa.repairStats.googleRepaired}` : ''}
            {qa.repairStats.stillFailing != null ? ` · still not right: ${qa.repairStats.stillFailing}` : ''}
          </p>
        )}
        {qa.maoriPolicy && <p>Te reo Māori setting: {qa.maoriPolicy}</p>}
        {cv?.note && <p>Cross-check of the list above: {cv.note}</p>}
      </div>
    </details>
  );
}

/** The downloads of a kept translation, and Email these documents. */
export function Downloads({ job, qa, appVersion, onDownload, onDownloadNative, onDownloadOriginal, onDownloadText }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [sending, setSending] = useState(false);
  const isExcel = /\.xlsx?$/i.test(job.filename || '');

  const sendEmail = async () => {
    if (!emailTo.trim()) { addToast('Type the address to send to', 'error'); return; }
    setSending(true);
    try {
      const res = await api.post(`/api/translate/jobs/${job.id}/email`, { to: emailTo.trim() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not send the email');
      const n = body.attached?.length;
      addToast(`Sent ${n ? `${n} document${n === 1 ? '' : 's'}` : 'the documents'} to ${emailTo.trim()}`, 'success');
      setEmailOpen(false);
      setEmailTo('');
    } catch (e) { addToast(e.message, 'error'); }
    finally { setSending(false); }
  };
  const dl = (label, tip, onClick, primary) => (
    <Tooltip text={tip}>
      <button type="button" onClick={onClick} className={OUTLINE_BTN} style={primary ? PRIMARY_STYLE : OUTLINE_STYLE}>
        {getIcon('download', { size: 14 })} {label}
      </button>
    </Tooltip>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {dl('Download translated PDF', 'The translation as a PDF, in the layout you chose when you started it.', () => onDownload?.(job), true)}
        {dl('Download plain text', 'The translation only, as a text file with no styling. Easy to paste somewhere else or edit.', () => onDownloadText?.(job))}
        {job.hasNativeOutput && dl(`Download ${isExcel ? 'Excel' : 'Word'}`, `The translation as an editable ${isExcel ? 'Excel' : 'Word'} file, laid out like your original.`, () => onDownloadNative?.(job))}
        {dl('Download original', 'The file you gave Translate, untouched.', () => onDownloadOriginal?.(job))}
        {qa && dl('Download check report', 'A text file listing everything the checks found, to keep or pass to whoever reviews the translation.', () => downloadQaReport(job, qa, appVersion))}
      </div>
      {!job.hasNativeOutput && /\.(docx|xlsx?)$/i.test(job.filename || '') && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          There is no {isExcel ? 'Excel' : 'Word'} download for this one: the file’s structure could not be matched up. The PDF and plain text are complete.
        </p>
      )}
      <Tooltip text="Send the original, the translated PDF and the check report to an email address, as attachments. Nothing is sent until you press Send.">
        <button type="button" onClick={() => setEmailOpen((v) => !v)} aria-expanded={emailOpen} className={OUTLINE_BTN} style={OUTLINE_STYLE}>
          {getIcon('mail', { size: 14 })} Email these documents
        </button>
      </Tooltip>
      {emailOpen && (
        <div className="flex gap-2 items-center flex-wrap">
          <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} aria-label="Email address to send to"
            onKeyDown={(e) => { if (e.key === 'Enter') sendEmail(); }}
            placeholder="name@example.com"
            className="text-sm px-3 py-2 rounded-lg border flex-1 min-w-48"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
          <button type="button" onClick={sendEmail} disabled={sending} className={OUTLINE_BTN} style={PRIMARY_STYLE}>
            {sending ? 'Sending…' : 'Send'}
          </button>
          <p className="text-xs w-full" style={{ color: 'var(--color-muted)' }}>
            Sends the original, the translated PDF and the check report, whichever of them exist for this translation.
          </p>
        </div>
      )}
    </div>
  );
}
