// The words for the "Earlier versions" list. Pure, so it is unit-tested: node client/src/pages/notes/noteVersions.test.mjs

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const clock = (d) => { const h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today, 2:35 pm", "Yesterday, 9:10 am", "Fri 23 Oct, 4:05 pm" (the year only when it is not this year). `value` is anything Date understands. */
export function describeWhen(value, now = new Date()) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  if (sameDay(d, now)) return `Today, ${clock(d)}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yesterday)) return `Yesterday, ${clock(d)}`;
  const year = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${year}, ${clock(d)}`;
}

/** What a version's tag says about why it was kept: nothing for an ordinary edit. */
export function describeReason(reason) {
  if (reason === 'ai') return 'Before an AI change';
  if (reason === 'restore') return 'Before a restore';
  return '';
}

/** "1,052 characters", "1 character". */
export function describeSize(chars) {
  const n = Math.max(0, Number(chars) || 0);
  return `${n.toLocaleString('en-AU')} character${n === 1 ? '' : 's'}`;
}

/** What the difference in length says, for the list: "shorter by 400", "longer by 12", or "same length" (against the note as it is now). */
export function describeLength(versionChars, currentChars) {
  const d = (Number(currentChars) || 0) - (Number(versionChars) || 0);
  if (d === 0) return 'same length as now';
  return d > 0 ? `${Math.abs(d).toLocaleString('en-AU')} fewer than now` : `${Math.abs(d).toLocaleString('en-AU')} more than now`;
}
