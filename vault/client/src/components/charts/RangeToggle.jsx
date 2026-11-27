import React from 'react';
import SegmentedToggle from './SegmentedToggle';

// The time-range picker for a page of charts. options: [{ value, label, tip? }]; a tip is made from the label when none is given.
export default function RangeToggle({ options, value, onChange, disabled }) {
  const withTips = options.map((o) => ({ ...o, tip: o.tip || `Show ${o.label === 'Today' ? 'today' : o.label.toLowerCase()} on the charts that follow the range` }));
  return <SegmentedToggle label="Time range" options={withTips} value={value} onChange={onChange} disabled={disabled} />;
}
