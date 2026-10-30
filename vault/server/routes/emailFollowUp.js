'use strict';

// Email Follow-Up: a commitments ledger built on cases a person opens by hand (docs/email-follow-up-context.md,
// rules in docs/email-follow-up-case-model.md). Mounted at /api/email-follow-up behind requireFeature('emailFollowUp').
// It complements Gmail Intel / Invoice Review / the CRM: it reads Gmail through the existing read-only connection and
// never sends, drafts or files mail. Drafts are text for the person to copy into their own mail program.

const express = require('express');
const { getLogger } = require('../middleware/requestContext');
const rateLimit = require('express-rate-limit');
const { aiLimiter } = require('../middleware/aiRateLimit');
const { RuleError } = require('../services/emailFollowUp/common');
const ledgerLib = require('../services/emailFollowUp/ledger');
const gates = require('../services/emailFollowUp/gates');
const { checkDraft } = require('../services/emailFollowUp/guard');
const approvalLib = require('../services/emailFollowUp/approval');
const { buildNudgeDraft } = require('../services/emailFollowUp/draft');
const { coverageStatement } = require('../services/emailFollowUp/coverage');
const extractMod = require('../services/emailFollowUp/extract'); // called as extractMod.extractFromSource so a test can stand in for the model
const store = require('../services/emailFollowUp/caseStore');
const { resolveUserTimezone } = require('../services/fitness/timezone');

const router = express.Router();
const log = () => { try { return getLogger(); } catch { return console; } };

// Every route that calls Gmail (looking for mail, previewing, attaching, fetching attachments, checking Sent, drafting, copying) is limited per
// person, so a stuck button or a script cannot burn through the Gmail quota. Reading into the ledger has its own limit (aiLimiter).
const gmailLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id || req.ip),
  message: { error: 'Too many requests to Gmail, please wait a minute.' },
});

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
  // attachments on messages the Get attachments step has not finished, less the ones already recorded for that message
  const notFetched = sources.reduce((n, s) => {
    if (s.kind === 'document' || s.attachmentsFetchedAt || !Array.isArray(s.attachments) || !s.attachments.length) return n;
    return n + Math.max(0, s.attachments.length - sources.filter((d) => d.parentId === s.id).length);
  }, 0);
  return coverageStatement({
    sources: sources.map((s) => ({ id: s.id, kind: s.kind, label: sourceLabel(s), parseStatus: s.parseStatus, parseReason: s.parseReason, parser: s.parser, receivedAt: s.receivedAt ? new Date(s.receivedAt).toISOString() : null })),
    rows: c.ledger,
    sentWatermark: sweep,
    governing: c.governing || [],
    attachmentsNotFetched: notFetched,
  });
}

// ---------- drafts (named routes first) ----------

function guardFor(c, sources, content) {
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
    const g = guardFor(c, sources, content);
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
router.post('/drafts/:draftId/copy', gmailLimiter, async (req, res) => {
  try {
    const draft = await store.getDraft(req.user.id, Number(req.params.draftId));
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });
    const content = { ...draft.content, id: draft.id, version: draft.version };
    const approval = draft.status === 'approved' ? await store.latestApproval(draft.id) : null;

    // The guard is run again now, under the case's CURRENT checking: an approval does not outlive a source that has since become unreadable,
    // or a warning the person never saw. Anything open now that was not accepted at approval sends the draft back to pending.
    if (approval) {
      const c = await store.getCase(req.user.id, draft.caseId);
      const g = guardFor(c, await store.listSources(c.id, { withText: true }), content);
      const accepted = new Set((approval.acceptedWarnings || []).map((w) => `${w.index}:${w.code}`));
      const unaccepted = g.results.filter((r) => r.verdict === 'needs_review' && !accepted.has(`${r.index}:${r.code}`));
      if (g.verdict === 'fail' || unaccepted.length) {
        await store.setDraftStatus(draft.id, 'pending');
        const why = g.verdict === 'fail' ? g.reasons[0] : unaccepted[0].message;
        return res.status(409).json({ ok: false, status: 'pending', rule: '7', reason: `The check has changed since you approved this: ${why}` });
      }
    }

    let inboundSince = [];
    try {
      const owner = await store.ownerEmail(req.user.id);
      inboundSince = await store.freshInbound(req.user.id, content.threadIds || [], draft.createdAt, owner);
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
    const verdict = guardFor(c, sources, content);
    const created = await store.insertDraft(req.user.id, c.id, draft.rowId, next, approvalLib.draftHash(content), verdict, { version, previousId: draft.id });
    await store.setDraftStatus(draft.id, 'replaced');
    res.json({ draft: created });
  } catch (err) { fail(res, err); }
});

// ---------- cases ----------

