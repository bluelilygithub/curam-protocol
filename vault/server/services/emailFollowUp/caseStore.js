'use strict';

// Database and Gmail side of Email Follow-Up. The rules live in the pure modules next to this file; this file only
// loads, saves and fetches, and never decides anything the rules decide. Gmail is read-only here (gmail.readonly):
// nothing in this feature sends, drafts or files mail (case model §13).

const { pool } = require('../../db');
const { sha256 } = require('./common');
const { localDate } = require('./deadlines');
const { extractAttachmentText, planAttachment } = require('./attachmentText');

const EMAIL_RE = /^[^\s@()"<>,;]+@[^\s@()"<>,;]+\.[^\s@()"<>,;]+$/;
const MAX_SOURCE_CHARS = 60000;

function cleanAliases(list) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    const v = String(a || '').trim().toLowerCase();
    if (EMAIL_RE.test(v) && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 20);
}

// ---------- cases ----------

const CASE_COLS = `id, "userId", title, obligation, kind, profile, status, aliases, governing, ledger, "clientId", "projectId", "createdAt", "updatedAt"`;

async function listCases(userId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.obligation, c.kind, c.profile, c.status, c.aliases, c."clientId", c."projectId", c."createdAt", c."updatedAt",
            jsonb_array_length(c.ledger) AS "rowCount",
            (SELECT COUNT(*) FROM ef_drafts d WHERE d."caseId"=c.id AND d.status='pending') AS "pendingDrafts",
            (SELECT COUNT(*) FROM ef_sources s WHERE s."caseId"=c.id) AS "sourceCount"
       FROM ef_cases c WHERE c."userId"=$1 ORDER BY c."updatedAt" DESC LIMIT 200`, [userId]);
  return rows.map((r) => ({ ...r, rowCount: Number(r.rowCount), pendingDrafts: Number(r.pendingDrafts), sourceCount: Number(r.sourceCount) }));
}

async function getCase(userId, id) {
  const { rows } = await pool.query(`SELECT ${CASE_COLS} FROM ef_cases WHERE id=$1 AND "userId"=$2`, [id, userId]);
  return rows[0] || null;
}

async function insertCase(userId, c, extra) {
  const { rows } = await pool.query(
    `INSERT INTO ef_cases ("userId", title, obligation, kind, profile, status, aliases, governing, "clientId", "projectId")
     VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9) RETURNING ${CASE_COLS}`,
    [userId, c.title, c.obligation, c.kind, c.profile, JSON.stringify(cleanAliases(extra.aliases)), JSON.stringify(c.governing || []), extra.clientId || null, extra.projectId || null]);
  return rows[0];
}

async function saveLedger(caseId, ledger) {
  await pool.query(`UPDATE ef_cases SET ledger=$1, "updatedAt"=NOW() WHERE id=$2`, [JSON.stringify(ledger), caseId]);
}

async function patchCase(userId, id, patch) {
  const sets = [];
  const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (patch.title !== undefined) add('title', String(patch.title).trim().slice(0, 200));
  if (patch.aliases !== undefined) add('aliases', JSON.stringify(cleanAliases(patch.aliases)));
  if (patch.status !== undefined && ['active', 'closed', 'abandoned'].includes(patch.status)) add('status', patch.status);
  if (patch.profile !== undefined && ['soft', 'professional'].includes(patch.profile)) add('profile', patch.profile);
  if (patch.clientId !== undefined) add('"clientId"', patch.clientId || null);
  if (patch.projectId !== undefined) add('"projectId"', patch.projectId || null);
  if (!sets.length) return getCase(userId, id);
  vals.push(id, userId);
  const { rows } = await pool.query(
    `UPDATE ef_cases SET ${sets.join(', ')}, "updatedAt"=NOW() WHERE id=$${vals.length - 1} AND "userId"=$${vals.length} RETURNING ${CASE_COLS}`, vals);
  return rows[0] || null;
}

// ---------- sources ----------

async function listSources(caseId, { withText = false } = {}) {
  const { rows } = await pool.query(
    `SELECT id, kind, channel, "externalId", "threadId", subject, "fromAddr", "toAddr", "messageIdHeader", "receivedAt", "contentHash",
            ${withText ? 'text,' : ''} attachments, "parseStatus", "parseReason", "extractedAt",
            "parentId", filename, "mimeType", "sizeBytes", parser, "attachmentsFetchedAt"
       FROM ef_sources WHERE "caseId"=$1 ORDER BY "receivedAt" ASC NULLS LAST, id ASC`, [caseId]);
  return rows;
}

async function getSource(caseId, id) {
  const { rows } = await pool.query(`SELECT * FROM ef_sources WHERE "caseId"=$1 AND id=$2`, [caseId, id]);
  return rows[0] || null;
}

/** Store one message. Sources are immutable: the same external id is stored once. */
async function addSource(userId, caseId, s) {
  const text = String(s.text || '').slice(0, MAX_SOURCE_CHARS);
  const { rows } = await pool.query(
    `INSERT INTO ef_sources ("caseId","userId",kind,channel,"externalId","threadId",subject,"fromAddr","toAddr","messageIdHeader","receivedAt","contentHash",text,attachments,"parseStatus","parseReason","parentId",filename,"mimeType","sizeBytes",parser)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT ("caseId","externalId") WHERE "externalId" IS NOT NULL DO NOTHING
     RETURNING id`,
    [caseId, userId, s.kind || 'message', s.channel || 'inbound', s.externalId || null, s.threadId || null, s.subject || null, s.fromAddr || null, s.toAddr || null,
      s.messageIdHeader || null, s.receivedAt || null, sha256(text), text, JSON.stringify(s.attachments || []),
      s.parseStatus || 'parsed', s.parseReason || null, s.parentId || null, s.filename || null, s.mimeType || null, s.sizeBytes || null, s.parser || null]);
  return rows[0] ? { id: rows[0].id, created: true } : { id: null, created: false };
}

async function markExtracted(sourceId) {
  await pool.query(`UPDATE ef_sources SET "extractedAt"=NOW() WHERE id=$1`, [sourceId]);
}

// ---------- Gmail (read-only) ----------

function attachmentsOf(payload, out = []) {
  if (!payload) return out;
  if (payload.filename) out.push({ filename: payload.filename, mimeType: payload.mimeType, size: payload.body?.size || 0, attachmentId: payload.body?.attachmentId || null, partId: payload.partId || null });
  for (const p of payload.parts || []) attachmentsOf(p, out);
  return out;
}

function messageToSource(msg, { getHeader, extractBody }) {
  const headers = msg.payload?.headers || [];
  const labels = msg.labelIds || [];
  const attachments = attachmentsOf(msg.payload);
  return {
    kind: 'message',
    channel: labels.includes('SENT') ? 'sent' : 'inbound',
    externalId: msg.id,
    threadId: msg.threadId,
    subject: getHeader(headers, 'Subject') || '',
    fromAddr: getHeader(headers, 'From') || '',
    toAddr: [getHeader(headers, 'To'), getHeader(headers, 'Cc')].filter(Boolean).join(', '),
    messageIdHeader: getHeader(headers, 'Message-ID') || getHeader(headers, 'Message-Id') || null,
    receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
    text: extractBody(msg.payload) || '',
    attachments: attachments.map(({ filename, mimeType, size }) => ({ filename, mimeType, size })),
    parseStatus: 'parsed',
    parseReason: attachments.length ? `${attachments.length} attachment${attachments.length === 1 ? '' : 's'}: press "Get attachments" to read them` : null,
  };
}

function gmailHelpers() { return require('../../routes/gmail'); }

async function ownerEmail(userId) {
  const { rows } = await pool.query(`SELECT email FROM gmail_tokens WHERE "userId"=$1`, [userId]);
  return rows[0]?.email || null;
}

/** Attach every message of one Gmail thread to a case. A person chose this thread; nothing attaches itself. */
async function attachThread(userId, caseId, threadId) {
  const g = gmailHelpers();
  const gmail = await g.getGmailClient(userId);
  const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  let added = 0;
  const msgs = thread.data.messages || [];
  for (const m of msgs) {
    const r = await addSource(userId, caseId, messageToSource(m, g));
    if (r.created) added += 1;
  }
  return { messages: msgs.length, added };
}

/** Threads that look like they belong to a case, for the person to accept one by one (Rule 1.2). */
async function suggestThreads(userId, caseRow, attachedThreadIds) {
  const g = gmailHelpers();
  const gmail = await g.getGmailClient(userId);
  const aliases = caseRow.aliases || [];
  if (!aliases.length) return [];
  const q = `(${aliases.map((a) => `from:${a} OR to:${a}`).join(' OR ')})`;
  const list = await gmail.users.threads.list({ userId: 'me', q, maxResults: 15 });
  const out = [];
  for (const t of (list.data.threads || []).filter((x) => !attachedThreadIds.includes(x.id)).slice(0, 12)) {
    const full = await gmail.users.threads.get({ userId: 'me', id: t.id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
    const first = (full.data.messages || [])[0];
    const headers = first?.payload?.headers || [];
    out.push({
      threadId: t.id,
      snippet: t.snippet || '',
      subject: g.getHeader(headers, 'Subject') || '(no subject)',
      from: g.getHeader(headers, 'From') || '',
      date: first?.internalDate ? new Date(Number(first.internalDate)).toISOString() : null,
      messages: (full.data.messages || []).length,
    });
  }
  return out;
}

const ATT_MAX_DOWNLOADS = 12;      // files downloaded per press, to keep one request short
const ATT_BUDGET_MS = 50000;

/**
 * Turn the attachments of attached messages into their own sources (case model §2). Each file is downloaded from Gmail read-only,
 * its text taken by attachmentText.js (PDF text layer, Word, plain text), and stored as a document hanging off its message. Files that
 * cannot be read are still recorded, with the reason, so the coverage statement can list them. Stops at a budget; press again for more.
 */
async function fetchAttachments(userId, caseRow) {
  const g = gmailHelpers();
  const gmail = await g.getGmailClient(userId);
  const { rows: msgs } = await pool.query(
    `SELECT id, channel, "externalId", "threadId", subject, "fromAddr", "toAddr", "messageIdHeader", "receivedAt"
       FROM ef_sources WHERE "caseId"=$1 AND "parentId" IS NULL AND kind='message' AND "attachmentsFetchedAt" IS NULL
        AND "externalId" IS NOT NULL AND jsonb_array_length(attachments) > 0
      ORDER BY "receivedAt" ASC NULLS LAST, id ASC`, [caseRow.id]);
  const out = { messages: 0, parsed: 0, referenceOnly: 0, failed: 0, downloaded: 0, remainingMessages: 0 };
  const started = Date.now();

  for (let i = 0; i < msgs.length; i += 1) {
    const m = msgs[i];
    if (out.downloaded >= ATT_MAX_DOWNLOADS || Date.now() - started > ATT_BUDGET_MS) { out.remainingMessages = msgs.length - i; break; }
    const full = await gmail.users.messages.get({ userId: 'me', id: m.externalId, format: 'full' });
    const parts = attachmentsOf(full.data.payload);
    const { rows: have } = await pool.query(`SELECT "externalId" FROM ef_sources WHERE "caseId"=$1 AND "parentId"=$2`, [caseRow.id, m.id]);
    const done = new Set(have.map((r) => r.externalId));

    for (const a of parts) {
      const externalId = `${m.externalId}#${a.filename}#${a.size}`;
      if (done.has(externalId)) continue;
      const plan = planAttachment(a);
      let r;
      if (!plan.fetch || !a.attachmentId) {
        r = { parseStatus: plan.parseStatus || 'reference_only', parseReason: plan.parseReason || 'no downloadable content', text: '', parser: null };
      } else {
        out.downloaded += 1;
        // A download that throws is left for the next press (the message is not marked done), never recorded as a failed file.
        const att = await gmail.users.messages.attachments.get({ userId: 'me', messageId: m.externalId, id: a.attachmentId });
        r = await extractAttachmentText({ filename: a.filename, mimeType: a.mimeType, buffer: Buffer.from(att.data.data || '', 'base64url') });
      }
      await addSource(userId, caseRow.id, {
        kind: 'document', channel: m.channel, externalId, threadId: m.threadId, subject: m.subject, fromAddr: m.fromAddr, toAddr: m.toAddr,
        messageIdHeader: m.messageIdHeader, receivedAt: m.receivedAt, parentId: m.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.size,
        text: r.text, parseStatus: r.parseStatus, parseReason: r.parseReason, parser: r.parser,
      });
      if (r.parseStatus === 'parsed') out.parsed += 1; else if (r.parseStatus === 'failed') out.failed += 1; else out.referenceOnly += 1;
    }
    await pool.query(`UPDATE ef_sources SET "attachmentsFetchedAt"=NOW(), "parseReason"=NULL WHERE id=$1`, [m.id]);
    out.messages += 1;
  }
  return out;
}

