// Small words and dates for the Vault Shelf keys list (Settings -> Vault Shelf). Pure, so a test can check them.
// node client/src/utils/shelfKeys.test.mjs

export const EXPIRY_CHOICES = [
  { value: '', label: 'Until I revoke it' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

const WORDS = { active: 'Active', revoked: 'Revoked', expired: 'Expired' };
export const statusWord = (status) => WORDS[status] || 'Unknown';

/** "today", "yesterday", "3 days ago" for a past moment; for a future one ("in 12 days" / "in 3 hours") when `future` is true. */
export function whenText(value, future = false, now = new Date()) {
  if (value == null || value === '') return 'unknown'; // new Date(null) is 1970, not an error
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const days = Math.round((d.getTime() - now.getTime()) / 86400000);
  if (future) {
    if (days > 1) return `in ${days} days`;
    const hours = Math.max(1, Math.round((d.getTime() - now.getTime()) / 3600000));
    return days === 1 ? 'tomorrow' : `in ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const ago = -days;
  if (ago <= 0) return 'today';
  if (ago === 1) return 'yesterday';
  if (ago < 60) return `${ago} days ago`;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
