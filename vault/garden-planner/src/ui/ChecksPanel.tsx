import { useState } from 'react';
import { useStore } from 'zustand';
import type { Issue } from '../checks';
import { DRAFT_LABEL } from '../checks';
import { weedFilterNote } from '../plants/weeds';
import { countBySeverity } from '../state/checksStore';
import { useApp, useUi } from './AppContext';
import { NumField } from './fields';
import { Icon } from './icons';

const SEV_LABEL = { error: 'Fix', warning: 'Check', info: 'Note' } as const;

/** The checks: what is wrong with the plan, why, and a one-click fix where there is a sensible one. */
export function ChecksPanel() {
  const app = useApp();
  const issues = useStore(app.checks, (s) => s.issues);
  const computing = useStore(app.checks, (s) => s.computing);
  const pathMin = useUi((s) => s.pathMinWidth);
  const mower = useUi((s) => s.mowerWidth);
  const [showNotes, setShowNotes] = useState(false);
  const counts = countBySeverity(issues);
  const problems = issues.filter((i) => i.severity !== 'info');
  const notes = issues.filter((i) => i.severity === 'info');
  const set = app.ui.getState().set;

  return (
    <div className="checks" data-testid="checks-panel">
      <p className="summary" aria-live="polite" data-testid="checks-summary">
        <span className="sev-error">{counts.error} to fix</span>
        <span className="sev-warning">{counts.warning} to check</span>
        <span>{counts.info} note{counts.info === 1 ? '' : 's'}</span>
        {computing && <span>updating…</span>}
      </p>
      <p className="note" data-testid="checks-draft-note">
        Spacing, boundary, house and pipe checks use plants' <b>mature</b> sizes. Anything based on plant data is <b>{DRAFT_LABEL}</b>: the plant list has not yet been checked against nursery or state sources.
      </p>

      {problems.length === 0 && <p className="note" data-testid="checks-clear">No problems found in the plan.{notes.length ? ' There are notes below.' : ''}</p>}
      <ul className="issues">
        {problems.map((i) => <IssueCard key={i.id} issue={i} />)}
      </ul>

      {notes.length > 0 && (
        <>
          <button type="button" className="chip" aria-expanded={showNotes} onClick={() => setShowNotes(!showNotes)}>{showNotes ? 'Hide' : 'Show'} {notes.length} note{notes.length === 1 ? '' : 's'}</button>
          {showNotes && <ul className="issues">{notes.map((i) => <IssueCard key={i.id} issue={i} />)}</ul>}
        </>
      )}

      <h3>Settings</h3>
      <NumField label="Narrowest path" unit="m" value={pathMin} min={0.3} max={3} step={0.1} onCommit={(v) => set({ pathMinWidth: v })} hint="Paths narrower than this are flagged. 0.9 m is comfortable to walk." />
      <NumField label="Mower width" unit="m" value={mower} min={0.3} max={3} step={0.1} onCommit={(v) => set({ mowerWidth: v })} hint="The mower has to reach every lawn through gates and gaps at least this wide." />
      <p className="note" data-testid="weed-note">{weedFilterNote()}</p>
    </div>
  );
}

function IssueCard({ issue }: { issue: Issue }) {
  const app = useApp();
  return (
    <li className={`issue sev-${issue.severity}`} data-testid={`issue-${issue.type}`}>
      <div className="issue-head">
        <Icon name="alert" size={14} />
        <strong>{issue.title}</strong>
        <span className="issue-tag">{SEV_LABEL[issue.severity]}</span>
      </div>
      <p>{issue.message}</p>
      <div className="row">
        {issue.items.length > 0 && <button type="button" className="btn" onClick={() => app.focusIssue(issue)}>Show</button>}
        {issue.fix && <button type="button" className="btn primary" onClick={() => app.applyFix(issue)}>{issue.fix.label}</button>}
      </div>
    </li>
  );
}
