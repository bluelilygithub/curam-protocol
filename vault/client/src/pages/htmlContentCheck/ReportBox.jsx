import React, { useState } from 'react';
import Tooltip from '../../components/Tooltip';
import { PrimaryButton, CARD } from './shared';

// The client report (milestone 5), on Changes for a round after the starting point: a fillable PDF of the lines the person approved,
// grouped by page, with Held over and Keep lines listed and a Further changes table and sign-off for the client. Changes nobody asked
// for are left out unless ticked. Making the first report fixes the R numbers.
export default function ReportBox({ approvals, onDownload, busy, locked }) {
  const [unasked, setUnasked] = useState(false);
  const values = Object.values(approvals);
  const approved = values.filter((a) => a.status === 'approved').length;
  const needsWork = values.filter((a) => a.status === 'needs_work').length;
  return (
    <section className="rounded-2xl border p-6 space-y-3" style={CARD} data-guide="report">
      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Client report</h2>
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        {approved
          ? `${approved} line${approved === 1 ? '' : 's'} approved${needsWork ? `, ${needsWork} need${needsWork === 1 ? 's' : ''} work (left off the report)` : ''}. The report is a PDF the client fills in: a tick and a note for each approved line, page by page.`
          : 'Approve the lines you have checked (Approve under each line). Only approved lines go on the report.'}
      </p>
      <Tooltip text="Also list the changes on each page that no request line asked for, so the client can say whether each is fine.">
        <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input type="checkbox" checked={unasked} onChange={(e) => setUnasked(e.target.checked)} />
          Include changes nobody asked for
        </label>
      </Tooltip>
      <PrimaryButton disabled={!approved || busy} onClick={() => onDownload(unasked)}
        tip={approved ? 'Download the fillable PDF to send to the client.' : 'Approve at least one line first.'}>
        Make the client report
      </PrimaryButton>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        {locked ? 'A report has been made, so the R numbers are fixed: new lines get new numbers.' : 'The first report fixes the R numbers, so the client\'s answers keep pointing at the right lines.'}
      </p>
    </section>
  );
}
