# Shares accountant pack

One download for the accountant covering a financial year of the private share portfolio: **Shares → Accountant pack** (PDF, Excel, or a zip with both plus the source documents). Built 2026-10-23 on the same rails as the Finance FY pack.

## What is in it

Tax summary (capital gains working, dividends by holding) · Capital gains: sold parcels (FIFO, trade date) · Dividends received (gross, tax withheld, net, whether gross is from a statement or derived) · Trades in the year (with brokerage) · Holdings at 30 June (cost base, replayed from the trades up to the year end) · Observations and data checks · Source documents. The Excel workbook adds a **Data - All trades** sheet (every trade on record, all years).

The **Observations** page is generated from the data (method, brokerage, derived gross, effective withholding by holding and the W-8BEN note when about 30% was withheld, franking not recorded, cash ledger holds dividends only, CGT warnings) followed by the owner's own lines, saved in Settings key `shares_pack_notes` from the box on the tab.

## How it works

- `server/services/sharesPack/collect.js`: `buildSharesPack()` is pure (tested in `collect.test.js` with the figures from the CMC EOFY statement: net capital loss $7,523.33, dividends $98.97 net); `collectSharesPack(userId, fy)` loads trades, ledger, documents and notes. Capital gains come from `sharesCgt.js`, the same code as the CGT tab.
- It returns the Finance pack's normalized report shape, so `server/services/financePack/pdf.js` and `xlsx.js` render it unchanged. Two small generalisations there: a cover with `hideChecks` / no GST lines, and `pack.dataSheets` for the Excel raw data (Finance still builds its own).
- `server/routes/sharesPack.js` at `/api/shares/pack/preview|pdf|xlsx|zip?fy=2025-26[&documents=1]`; one build per user at a time.
- `server/routes/sharesDocuments.js` at `/api/shares/documents` (list, upload, file, delete): table `share_documents`, files under `UPLOAD_DIR/shares-docs/<userId>/`. Deliberately separate from Finance → Documents: the private trading account is not part of the business books. The Shares statement importer still deletes its uploaded PDF after reading, so the EOFY statement must be added here too.
- Client: `client/src/components/shares/SharesPackTab.jsx` (tab "Accountant pack" in `SharesPage.jsx`).

## Accountant login

Admin → Accountant access → **Shares: off/on** per accountant (see `server/services/accountantAccess.js`). When on, the accountant can read this tab and download the pack but not upload, delete or edit notes. Their downloads are logged as exports.

## Not built

Franking credits; prior-year capital losses; market value at 30 June (the broker statement has it); a CSV of the pack; reading the broker EOFY statement into the app.