/** Read-only look at a thread before it is attached: nothing is stored. Bodies are cut short; attachments are listed by name only. */
async function previewThread(userId, threadId) {
  const g = gmailHelpers();
  const gmail = await g.getGmailClient(userId);
  const t = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  return (t.data.messages || []).slice(0, 30).map((m) => {
    const h = m.payload?.headers || [];
    return {
      from: g.getHeader(h, 'From') || '',
      to: g.getHeader(h, 'To') || '',
      subject: g.getHeader(h, 'Subject') || '',
      date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
      sent: (m.labelIds || []).includes('SENT'),
      body: String(g.extractBody(m.payload) || '').replace(/\r/g, '').trim().slice(0, 2500),
      attachments: attachmentsOf(m.payload).map((a) => a.filename),
    };
  });
}

/**
 * Rule 10.1: sweep Sent for this case, across every alias (Rule 10.3: scope is the case, never one party).
 * A failed sweep is recorded as not completed, which blocks drafting; it is never treated as "nothing found".
 */
async function runSentSweep(userId, caseRow) {
  const aliases = caseRow.aliases || [];
  if (!aliases.length) throw Object.assign(new Error('Add at least one address for the people in this case first.'), { status: 400 });
  const requestDates = (caseRow.ledger || []).map((r) => r.requestDate).filter(Boolean).map((d) => new Date(d).getTime());
  const fromMs = Math.min(new Date(caseRow.createdAt).getTime(), ...requestDates) - 24 * 3600 * 1000;
  const from = new Date(fromMs);
  const to = new Date();
  const g = gmailHelpers();
  let found = 0;
  try {
    const gmail = await g.getGmailClient(userId);
    const q = `in:sent (${aliases.map((a) => `to:${a} OR cc:${a}`).join(' OR ')}) after:${Math.floor(fromMs / 1000)}`;
    const ids = [];
    let pageToken;
    do {
      const res = await gmail.users.messages.list({ userId: 'me', q, maxResults: 100, pageToken });
      for (const m of res.data.messages || []) ids.push(m.id);
      pageToken = res.data.nextPageToken;
    } while (pageToken && ids.length < 300);
    if (pageToken) throw new Error('More than 300 sent messages in the window: narrow the case first.');
    for (const id of ids) {
      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const r = await addSource(userId, caseRow.id, messageToSource(msg.data, g));
      if (r.created) found += 1;
    }
    await pool.query(`INSERT INTO ef_sent_sweeps ("caseId","userId","fromAt","toAt",completed,found) VALUES ($1,$2,$3,$4,TRUE,$5)`, [caseRow.id, userId, from, to, found]);
    return { completed: true, from: from.toISOString(), to: to.toISOString(), found, scanned: ids.length };
  } catch (err) {
    await pool.query(`INSERT INTO ef_sent_sweeps ("caseId","userId","fromAt","toAt",completed,found,error) VALUES ($1,$2,$3,$4,FALSE,$5,$6)`, [caseRow.id, userId, from, to, found, String(err.message).slice(0, 300)]);
    throw err;
  }
}

