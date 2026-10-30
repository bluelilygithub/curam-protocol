'use strict';

// Email Follow-Up: a commitments ledger built on cases a person opens by hand (docs/email-follow-up-context.md,
// rules in docs/email-follow-up-case-model.md). Mounted at /api/email-follow-up behind requireFeature('emailFollowUp').
// It complements Gmail Intel / Invoice Review / the CRM: it reads Gmail through the existing read-only connection and
// never sends, drafts or files mail. Drafts are text for the person to copy into their own mail program.

const express = require('express');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');
const { aiLimiter } = require('../middleware/aiRateLimit');
const { RuleError } = require('../services/emailFollowUp/common');
const ledgerLib = require('../services/emailFollowUp/ledger');
const gates = require('../services/emailFollowUp/gates');
const { checkDraft } = require('../services/emailFollowUp/guard');
const approvalLib = require('../services/emailFollowUp/approval');
const { buildNudgeDraft } = require('../services/emailFollowUp/draft');
const { coverageStatement } = require('../services/emailFollowUp/coverage');
const { extractFromSource } = require('../services/emailFollowUp/extract');
const store = require('../services/emailFollowUp/caseStore');
const { resolveUserTimezone } = require('../services/fitness/timezone');

const router = express.Router();
const log = () => { try { return getLogger(); } catch { return console; } };

const DRAFT_CAP = 5;            // Rule 8.1: unreviewed drafts per case before drafting stops
const EXTRACT_BATCH = 10;       // messages read per press, to keep one request short

function fail(res, err) {
  if (err instanceof RuleError) return res.status(409).json({ error: err.message, rule: err.rule });
  if (err && err.status) return res.status(err.status).json({ error: err.message });
  if (/Gmail not connected/i.test(String(err && err.message))) return res.status(400).json({ error: 'Connect Gmail first (Settings, or the Gmail page).' });
  log().error({ err: err && err.message }, '[email-follow-up] request failed');
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

async function loadCase(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'Bad case id.' }); return null; }
  const c = await store.getCase(req.user.id, id);
  if (!c) { res.status(404).json({ error: 'Case not found.' }); return null; }
  return c;
}

function guardSourcesOf(sources) {
  const map = {};
  for (const s of sources) {
    map[s.id] = { id: s.id, versionHash: s.contentHash, supersededBy: null, parseStatus: s.parseStatus, text: s.text || '', ocr: /tesseract/.test(s.parser || '') };
  }
  return map;
}

function sourceLabel(s) {
  const who = String(s.fromAddr || '').replace(/<.*>/, '').trim() || 'unknown sender';
  if (s.kind === 'document') return `Attachment "${s.filename || 'file'}" (${s.channel === 'sent' ? 'sent' : 'from'} ${who}${s.subject ? `: ${s.subject}` : ''})`;
  return `${s.channel === 'sent' ? 'Sent' : 'From'} ${who}${s.subject ? `: ${s.subject}` : ''}`;
}

function nextRowId(ledger) {
  const max = ledger.reduce((m, r) => Math.max(m, Number(String(r.id).replace(/\D/g, '')) || 0), 0);
  let n = max;
  return () => { n += 1; return `r${n}`; };
}

function coverageOf(c, sources, sweep) {
  const attach = sources.reduce((n, s) => n + (s.kind !== 'document' && Array.isArray(s.attachments) ? s.attachments.length : 0), 0);
  return coverageStatement({
    sources: sources.map((s) => ({ id: s.id, kind: s.kind, label: sourceLabel(s), parseStatus: s.parseStatus, parseReason: s.parseReason, parser: s.parser, receivedAt: s.receivedAt ? new Date(s.receivedAt).toISOString() : null })),
    rows: c.ledger,
    sentWatermark: sweep,
    governing: c.governing || [],
    attachmentCount: attach,
  });
}

// ---------- drafts (named routes first) ----------

async function guardFor(c, sources, content, sweep) {
  const notes = content.notes || [];
  const row = c.ledger.find((r) => r.id === content.rowIds[0]);
  const res = checkDraft(content, { sources: guardSourcesOf(sources), profile: c.profile, row, notes });
  return { verdict: res.verdict, results: res.results, reasons: res.reasons };
}

