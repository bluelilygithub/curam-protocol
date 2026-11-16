import React from 'react';
import { JobStart, JobBar } from '../../components/JobStart';
import { GOALS } from './goals.mjs';

// Graphics' job screen and step bar: the shared components (components/JobStart.jsx) with the Graphics jobs and wording.
export function GoalStart(props) {
  return (
    <JobStart
      {...props}
      goals={GOALS}
      appName="Graphics"
      tourId="graphics-goals"
      intro="Pick a job and Graphics opens the tools for it, one step at a time. Or describe it in the box above, or browse every tool in the list on the left."
    />
  );
}

// `canCarryTo(toolId)`: does that tool accept a picture through Use in…? When it does not (Print Ready, Smart Crop,
// Vectorize and others), the bar says to download the result and open it there instead of pointing at Use in….
export function GoalBar({ canCarryTo, ...props }) {
  const carry = (nextTool) => (canCarryTo && !canCarryTo(nextTool)
    ? <>download the result, then choose that file in</>
    : <>use <em>Use in…</em> on the result to carry the picture to</>);
  return <JobBar {...props} carry={carry} />;
}