router.get('/', async (req, res) => {
  try {
    const clientId = Number(req.query.clientId);
    res.json({ cases: await store.listCases(req.user.id, { clientId: Number.isInteger(clientId) && clientId > 0 ? clientId : null }) });
  } catch (err) { fail(res, err); }
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
      case: { ...c, ledger: undefined, clientName: await store.clientName(req.user.id, c.clientId) },
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
router.get('/:id/suggestions', gmailLimiter, async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const sources = await store.listSources(c.id);
    const attached = [...new Set(sources.map((s) => s.threadId).filter(Boolean))];
    res.json(await store.suggestThreads(req.user.id, c, attached)); // { threads, more }
  } catch (err) { fail(res, err); }
});

// Read-only preview of a thread before attaching it. Stores nothing.
router.get('/:id/threads/:threadId/preview', gmailLimiter, async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const threadId = String(req.params.threadId || '');
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(threadId)) return res.status(400).json({ error: 'Bad thread.' });
    res.json({ messages: await store.previewThread(req.user.id, threadId) });
  } catch (err) { fail(res, err); }
});

router.post('/:id/threads', gmailLimiter, async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const threadId = String(req.body?.threadId || '').trim();
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(threadId)) return res.status(400).json({ error: 'Choose a thread.' });
    res.json(await store.attachThread(req.user.id, c.id, threadId));
  } catch (err) { fail(res, err); }
});

// Downloads the attachments of the attached messages (read-only) and reads their text. Press again if it says some remain.
router.post('/:id/attachments', gmailLimiter, async (req, res) => {
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
    const summary = { read: 0, added: 0, evidence: 0, superseded: 0, conflicts: 0, dropped: [], remaining: Math.max(0, sources.length - EXTRACT_BATCH), stopped: null };

    // One source at a time, each saved and marked read TOGETHER under the ledger lock. If the model fails on the seventh, the first six are
    // already kept, and pressing Read again carries on from the seventh. The slow model call is made outside the lock.
    for (const s of sources.slice(0, EXTRACT_BATCH)) {
      let out;
      try {
        out = await extractMod.extractFromSource(req.user.id, { ...s, receivedAt: s.receivedAt ? new Date(s.receivedAt).toISOString() : new Date().toISOString() }, { tz: timezone, ownerEmail: owner, obligation: c.obligation });
      } catch (err) {
        if (!summary.read) throw err;
        summary.stopped = err && err.message ? String(err.message).slice(0, 160) : 'the AI did not answer';
        break;
      }
      const counts = await store.withLedger(req.user.id, c.id, async (ledger, client) => {
        // A second press may have read this source while the model was thinking: then there is nothing to add.
        const { rows: cur } = await client.query('SELECT "extractedAt" FROM ef_sources WHERE id=$1 FOR UPDATE', [s.id]);
        if (!cur[0] || cur[0].extractedAt) return { value: null };
        let next = ledger;
        const newId = nextRowId(next);
        const n = { added: 0, evidence: 0, superseded: 0, conflicts: 0, dropped: out.dropped.map((d) => ({ ...d, source: s.id })) };
        for (const m of out.mentions) {
          try {
            const r = ledgerLib.applyMention(next, m, { newId });
            next = r.rows;
            if (r.action === 'new') n.added += 1;
            else if (r.action === 'conflict') n.conflicts += 1;
            else if (r.action === 'evidence') n.evidence += 1;
            else n.superseded += 1;
          } catch (err) {
            // one bad mention is dropped with its reason; it must not undo or block the rest of the source
            n.dropped.push({ reason: String(err.message).slice(0, 140), quote: String(m.quote || '').slice(0, 120), source: s.id });
          }
        }
        await client.query('UPDATE ef_sources SET "extractedAt"=NOW() WHERE id=$1', [s.id]);
        return { ledger: next, value: n };
      });
      if (!counts) continue;
      summary.added += counts.added; summary.evidence += counts.evidence; summary.superseded += counts.superseded; summary.conflicts += counts.conflicts;
      summary.dropped.push(...counts.dropped);
      summary.read += 1;
    }
    const fresh = await store.getCase(req.user.id, c.id);
    res.json({ ...summary, rows: fresh.ledger });
  } catch (err) { fail(res, err); }
});

router.post('/:id/sent-sweep', gmailLimiter, async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    res.json(await store.runSentSweep(req.user.id, c));
  } catch (err) { fail(res, err); }
});

// ---------- ledger rows ----------

// Every ledger change below goes through store.withLedger (row lock, one transaction): the row is looked up INSIDE it, so a change made by
// another request a moment ago is never overwritten.

