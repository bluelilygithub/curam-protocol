import React from 'react';
import Tooltip from '../../components/Tooltip';
import { CARD, FIELD } from './shared';
import { useContractReview } from './context';

// PDF report of the open review: download it or email it.
export default function ReportView() {
  const { getIcon, review, obligations, reportEmail, setReportEmail, reportBusy, downloadReport, emailReport } = useContractReview();

  return (
    <div className="space-y-4">
      {!review && <div className="text-sm" style={{ color: 'var(--color-muted)' }}>The report needs a finished review. Open Risk review first.</div>}
  {review && (
    <div className="rounded-lg border p-4" style={CARD} data-guide="report">
      <h2 className="text-base font-semibold mb-2">Report</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip text="Banner, parties and role, every flag with its reason and redline, and obligations.">
          <button onClick={downloadReport} disabled={reportBusy} className="rounded border px-3 py-1.5 text-xs hover:opacity-70 flex items-center gap-1" style={{ ...FIELD, transition: 'opacity 200ms', opacity: reportBusy ? 0.5 : 1 }}>
            {getIcon('download', { size: 14 })} Download PDF
          </button>
        </Tooltip>
        <Tooltip text="Sends the same PDF report to this address instead of downloading it.">
          <input
            type="email" value={reportEmail} onChange={(e) => setReportEmail(e.target.value)}
            placeholder="Email address" className="rounded border px-2 py-1.5 text-sm" style={FIELD}
          />
        </Tooltip>
        <button onClick={emailReport} disabled={reportBusy || !reportEmail.trim()} className="rounded border px-3 py-1.5 text-xs hover:opacity-70" style={{ ...FIELD, transition: 'opacity 200ms', opacity: reportBusy || !reportEmail.trim() ? 0.5 : 1 }}>
          Send report
        </button>
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
        Banner, parties and role, flags with reasons and redlines, and obligations.
      </p>
    </div>
  )}
    </div>
  );
}
