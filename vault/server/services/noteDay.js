'use strict';

// A calendar day as 'YYYY-MM-DD', used by Ask's date range and saved views. Pure (no database), unit-tested:
// node server/services/noteDay.test.js

/** 'YYYY-MM-DD' only when it is a real calendar day, else null. */
function validDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? m[0] : null;
}

module.exports = { validDay };