router.post('/:id/rows/:rowId/event', async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const type = String(req.body?.type || '');
    // Only human actions are offered here: closing, waiving, confirming authority, asserting a condition was met.
    if (!['human_close', 'waive', 'confirm_authority', 'condition_met'].includes(type)) return res.status(400).json({ error: 'Unknown action.' });
    const event = { type, note: String(req.body?.note || '').slice(0, 500), by: req.body?.by || 'human_note', humanNote: String(req.body?.note || '').slice(0, 500) };
    const out = await store.withLedger(req.user.id, c.id, async (ledger) => {
      const row = ledger.find((r) => r.id === req.params.rowId);
      if (!row) return { value: { status: 404, error: 'Row not found.' } };
      const t = ledgerLib.transition(row, event);
      if (!t.ok) return { value: { status: 409, error: t.reason, rule: t.rule } };
      const next = ledgerLib.clearConflict(ledger.map((r) => (r.id === row.id ? t.row : r)), row.id);
      return { ledger: next, value: { row: next.find((r) => r.id === row.id) } };
    });
    if (out.error) return res.status(out.status).json({ error: out.error, rule: out.rule });
    res.json({ row: out.row });
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
    const rows = await store.withLedger(req.user.id, c.id, async (ledger) => {
      const out = ledgerLib.suspendForSubstitute(ledger, req.params.rowId, { party, sourceId: src.id, quote: exact, anchor }, { newId: nextRowId(ledger) });
      return { ledger: out.rows, value: out.rows };
    });
    res.json({ rows });
  } catch (err) { fail(res, err); }
});

// Optional bridge to the existing Tasks module (one direction only; the ledger stays the record of what was promised).
router.post('/:id/rows/:rowId/task', async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    // The task and the row's link to it are made in one transaction: no task without the link, no link without the task.
    const out = await store.withLedger(req.user.id, c.id, async (ledger, client) => {
      const row = ledger.find((r) => r.id === req.params.rowId);
      if (!row) return { value: { status: 404, error: 'Row not found.' } };
      if (row.taskId) return { value: { status: 409, error: 'A task already exists for this row.' } };
      const title = `${row.direction === 'i_owe' ? 'Deliver' : 'Chase'}: ${row.items.join(', ')} (${row.partyLabel || row.party})`.slice(0, 200);
      const due = row.due && row.due.status === 'exact' ? row.due.date : null;
      const { rows } = await client.query(
        `INSERT INTO tasks (title, notes, status, priority, "dueDate", "clientId", "userId", "updatedAt")
         VALUES ($1,$2,'todo','medium',$3,$4,$5,NOW()) RETURNING id`,
        [title, `From Email Follow-Up case "${c.title}". Source wording: "${row.quote || ''}"`, due, c.clientId || null, req.user.id]);
      const next = { ...row, taskId: rows[0].id };
      return { ledger: ledger.map((r) => (r.id === row.id ? next : r)), value: { taskId: rows[0].id, row: next } };
    });
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.status(201).json(out);
  } catch (err) { fail(res, err); }
});

// ---------- drafting ----------

router.post('/:id/rows/:rowId/draft', gmailLimiter, async (req, res) => {
  try {
    const c = await loadCase(req, res);
    if (!c) return;
    const row = c.ledger.find((r) => r.id === req.params.rowId);
    if (!row) return res.status(404).json({ error: 'Row not found.' });

    // Chasing someone needs a Sent check that reaches up to now (Rule 10.1). If the last one is stale, run it here rather than make the
    // person press another button: the rule stays strict, the friction goes. If it cannot be done, nothing is drafted.
    let sweep = await store.latestSweep(c.id);
    const chasing = row.direction === 'they_owe' || row.direction === 'external';
    if (chasing && (row.status === 'open') && !gates.sentSweepCovers(sweep, row.requestDate, new Date().toISOString())) {
      try {
        const ran = await store.runSentSweep(req.user.id, c);
        sweep = await store.latestSweep(c.id);
        // A big Sent folder takes several presses of Check Sent: it is not done yet, so nothing is drafted yet.
        if (!ran.completed) return res.status(409).json({ error: `Your Sent folder is large, so checking it takes a few steps (${ran.scanned} messages looked at so far). Press Check Sent until it says it is finished, then draft again.` });
      } catch (err) {
        if (err && err.status) return res.status(err.status).json({ error: err.message });
        return res.status(502).json({ error: 'Your Sent folder could not be checked just now, so nothing was drafted. Try again.', detail: String(err && err.message).slice(0, 140) });
      }
    }
    const sources = await store.listSources(c.id, { withText: true });

    // (The Sent-link branches in canDraft are rule-suite only; the app answers "did I already reply?" with the SENT_SINCE warning below.)
    const can = gates.canDraft({ row, watermark: sweep, now: new Date().toISOString(), pendingDrafts: await store.pendingDraftCount(c.id), cap: DRAFT_CAP });
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
    const verdict = guardFor(c, sources, content);
    const created = await store.insertDraft(req.user.id, c.id, row.id, draft, approvalLib.draftHash(content), verdict);
    res.status(201).json({ draft: created });
  } catch (err) { fail(res, err); }
});

module.exports = router;
