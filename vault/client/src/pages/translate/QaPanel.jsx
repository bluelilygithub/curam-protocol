import React, { useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { Modal, useAppVersion } from './shared';
import { downloadQaReport, resultVerdict, VERDICT_COLOURS } from './qaReport';
import { LessonsLearntModal } from './lessons';

// A translation's result ("Open result" in My translations): the downloads, one line saying whether the checks found anything, then
// the list of what to look at. The names of the buttons and the order are the ones the Translate guide describes
// (server/services/translateTutor.js, ids open-result / downloads / email-documents / lessons): change both together.
// A job with no saved check results (qa is null) still opens, for its downloads.

const OUTLINE_BTN = 'text-sm px-3.5 py-2 rounded-lg border font-medium inline-flex items-center gap-1.5 transition-opacity duration-200 hover:opacity-70';
const OUTLINE_STYLE = { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' };

// What the checks can list, most serious first, in the words the page uses.
const SECTIONS = [
  ['polarityOrSentenceTypeIssues', 'Parts whose meaning may have changed', 'For example a “must not” that became a “may”, or a question that became a statement. Read these against the original first.'],
  ['garbledOrIncompleteRows', 'Garbled or unfinished parts', 'Parts that came out empty, cut short, unchanged from the original or scrambled.'],
  ['uncertainTerms', 'Unsure terms', 'Words the translator was not sure how to translate. If one is wrong, fix it for next time with Lessons learnt.'],
  ['audienceFlags', 'Wording that may not suit the reader', 'Places where the tone or level may be wrong for who you said will read it.'],
  ['restructuredSentences', 'Sentences that were reshaped', 'The sentence was rebuilt to read naturally. The meaning should be the same; check any that matter.'],
  ['dialectalChoices', 'Regional word choices', 'Where a regional word was used in place of the standard one.'],
];

function itemText(it) {
  if (it == null) return '';
  if (typeof it === 'string') return it;
  if (it.used && it.standardForm) return `Used “${it.used}” (standard: “${it.standardForm}”)${it.context ? `: ${it.context}` : ''}`;
  const what = it.source || it.excerpt || it.term || it.target || '';
  const why = it.issue || it.why || it.reason || it.note || '';
  const became = it.renderedAs || it.proposedTarget || '';
  return [what && `“${what}”`, became && `→ “${became}”`, why && `(${why})`].filter(Boolean).join(' ') || 'An item with no description';
}

export function QaPanel({ qa, onClose, job, onDownload, onDownloadNative, onDownloadOriginal, onDownloadText }) {
  const getIcon = useIcon();
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const appVersion = useAppVersion();

  const sendEmail = async () => {
    if (!emailTo.trim()) { addToast('Type the address to send to', 'error'); return; }
    setEmailSending(true);
    try {
      const res = await api.post(`/api/translate/jobs/${job.id}/email`, { to: emailTo.trim() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not send the email');
      const n = body.attached?.length;
      addToast(`Sent ${n ? `${n} document${n === 1 ? '' : 's'}` : 'the documents'} to ${emailTo.trim()}`, 'success');
      setEmailOpen(false);
      setEmailTo('');
    } catch (e) { addToast(e.message, 'error'); }
    finally { setEmailSending(false); }
  };

  if (!job) return null;
  const done = job.status === 'done';
  const verdict = resultVerdict(qa);
  const isExcel = /\.xlsx?$/i.test(job.filename || '');
  const cc = qa?.completenessCheck;
  const cv = qa?.claimVerification;
  const shownSections = qa ? SECTIONS.map(([key, title, help]) => [title, help, Array.isArray(qa[key]) ? qa[key] : []]).filter(([, , items]) => items.length) : [];
  const isMaori = job.targetLanguage === 'mi' || job.sourceLanguage === 'mi' || Boolean(qa?.maoriPolicy);

  const dl = (label, tip, onClick, primary) => (
    <Tooltip text={tip}>
      <button type="button" onClick={onClick} className={OUTLINE_BTN}
        style={primary ? { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderColor: 'var(--color-primary)' } : OUTLINE_STYLE}>
        {getIcon('download', { size: 14 })} {label}
      </button>
    </Tooltip>
  );

  return (
    <Modal title={job.filename || 'Translation result'} onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm" style={{ color: 'var(--color-text)' }}>
        {/* ── Downloads ── */}
        <div className="flex gap-2 flex-wrap">
          {done && dl('Download translated PDF', 'The translation as a PDF, in the layout you chose when you started it.', () => onDownload?.(job), true)}
          {done && dl('Download plain text', 'The translation only, as a text file with no styling. Easy to paste somewhere else or edit.', () => onDownloadText?.(job))}
          {done && job.hasNativeOutput && dl(`Download ${isExcel ? 'Excel' : 'Word'}`, `The translation as an editable ${isExcel ? 'Excel' : 'Word'} file, laid out like your original.`, () => onDownloadNative?.(job))}
          {dl('Download original', 'The file you gave Translate, untouched.', () => onDownloadOriginal?.(job))}
          {qa && dl('Download check report', 'A text file listing everything the checks found, to keep or pass to whoever reviews the translation.', () => downloadQaReport(job, qa, appVersion))}
        </div>
        {done && !job.hasNativeOutput && /\.(docx|xlsx?)$/i.test(job.filename || '') && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            There is no {isExcel ? 'Excel' : 'Word'} download for this one: the file’s structure could not be matched up. The PDF and plain text are complete.
          </p>
        )}

        <div className="flex gap-2 flex-wrap">
          <Tooltip text="Send the original, the translated PDF and the check report to an email address, as attachments. Nothing is sent until you press Send.">
            <button type="button" onClick={() => setEmailOpen((v) => !v)} aria-expanded={emailOpen} className={OUTLINE_BTN} style={OUTLINE_STYLE}>
              {getIcon('mail', { size: 14 }) || null} Email these documents
            </button>
          </Tooltip>
          {qa && (
            <Tooltip text="Turn what the checks found into rules and fixed wording for your future translations. This translation stays as it is.">
              <button type="button" onClick={() => setLessonsOpen(true)} className={OUTLINE_BTN} style={OUTLINE_STYLE}>
                {getIcon('lightbulb', { size: 14 })} Lessons learnt
              </button>
            </Tooltip>
          )}
        </div>
        {emailOpen && (
          <div className="flex gap-2 items-center flex-wrap">
            <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} aria-label="Email address to send to"
              onKeyDown={(e) => { if (e.key === 'Enter') sendEmail(); }}
              placeholder="name@example.com"
              className="text-sm px-3 py-2 rounded-lg border flex-1 min-w-48"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
            <button type="button" onClick={sendEmail} disabled={emailSending}
              className="text-sm px-4 py-2 rounded-lg font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
              style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
              {emailSending ? 'Sending…' : 'Send'}
            </button>
            <p className="text-xs w-full" style={{ color: 'var(--color-muted)' }}>
              Sends the original, the translated PDF and the check report, whichever of them exist for this translation.
            </p>
          </div>
        )}

        {/* ── What the checks found ── */}
        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-tour="translate-verdict">
          <p className="font-semibold" style={{ color: VERDICT_COLOURS[verdict.level] }}>{verdict.label}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text)' }}>{verdict.detail}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            This says which kinds of problem the checks listed. It is not an accuracy score, and the checks do not correct anything.
          </p>
        </div>

        {qa?.overallNotes && <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text)' }}>{qa.overallNotes}</p>}

        {shownSections.map(([title, help, items]) => (
          <div key={title}>
            <p className="text-sm font-semibold">{title} ({items.length})</p>
            <p className="text-xs mb-1.5" style={{ color: 'var(--color-muted)' }}>{help}</p>
            <ul className="text-xs space-y-1 pl-4 list-disc" style={{ color: 'var(--color-text)' }}>
              {items.slice(0, 30).map((it, i) => (
                <li key={i}>{typeof it?.index === 'number' ? `Part ${it.index}: ` : ''}{itemText(it)}</li>
              ))}
            </ul>
            {items.length > 30 && <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>And {items.length - 30} more. The check report has the full list.</p>}
          </div>
        ))}
        {qa && !shownSections.length && !qa.hardFail && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {qa.skipped ? 'The second-model check was not run for this translation, so only missing, empty and cut-short parts were looked for.' : 'The checks listed nothing to look at.'}
          </p>
        )}

        {isMaori && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Guidance on te reo Māori (for example from Te Taura Whiri) changes over time. Have a fluent reader check anything that matters.
          </p>
        )}

        {/* ── For whoever looks after Vault ── */}
        {qa && (
          <details className="text-xs" style={{ color: 'var(--color-muted)' }}>
            <summary className="cursor-pointer transition-opacity duration-200 hover:opacity-70">Technical details (for support)</summary>
            <div className="mt-2 space-y-1 font-mono">
              <p>App version: {appVersion || 'checking…'}</p>
              <p>Translated by: {qa.translateModel || 'not recorded'} · Checked by: {qa.reviewModel || 'not recorded'}{qa.glossaryTermCount != null ? ` · Glossary words: ${qa.glossaryTermCount}` : ''}</p>
              {(qa.hardFailCode || qa.softFailCode) && <p>Code: {qa.hardFailCode || qa.softFailCode}</p>}
              {cc?.ran && (
                <p>
                  Parts flagged automatically: {cc.autoFlagged ?? 0} of {cc.total ?? '?'}
                  {cc.identicalCount != null ? ` · same as original: ${cc.identicalCount}` : ''}
                  {cc.placeholderCount != null ? ` · placeholders: ${cc.placeholderCount}` : ''}
                  {cc.emptyCount != null ? ` · empty: ${cc.emptyCount}` : ''}
                  {qa.reviewedPairCount != null ? ` · parts compared: ${qa.reviewedPairCount}/${qa.totalPairCount ?? qa.reviewedPairCount}` : ''}
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
              {qa.guidance && <p>Instructions used: {qa.guidance}</p>}
              {cv?.note && <p>Cross-check of the list above: {cv.note}</p>}
            </div>
          </details>
        )}
      </div>
      {lessonsOpen && qa && <LessonsLearntModal qa={qa} job={job} appVersion={appVersion} onClose={() => setLessonsOpen(false)} />}
    </Modal>
  );
}

export default QaPanel;
