// Password health: looks over the already-decrypted entries, in the browser, and lists what to fix. Nothing leaves the device and it
// cannot know about data breaches (that would mean sending the passwords somewhere). Test: node client/src/pages/passwordVault/vaultHealth.test.mjs

import { estimateStrength } from '../../utils/passwordGen.mjs';

export const OLD_AFTER_DAYS = 365;
const DAY = 86400000;

// Worst first, so the list reads in order of importance.
export const KINDS = {
  reused: { word: 'Reused', rank: 0, fix: 'Give each login its own password: if one site leaks it, the rest are not opened with it.' },
  weak: { word: 'Weak', rank: 1, fix: 'Make a new one in the Password generator and change it on the site.' },
  old: { word: 'Old', rank: 2, fix: 'It has not been changed for over a year. Change it on the site, then update it here.' },
  missing: { word: 'No password', rank: 3, fix: 'There is no password saved for this one yet.' },
};

/**
 * @param {Array<{id:number,title:string,password?:string,passwordChangedAt?:string,createdAt?:string}>} entries decrypted entries
 * @param {Date} [now]
 * @returns {{ findings: Array<{entryId:number,title:string,kind:string,detail:string}>, counts: Record<string,number>, checked: number }}
 */
export function checkHealth(entries, now = new Date()) {
  const findings = [];
  const byPassword = new Map();
  for (const e of entries) {
    if (e.password) byPassword.set(e.password, [...(byPassword.get(e.password) || []), e]);
  }
  for (const e of entries) {
    const title = e.title || '(no title)';
    if (!e.password) { findings.push({ entryId: e.id, title, kind: 'missing', detail: KINDS.missing.fix }); continue; }
    const same = byPassword.get(e.password);
    if (same.length > 1) {
      const others = same.filter((x) => x.id !== e.id).map((x) => x.title || '(no title)');
      findings.push({ entryId: e.id, title, kind: 'reused', detail: `Same password as ${others.slice(0, 3).join(', ')}${others.length > 3 ? ` and ${others.length - 3} more` : ''}. ${KINDS.reused.fix}` });
    }
    const s = estimateStrength(e.password);
    if (s.level <= 1) findings.push({ entryId: e.id, title, kind: 'weak', detail: `${s.label} (${e.password.length} characters). ${KINDS.weak.fix}` });
    const since = new Date(e.passwordChangedAt || e.createdAt || now);
    const days = Math.floor((now - since) / DAY);
    if (Number.isFinite(days) && days > OLD_AFTER_DAYS) findings.push({ entryId: e.id, title, kind: 'old', detail: `Last changed ${Math.floor(days / 30)} months ago. ${KINDS.old.fix}` });
  }
  findings.sort((a, b) => KINDS[a.kind].rank - KINDS[b.kind].rank || a.title.localeCompare(b.title));
  const counts = { reused: 0, weak: 0, old: 0, missing: 0 };
  for (const f of findings) counts[f.kind]++;
  return { findings, counts, checked: entries.length };
}