router.post('/drafts/:draftId/approve', async (req, res) => {
  try {
    const draft = await store.getDraft(req.user.id, Number(req.params.draftId));
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });
    if (draft.status !== 'pending') return res.status(409).json({ error: `This draft is ${draft.status}.` });
    const c = await store.getCase(req.user.id, draft.caseId);
    const sources = await store.listSources(c.id, { withText: true });
    const content = { ...draft.content, id: draft.id, version: draft.version };
    const g = await guardFor(c, sources, content, null);
    if (g.verdict === 'fail') return res.status(409).json({ error: 'The guard failed this draft. It cannot be approved.', verdict: g });

    const accepted = Array.isArray(req.body?.acceptedWarnings) ? req.body.acceptedWarnings : [];
    const acceptedKeys = new Set(accepted.map((w) => `${w.index}:${w.code}`));
    const open = g.results.filter((r) => r.verdict === 'needs_review');
    const stuck = open.find((r) => r.code === 'SUPERSEDED_VERSION');
    if (stuck) return res.status(409).json({ error: stuck.question || stuck.message, verdict: g });
    const missing = open.filter((r) => !acceptedKeys.has(`${r.index}:${r.code}`));
    if (missing.length) return res.status(409).json({ error: 'Read each warning and accept it before approving.', needsAcceptance: missing, verdict: g });

    const rec = approvalLib.approve(content, { userId: req.user.id, at: new Date().toISOString(), acceptedWarnings: open.map((r) => ({ index: r.index, code: r.code })) });
    await store.addApproval(draft.id, draft.version, rec.hash, 'approved', req.user.id, rec.acceptedWarnings);
    await store.setDraftStatus(draft.id, 'approved');
    res.json({ ok: true, hash: rec.hash });
  } catch (err) { fail(res, err); }
});

router.post('/drafts/:draftId/decline', async (req, res) => {
  try {
    const draft = await store.getDraft(req.user.id, Number(req.params.draftId));
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });
    await store.addApproval(draft.id, draft.version, draft.hash, 'declined', req.user.id, []);
    await store.setDraftStatus(draft.id, 'declined');
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// Copy-time check (Rule 9.4): live Gmail read for new mail in the threads this draft cites. If Gmail cannot be read the answer is no.
router.post('/drafts/:draftId/copy', async (req, res) => {
  try {
    const draft = await store.getDraft(req.user.id, Number(req.params.draftId));
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });
    const content = { ...draft.content, id: draft.id, version: draft.version };
    const approval = draft.status === 'approved' ? await store.latestApproval(draft.id) : null;
    let inboundSince = [];
    try {
      const owner = await store.ownerEmail(req.user.id);
      inboundSince = await store.freshInbound(req.user.id, content.threadIds || [], draft.createdAt, [], owner);
    } catch (err) {
      return res.status(502).json({ ok: false, reason: 'Could not check Gmail for new mail, so this draft cannot be released. Try again.', detail: String(err.message).slice(0, 160) });
    }
    const check = approvalLib.checkAtCopy(approval, content, inboundSince);
    if (!check.ok) {
      if (draft.status === 'approved') await store.setDraftStatus(draft.id, 'pending');
      return res.status(409).json({ ok: false, status: 'pending', rule: check.rule, reason: check.reason });
    }
    res.json({ ok: true, to: content.to, cc: content.cc, subject: content.subject, body: content.body, hash: check.hash });
  } catch (err) { fail(res, err); }
});

