# Gmail routing (Shop/Deliveries)

Added 2026-10-31. Admin-configurable label/query for segregated ingestion of shipping/delivery emails.

## What it is
- New table `gmail_routing_rules` (global). Rule type `shop` defaults to label `Deliveries/ToProcess` with a broad from:(...) query.
- Admin API: `GET/PUT /api/admin/gmail-routing` (admin only).
- Admin UI: **Admin > Gmail Ingestion (Shop/Deliveries)** panel to toggle enabled, edit label to poll, and edit the Gmail query.
- Gmail helper: `fetchInboxEmails` now accepts `useShopRule: true`. When enabled, it uses `label:${label}` (and ANDs the custom query) instead of `labelIds: ['INBOX']`.
- New route: `GET /api/gmail/shop/ingest` to poll only shop/delivery emails using the configured rule.

## Why
Prevents shipping emails from mixing with general inbox polling. The Gmail UI filter remains the safety net (labeling still happens there). The app setting is the source of truth for what the agent polls.

## Files changed
- `server/db.js` — create table + seed `shop` rule
- `server/routes/admin.js` — GET/PUT endpoints + default query
- `server/routes/gmail.js` — `getShopGmailRule()` cache, `fetchInboxEmails` supports `useShopRule`, `GET /shop/ingest`
- `client/src/pages/AdminPage.jsx` — Gmail Ingestion panel

## Usage
1. Create labels/filters in Gmail UI as before (Apply label `Deliveries/ToProcess`), or use this setting. 
2. Go to Admin > Gmail Ingestion (Shop/Deliveries) and tweak label/query if needed.
3. Have ingestion call `GET /api/gmail/shop/ingest` or pass `useShopRule: true` to `fetchInboxEmails`.
4. After processing, move/remove labels as appropriate (existing flow unchanged).

## Notes
- Cached for 60s so toggles take effect quickly without restart.
- Only the shop ingestion path uses the rule; `/api/gmail/inbox/classify` remains unchanged.
- Belt and suspenders: keep the Gmail UI filter enabled.
