# Changelog

A log of bugs found and fixed in the Curam Vault application.

---

## 2026-04-15

**Issue:** Invoices (and other finance records) saved with wrong date — off by one day for Australian users.

**Root cause:** `todayStr()` in `FinancePage.jsx` used `new Date().toISOString().slice(0, 10)`, which returns the UTC date. In Australia (AEST = UTC+10), any time before 10am means the UTC date is still the previous day. This caused new invoices, expenses, wages, journal entries, and mark-paid dates to default to yesterday's local date.

**Solution:** Rewrote `todayStr()` to use local-time methods (`getFullYear()`, `getMonth()`, `getDate()`) so the returned `YYYY-MM-DD` string always reflects the user's local date, consistent with how the date range filter (`getPresetRange`) already worked.

---

## 2026-04-15

**Issue:** "Invoice created" toast fires but no invoice is saved to the database.

**Root cause:** Two problems working together. First, `BLANK_ITEM` initialises `unitPrice` as an empty string (`''`). The server computed correct numeric values but then passed the original `item.unitPrice` (still `''`) as a PostgreSQL parameter for a `NUMERIC(10,2)` column — PostgreSQL cannot cast an empty string to numeric and throws an error, rolling back the entire transaction. Second, `api.post` in `apiClient.js` only throws on 401 responses, so the 500 error was silently ignored and the success toast fired anyway.

**Solution:** Server now stores the parsed numeric values (`item._qty`, `item._up`) during the calculation loop and uses those in the INSERT — both POST and PUT invoice routes. Added `res.ok` checking in the frontend `save()` function so server errors surface as a visible error message instead of a false success toast.

---