// Any change mints a new version and resets to pending (Rule 9.2). Only recipients and subject are editable: the body IS the cited claims.
router.patch('/drafts/:draftId', async (req, res) => {
  try {
    const draft = await store.getDraft(req.user.id, Number(req.params.draftId));
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });
    if (draft.status === 'replaced' || draft.status === 'declined') return res.status(409).json({ error: `This draft is ${draft.status}.` });
    const c = await store.getCase(req.user.id, draft.caseId);
    const next = { ...draft.content };
    if (req.body?.subject !== undefined) next.subject = String(req.body.subject).slice(0, 300);
    for (const f of ['to', 'cc']) {
      if (req.body?.[f] !== undefined) {
        const list = store.cleanAliases(req.body[f]);
        if (String(req.body[f]).trim() && Array.isArray(req.body[f]) && req.body[f].length && !list.length) return res.status(400).json({ error: `Check the ${f} addresses.` });
        next[f] = list;
      }
    }
    next.notes = (next.notes || []).filter((n) => n.code !== 'NO_RECIPIENT' || !next.to.length);
    const sources = await store.listSources(c.id, { withText: true });
    const version = draft.version + 1;
    const content = { ...next, id: null, version };
    const verdict = await guardFor(c, sources, content, null);
    const created = await store.insertDraft(req.user.id, c.id, draft.rowId, next, approvalLib.draftHash(content), verdict, { version, previousId: draft.id });
    await store.setDraftStatus(draft.id, 'replaced');
    res.json({ draft: created });
  } catch (err) { fail(res, err); }
});

// ---------- cases ----------

router.get('/', async (req, res) => {
  try { res.json({ cases: await store.listCases(req.user.id) }); } catch (err) { fail(res, err); }
});

router.post('/', async (req, res) => {
  try {
    const input = gates.createCase(req.body || {}, { type: 'human' }); // Rule 1.1: a person opens a case, naming the obligation
    const c = await store.insertCase(req.user.id, input, { aliases: req.body.aliases, clientId: Number(req.body.clientId) || null, projectId: Number(req.body.projectId) || null });
    res.status(201).json({ case: c });
  } catch (err) { fail(res, err); }
});

router.get('/:id', async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const [sources, drafts, sweep] = await Promise.all([store.listSources(c.id), store.listDrafts(c.id), store.latestSweep(c.id)]);
    res.json({
      case: { ...c, ledger: undefined },
      rows: c.ledger,
      sources: sources.map((s) => ({ ...s, label: sourceLabel(s) })),
      drafts,
      sentSweep: sweep,
      coverage: coverageOf(c, sources, sweep),
      draftCap: DRAFT_CAP,
    });
  } catch (err) { fail(res, err); }
});

router.patch('/:id', async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    res.json({ case: await store.patchCase(req.user.id, c.id, req.body || {}) });
  } catch (err) { fail(res, err); }
});

// Suggestions only (Rule 1.2): the person accepts a thread one by one.
router.get('/:id/suggestions', async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const sources = await store.listSources(c.id);
    const attached = [...new Set(sources.map((s) => s.threadId).filter(Boolean))];
    res.json({ threads: await store.suggestThreads(req.user.id, c, attached) });
  } catch (err) { fail(res, err); }
});

// Read-only preview of a thread before attaching it. Stores nothing.
router.get('/:id/threads/:threadId/preview', async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const threadId = String(req.params.threadId || '');
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(threadId)) return res.status(400).json({ error: 'Bad thread.' });
    res.json({ messages: await store.previewThread(req.user.id, threadId) });
  } catch (err) { fail(res, err); }
});

router.post('/:id/threads', async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const threadId = String(req.body?.threadId || '').trim();
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(threadId)) return res.status(400).json({ error: 'Choose a thread.' });
    res.json(await store.attachThread(req.user.id, c.id, threadId));
  } catch (err) { fail(res, err); }
});

// Downloads the attachments of the attached messages (read-only) and reads their text. Press again if it says some remain.
router.post('/:id/attachments', async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    res.json(await store.fetchAttachments(req.user.id, c));
  } catch (err) { fail(res, err); }
});