async function latestSweep(caseId) {
  const { rows } = await pool.query(`SELECT id, "fromAt" AS "from", "toAt" AS "to", completed, found, error, "createdAt" FROM ef_sent_sweeps WHERE "caseId"=$1 ORDER BY id DESC LIMIT 1`, [caseId]);
  const w = rows[0];
  return w ? { completed: w.completed, from: w.from, to: w.to, found: w.found, error: w.error, at: w.createdAt } : null;
}

/** Copy-time check (Rule 9.4): mail in the cited threads newer than the draft, read live from Gmail. Fails closed. */
async function freshInbound(userId, threadIds, sinceIso, knownExternalIds, ownerAddr) {
  const g = gmailHelpers();
  const gmail = await g.getGmailClient(userId);
  const since = new Date(sinceIso).getTime();
  const out = [];
  for (const threadId of threadIds) {
    const t = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'metadata', metadataHeaders: ['From', 'Subject'] });
    for (const m of t.data.messages || []) {
      if (Number(m.internalDate) <= since) continue;
      const from = g.getHeader(m.payload?.headers || [], 'From') || '';
      if ((m.labelIds || []).includes('SENT') || (ownerAddr && from.toLowerCase().includes(ownerAddr.toLowerCase()))) continue;
      out.push({ id: m.id, from, threadId, receivedAt: new Date(Number(m.internalDate)).toISOString(), known: knownExternalIds.includes(m.id) });
    }
  }
  return out;
}

