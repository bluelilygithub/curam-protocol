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

export function GoalBar(props) {
  return <JobBar {...props} carry={<>use <em>Use in…</em> on the result to carry the picture to</>} />;
}