// Reads the not-yet-read messages into the ledger. The model only proposes; code validates, anchors and files.
router.post('/:id/extract', aiLimiter, async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const { timezone } = await resolveUserTimezone(req.user.id);
    const owner = await store.ownerEmail(req.user.id);
    const sources = (await store.listSources(c.id, { withText: true })).filter((s) => !s.extractedAt && s.parseStatus === 'parsed' && s.channel !== 'note');
    let ledger = c.ledger;
    const newId = nextRowId(ledger);
    const summary = { read: 0, added: 0, evidence: 0, superseded: 0, conflicts: 0, dropped: [], remaining: Math.max(0, sources.length - EXTRACT_BATCH) };

    for (const s of sources.slice(0, EXTRACT_BATCH)) {
      const out = await extractFromSource(req.user.id, { ...s, receivedAt: s.receivedAt ? new Date(s.receivedAt).toISOString() : new Date().toISOString() }, { tz: timezone, ownerEmail: owner, obligation: c.obligation });
      for (const m of out.mentions) {
        const r = ledgerLib.applyMention(ledger, m, { newId });
        ledger = r.rows;
        if (r.action === 'new') summary.added += 1;
        else if (r.action === 'conflict') summary.conflicts += 1;
        else if (r.action === 'evidence') summary.evidence += 1;
        else summary.superseded += 1;
      }
      summary.dropped.push(...out.dropped.map((d) => ({ ...d, source: s.id })));
      await store.markExtracted(s.id);
      summary.read += 1;
    }
    await store.saveLedger(c.id, ledger);
    res.json({ ...summary, rows: ledger });
  } catch (err) { fail(res, err); }
});

router.post('/:id/sent-sweep', async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    res.json(await store.runSentSweep(req.user.id, c));
  } catch (err) { fail(res, err); }
});

// ---------- ledger rows ----------

async function saveRow(c, rowId, next) {
  const ledger = c.ledger.map((r) => (r.id === rowId ? next : r));
  await store.saveLedger(c.id, ledger);
  return ledger;
}

router.post('/:id/rows/:rowId/event', async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const row = c.ledger.find((r) => r.id === req.params.rowId);
    if (!row) return res.status(404).json({ error: 'Row not found.' });
    const type = String(req.body?.type || '');
    // Only human actions are offered here: closing, waiving, confirming authority, asserting a condition was met.
    if (!['human_close', 'waive', 'confirm_authority', 'condition_met'].includes(type)) return res.status(400).json({ error: 'Unknown action.' });
    const event = { type, note: String(req.body?.note || '').slice(0, 500), by: req.body?.by || 'human_note', humanNote: String(req.body?.note || '').slice(0, 500) };
    const t = ledgerLib.transition(row, event);
    if (!t.ok) return res.status(409).json({ error: t.reason, rule: t.rule });
    const ledger = ledgerLib.clearConflict(c.ledger.map((r) => (r.id === row.id ? t.row : r)), row.id);
    await store.saveLedger(c.id, ledger);
    res.json({ row: ledger.find((r) => r.id === row.id) });
  } catch (err) { fail(res, err); }
});

// Rule 3.3: someone else says they have taken it over. The original is suspended; the new row is unconfirmed.
router.post('/:id/rows/:rowId/substitute', async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const party = String(req.body?.party || '').trim();
    const sourceId = Number(req.body?.sourceId);
    const quote = String(req.body?.quote || '').trim();
    if (!party) return res.status(400).json({ error: 'Who took it over?' });
    const src = await store.getSource(c.id, sourceId);
    if (!src) return res.status(400).json({ error: 'Pick the message where they said so.' });
    const { locateQuote } = require('../services/emailFollowUp/extract');
    const { spanHash, sha256 } = require('../services/emailFollowUp/common');
    const where = locateQuote(src.text, quote);
    if (!where) return res.status(400).json({ error: 'That wording is not word for word in the message.' });
    const exact = src.text.slice(where.start, where.end);
    const anchor = { sourceId: src.id, versionHash: sha256(src.text), locator: { start: where.start, end: where.end }, spanHash: spanHash(exact) };
    const out = ledgerLib.suspendForSubstitute(c.ledger, req.params.rowId, { party, sourceId: src.id, quote: exact, anchor }, { newId: nextRowId(c.ledger) });
    await store.saveLedger(c.id, out.rows);
    res.json({ rows: out.rows });
  } catch (err) { fail(res, err); }
});