// ---------- drafts ----------

async function listDrafts(caseId) {
  const { rows } = await pool.query(
    `SELECT id, "rowId", version, "previousId", content, hash, verdict, status, "createdAt", "updatedAt"
       FROM ef_drafts WHERE "caseId"=$1 AND status <> 'replaced' ORDER BY id DESC LIMIT 100`, [caseId]);
  return rows;
}

async function getDraft(userId, id) {
  const { rows } = await pool.query(`SELECT * FROM ef_drafts WHERE id=$1 AND "userId"=$2`, [id, userId]);
  return rows[0] || null;
}

async function pendingDraftCount(caseId) {
  const { rows } = await pool.query(`SELECT COUNT(*) AS n FROM ef_drafts WHERE "caseId"=$1 AND status='pending'`, [caseId]);
  return Number(rows[0].n);
}

async function insertDraft(userId, caseId, rowId, content, hash, verdict, { version = 1, previousId = null } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO ef_drafts ("caseId","userId","rowId",version,"previousId",content,hash,verdict) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [caseId, userId, rowId, version, previousId, JSON.stringify(content), hash, JSON.stringify(verdict)]);
  return rows[0];
}

async function setDraftStatus(id, status) {
  await pool.query(`UPDATE ef_drafts SET status=$1, "updatedAt"=NOW() WHERE id=$2`, [status, id]);
}

async function addApproval(draftId, version, hash, decision, userId, acceptedWarnings) {
  const { rows } = await pool.query(
    `INSERT INTO ef_approvals ("draftId",version,hash,decision,"userId","acceptedWarnings") VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [draftId, version, hash, decision, userId, JSON.stringify(acceptedWarnings || [])]);
  return rows[0];
}

async function latestApproval(draftId) {
  const { rows } = await pool.query(`SELECT * FROM ef_approvals WHERE "draftId"=$1 ORDER BY id DESC LIMIT 1`, [draftId]);
  const a = rows[0];
  return a ? { draftId: a.draftId, version: a.version, hash: a.hash, decision: a.decision, userId: a.userId, acceptedWarnings: a.acceptedWarnings, at: a.createdAt } : null;
}

module.exports = {
  EMAIL_RE, cleanAliases, listCases, getCase, insertCase, saveLedger, patchCase,
  listSources, getSource, addSource, markExtracted,
  attachThread, suggestThreads, previewThread, fetchAttachments, runSentSweep, latestSweep, freshInbound, ownerEmail,
  listDrafts, getDraft, pendingDraftCount, insertDraft, setDraftStatus, addApproval, latestApproval,
  localDate,
};