// Optional bridge to the existing Tasks module (one direction only; the ledger stays the record of what was promised).
router.post('/:id/rows/:rowId/task', async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const row = c.ledger.find((r) => r.id === req.params.rowId);
    if (!row) return res.status(404).json({ error: 'Row not found.' });
    if (row.taskId) return res.status(409).json({ error: 'A task already exists for this row.' });
    const title = `${row.direction === 'i_owe' ? 'Deliver' : 'Chase'}: ${row.items.join(', ')} (${row.partyLabel || row.party})`.slice(0, 200);
    const due = row.due && row.due.status === 'exact' ? row.due.date : null;
    const { rows } = await pool.query(
      `INSERT INTO tasks (title, notes, status, priority, "dueDate", "clientId", "userId", "updatedAt")
       VALUES ($1,$2,'todo','medium',$3,$4,$5,NOW()) RETURNING id`,
      [title, `From Email Follow-Up case "${c.title}". Source wording: "${row.quote || ''}"`, due, c.clientId || null, req.user.id]);
    const next = { ...row, taskId: rows[0].id };
    await saveRow(c, row.id, next);
    res.status(201).json({ taskId: rows[0].id, row: next });
  } catch (err) { fail(res, err); }
});

// ---------- drafting ----------

router.post('/:id/rows/:rowId/draft', async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const row = c.ledger.find((r) => r.id === req.params.rowId);
    if (!row) return res.status(404).json({ error: 'Row not found.' });
    const sources = await store.listSources(c.id, { withText: true });
    const sweep = await store.latestSweep(c.id);

    const can = gates.canDraft({ row, watermark: sweep, now: new Date().toISOString(), pendingDrafts: await store.pendingDraftCount(c.id), cap: DRAFT_CAP, sentLinks: [] });
    if (!can.ok) return res.status(409).json({ error: can.blocks.map((b) => b.reason).join(' '), blocks: can.blocks });

    const email = store.EMAIL_RE.test(String(row.party)) ? String(row.party).toLowerCase() : ((c.aliases || []).length === 1 ? c.aliases[0] : null);
    const cited = row.anchors.map((a) => sources.find((s) => s.id === a.sourceId)).filter(Boolean);
    const last = cited[cited.length - 1];
    const draft = buildNudgeDraft(row, {
      to: email ? [email] : [],
      subject: last && last.subject ? `Re: ${String(last.subject).replace(/^re:\s*/i, '')}` : undefined,
      inReplyTo: last && last.messageIdHeader ? last.messageIdHeader : null,
      references: last && last.messageIdHeader ? [last.messageIdHeader] : [],
      threadIds: [...new Set(cited.map((s) => s.threadId).filter(Boolean))],
    });

    // Notes that belong to the whole draft (Rule 10: Sent since the request; and a missing recipient).
    const notes = [];
    const since = row.requestDate ? new Date(row.requestDate).getTime() : 0;
    const sentTo = sources.filter((s) => s.channel === 'sent' && s.receivedAt && new Date(s.receivedAt).getTime() > since
      && (email ? String(s.toAddr || '').toLowerCase().includes(email) : (c.aliases || []).some((a) => String(s.toAddr || '').toLowerCase().includes(a))));
    if (sentTo.length) {
      notes.push({ index: -2, verdict: 'needs_review', code: 'SENT_SINCE', rule: '10',
        message: `You have sent ${sentTo.length} message${sentTo.length === 1 ? '' : 's'} to this person since the request (${sentTo.slice(0, 3).map((s) => `"${s.subject || 'no subject'}"`).join(', ')}). Check none already answers this.` });
    }
    if (!draft.to.length) notes.push({ index: -3, verdict: 'needs_review', code: 'NO_RECIPIENT', rule: '9.1', message: 'No recipient address is known for this person. Add one with Edit before copying.' });
    draft.notes = notes;

    const content = { ...draft, id: null, version: 1 };
    const verdict = await guardFor(c, sources, content, sweep);
    const created = await store.insertDraft(req.user.id, c.id, row.id, draft, approvalLib.draftHash(content), verdict);
    res.status(201).json({ draft: created });
  } catch (err) { fail(res, err); }
});

module.exports = router;
