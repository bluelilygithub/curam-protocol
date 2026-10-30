'use strict';

// Database and Gmail side of Email Follow-Up. The rules live in the pure modules next to this file; this file only
// loads, saves and fetches, and never decides anything the rules decide. Gmail is read-only here (gmail.readonly):
// nothing in this feature sends, drafts or files mail (case model §13).

const { pool } = require('../../db');
const { sha256 } = require('./common');
const { localDate } = require('./deadlines');
const { extractAttachmentText, planAttachment } = require('./attachmentText');
const { ocrPages } = require('./ocrPdf');

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

/** A person's cases, newest first. `clientId` narrows to the cases linked to one CRM client (the client page lists them). */
async function listCases(userId, { clientId = null } = {}) {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.obligation, c.kind, c.profile, c.status, c.aliases, c."clientId", c."projectId", c."createdAt", c."updatedAt",
            (SELECT cl.name FROM clients cl WHERE cl.id=c."clientId" AND cl."userId"=c."userId") AS "clientName",
            jsonb_array_length(c.ledger) AS "rowCount",
            (SELECT COUNT(*) FROM ef_drafts d WHERE d."caseId"=c.id AND d.status='pending') AS "pendingDrafts",
            (SELECT COUNT(*) FROM ef_sources s WHERE s."caseId"=c.id) AS "sourceCount"
       FROM ef_cases c WHERE c."userId"=$1 AND ($2::int IS NULL OR c."clientId"=$2) ORDER BY c."updatedAt" DESC LIMIT 200`, [userId, clientId]);
  return rows.map((r) => ({ ...r, rowCount: Number(r.rowCount), pendingDrafts: Number(r.pendingDrafts), sourceCount: Number(r.sourceCount) }));
}

async function clientName(userId, clientId) {
  if (!clientId) return null;
  const { rows } = await pool.query('SELECT name FROM clients WHERE id=$1 AND "userId"=$2', [clientId, userId]);
  return rows[0] ? rows[0].name : null;
}

async function getCase(userId, id) {
  const { rows } = await pool.query(`SELECT ${CASE_COLS} FROM ef_cases WHERE id=$1 AND "userId"=$2`, [id, userId]);
  return rows[0] || null;
}

/** A client or project id from the request must belong to this person (it is only a foreign key to a shared table). Returns the id or null. */
async function ownedLink(userId, table, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const { rows } = await pool.query(`SELECT id FROM ${table === 'projects' ? 'projects' : 'clients'} WHERE id=$1 AND "userId"=$2`, [n, userId]);
  if (!rows[0]) throw Object.assign(new Error(`That ${table === 'projects' ? 'project' : 'client'} was not found in your account.`), { status: 400 });
  return n;
}

async function insertCase(userId, c, extra) {
  const clientId = extra.clientId ? await ownedLink(userId, 'clients', extra.clientId) : null;
  const projectId = extra.projectId ? await ownedLink(userId, 'projects', extra.projectId) : null;
  const { rows } = await pool.query(
    `INSERT INTO ef_cases ("userId", title, obligation, kind, profile, status, aliases, governing, "clientId", "projectId")
     VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9) RETURNING ${CASE_COLS}`,
    [userId, c.title, c.obligation, c.kind, c.profile, JSON.stringify(cleanAliases(extra.aliases)), JSON.stringify(c.governing || []), clientId, projectId]);
  return rows[0];
}

/**
 * Read-modify-write of a case's ledger under a row lock, in one transaction. Every change to the ledger goes through here, so two
 * requests at once (a Read and a "Make a task", say) take turns instead of the later one overwriting the earlier. `fn(ledger, client)`
 * returns { ledger?, value }: a new ledger to save (omit to leave it alone) and what to hand back. Anything it does through `client`
 * (marking a source read, adding a task) commits or rolls back together with the ledger. Slow work (a model call) belongs OUTSIDE fn.
 */
async function withLedger(userId, caseId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT ledger FROM ef_cases WHERE id=$1 AND "userId"=$2 FOR UPDATE`, [caseId, userId]);
    if (!rows[0]) throw Object.assign(new Error('Case not found.'), { status: 404 });
    const out = await fn(rows[0].ledger || [], client);
    if (out && out.ledger) await client.query(`UPDATE ef_cases SET ledger=$1, "updatedAt"=NOW() WHERE id=$2`, [JSON.stringify(out.ledger), caseId]);
    await client.query('COMMIT');
    return out ? out.value : undefined;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function patchCase(userId, id, patch) {
  const sets = [];
  const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (patch.title !== undefined) add('title', String(patch.title).trim().slice(0, 200));
  if (patch.aliases !== undefined) add('aliases', JSON.stringify(cleanAliases(patch.aliases)));
  if (patch.status !== undefined && ['active', 'closed', 'abandoned'].includes(patch.status)) add('status', patch.status);
  let profileChanged = false;
  if (patch.profile !== undefined && ['soft', 'professional'].includes(patch.profile)) {
    const cur = await getCase(userId, id);
    profileChanged = !!cur && cur.profile !== patch.profile;
    add('profile', patch.profile);
  }
  if (patch.clientId !== undefined) add('"clientId"', patch.clientId ? await ownedLink(userId, 'clients', patch.clientId) : null);
  if (patch.projectId !== undefined) add('"projectId"', patch.projectId ? await ownedLink(userId, 'projects', patch.projectId) : null);
  if (!sets.length) return getCase(userId, id);
  vals.push(id, userId);
  const { rows } = await pool.query(
    `UPDATE ef_cases SET ${sets.join(', ')}, "updatedAt"=NOW() WHERE id=$${vals.length - 1} AND "userId"=$${vals.length} RETURNING ${CASE_COLS}`, vals);
  // An approval is only good under the checking it was given under: a stricter or looser profile sends approved drafts back for a fresh look.
  if (rows[0] && profileChanged) await pool.query(`UPDATE ef_drafts SET status='pending', "updatedAt"=NOW() WHERE "caseId"=$1 AND status='approved'`, [id]);
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
const FIND_SHOW = 12;        // threads shown per press
const FIND_SCAN_MAX = 200;   // Gmail threads looked through per press while finding that many unattached ones
const FIND_PAGE = 50;

async function suggestThreads(userId, caseRow, attachedThreadIds) {
  const g = gmailHelpers();
  const gmail = await g.getGmailClient(userId);
  const aliases = caseRow.aliases || [];
  if (!aliases.length) return { threads: [], more: false };
  const q = `(${aliases.map((a) => `from:${a} OR to:${a}`).join(' OR ')})`;
  const attached = new Set(attachedThreadIds);

  // Newest first, page by page, skipping what is already attached, until enough new ones are found. (Looking at only the newest 15 meant that
  // once those were attached, Find mail showed nothing however many older threads there were.)
  const picked = [];
  let scanned = 0;
  let pageToken;
  let more = false;
  do {
    const list = await gmail.users.threads.list({ userId: 'me', q, maxResults: FIND_PAGE, pageToken });
    const page = list.data.threads || [];
    for (const t of page) {
      scanned += 1;
      if (attached.has(t.id)) continue;
      if (picked.length < FIND_SHOW) picked.push(t);
      else more = true; // an unattached thread beyond the ones shown
    }
    pageToken = list.data.nextPageToken;
  } while (pageToken && picked.length < FIND_SHOW && scanned < FIND_SCAN_MAX);
  if (pageToken) more = true; // Gmail has older threads still not looked at

  const out = [];
  for (const t of picked) {
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
  return { threads: out, more };
}

const ATT_MAX_DOWNLOADS = 12;      // files downloaded per press, to keep one request short
const ATT_BUDGET_MS = 50000;
const ATT_MAX_OCR_FILES = 3;       // scanned files read by OCR per press (each can take many seconds)

/**
 * Turn the attachments of attached messages into their own sources (case model §2). Each file is downloaded from Gmail read-only,
 * its text taken by attachmentText.js (PDF text layer, OCR for scanned pages, Word, plain text), and stored as a document hanging off its message. Files that
 * cannot be read are still recorded, with the reason, so the coverage statement can list them. Stops at a budget; press again for more.
 */
async function fetchAttachments(userId, caseRow, deps = {}) {
  const g = gmailHelpers();
  const gmail = await g.getGmailClient(userId);
  // Before OCR existed, a scanned PDF was recorded as "no text layer ... (no OCR)" and its message marked done. Those records hold no
  // text and nothing refers to them, so drop them and let their message be read again, now with OCR. (Pictures are not matched.)
  await pool.query(
    `WITH old AS (
       DELETE FROM ef_sources WHERE "caseId"=$1 AND kind='document' AND "parseStatus"='reference_only' AND filename ILIKE '%.pdf'
          AND "parseReason" LIKE 'no text layer%(no OCR)' RETURNING "parentId")
     UPDATE ef_sources SET "attachmentsFetchedAt"=NULL WHERE id IN (SELECT "parentId" FROM old)`, [caseRow.id]);
  const { rows: msgs } = await pool.query(
    `SELECT id, channel, "externalId", "threadId", subject, "fromAddr", "toAddr", "messageIdHeader", "receivedAt"
       FROM ef_sources WHERE "caseId"=$1 AND "parentId" IS NULL AND kind='message' AND "attachmentsFetchedAt" IS NULL
        AND "externalId" IS NOT NULL AND jsonb_array_length(attachments) > 0
      ORDER BY "receivedAt" ASC NULLS LAST, id ASC`, [caseRow.id]);
  const out = { messages: 0, parsed: 0, referenceOnly: 0, failed: 0, downloaded: 0, ocr: 0, remainingMessages: 0 };
  const started = Date.now();
  const ocrOf = deps.ocr || ocrPages;

  for (let i = 0; i < msgs.length; i += 1) {
    const m = msgs[i];
    if (out.downloaded >= ATT_MAX_DOWNLOADS || Date.now() - started > ATT_BUDGET_MS) { out.remainingMessages = msgs.length - i; break; }
    let deferred = false;
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
        // OCR is slow, so only a few scanned files are read per press. A scanned file past that limit is left for the next press
        // (not recorded as unread), so nothing is lost by pressing again.
        const canOcr = out.ocr < ATT_MAX_OCR_FILES;
        r = await extractAttachmentText({ filename: a.filename, mimeType: a.mimeType, buffer: Buffer.from(att.data.data || '', 'base64url'), ocr: canOcr ? ocrOf : undefined });
        if (r.needsOcr && !canOcr) { deferred = true; break; }
        if (r.ocrUsed) out.ocr += 1;
      }
      await addSource(userId, caseRow.id, {
        kind: 'document', channel: m.channel, externalId, threadId: m.threadId, subject: m.subject, fromAddr: m.fromAddr, toAddr: m.toAddr,
        messageIdHeader: m.messageIdHeader, receivedAt: m.receivedAt, parentId: m.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.size,
        text: r.text, parseStatus: r.parseStatus, parseReason: r.parseReason, parser: r.parser,
      });
      if (r.parseStatus === 'parsed') out.parsed += 1; else if (r.parseStatus === 'failed') out.failed += 1; else out.referenceOnly += 1;
    }
    if (deferred) { out.remainingMessages = msgs.length - i; break; }
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

const SWEEP_PAGE = 100;           // Sent messages looked at per press
const SWEEP_FETCH_BATCH = 8;      // downloaded at once within a page
const SWEEP_RESUME_MS = 30 * 60 * 1000;  // Gmail page positions only stay good for a short while

/**
 * Rule 10.1: sweep Sent for this case, across every alias (Rule 10.3: scope is the case, never one party).
 * On a big case one press looks at one page of Sent (100 messages) and the check carries on from there the next press; it counts as
 * COMPLETE only when the last page is done. A failure is recorded as not completed, which blocks drafting; it is never "nothing found".
 * A later check only needs to add the new tail (from the last completed check, less an hour) as long as it covered the same addresses
 * and reached back at least as far as this case needs now.
 * @returns {{completed: boolean, partial: boolean, from: string, to: string, found: number, scanned: number}}
 */
async function runSentSweep(userId, caseRow) {
  const aliases = caseRow.aliases || [];
  if (!aliases.length) throw Object.assign(new Error('Add at least one address for the people in this case first.'), { status: 400 });
  const aliasKey = [...aliases].sort().join(',');
  const g = gmailHelpers();

  const { rows: last } = await pool.query('SELECT * FROM ef_sent_sweeps WHERE "caseId"=$1 ORDER BY id DESC LIMIT 1', [caseRow.id]);
  let run = last[0] && !last[0].completed && !last[0].error && last[0].nextPageToken && last[0].aliasKey === aliasKey
    && Date.now() - new Date(last[0].updatedAt).getTime() < SWEEP_RESUME_MS ? last[0] : null;

  if (!run) {
    const requestDates = (caseRow.ledger || []).map((r) => r.requestDate).filter(Boolean).map((d) => new Date(d).getTime());
    const needFromMs = Math.min(new Date(caseRow.createdAt).getTime(), ...requestDates) - 24 * 3600 * 1000;
    const { rows: done } = await pool.query('SELECT * FROM ef_sent_sweeps WHERE "caseId"=$1 AND completed=TRUE ORDER BY id DESC LIMIT 1', [caseRow.id]);
    const prev = done[0] && done[0].aliasKey === aliasKey && new Date(done[0].fromAt).getTime() <= needFromMs ? done[0] : null;
    const fromMs = prev ? new Date(prev.fromAt).getTime() : needFromMs;                       // what the check now claims to cover
    const afterMs = prev ? new Date(prev.toAt).getTime() - 3600 * 1000 : needFromMs;          // where this run needs to start looking
    const q = `in:sent (${aliases.map((a) => `to:${a} OR cc:${a}`).join(' OR ')}) after:${Math.floor(afterMs / 1000)}`;
    const ins = await pool.query(
      'INSERT INTO ef_sent_sweeps ("caseId","userId","fromAt","toAt",completed,found,scanned,q,"aliasKey") VALUES ($1,$2,$3,NOW(),FALSE,0,0,$4,$5) RETURNING *',
      [caseRow.id, userId, new Date(fromMs), q, aliasKey]);
    run = ins.rows[0];
  }

  try {
    const gmail = await g.getGmailClient(userId);
    const res = await gmail.users.messages.list({ userId: 'me', q: run.q, maxResults: SWEEP_PAGE, pageToken: run.nextPageToken || undefined });
    const ids = (res.data.messages || []).map((m) => m.id);
    const next = res.data.nextPageToken || null;

    // Skip what is already stored (a repeated press or an overlapping tail costs no download).
    const { rows: have } = ids.length ? await pool.query('SELECT "externalId" FROM ef_sources WHERE "caseId"=$1 AND "externalId" = ANY($2)', [caseRow.id, ids]) : { rows: [] };
    const known = new Set(have.map((r) => r.externalId));
    const todo = ids.filter((id) => !known.has(id));
    let found = 0;
    for (let i = 0; i < todo.length; i += SWEEP_FETCH_BATCH) {
      const got = await Promise.all(todo.slice(i, i + SWEEP_FETCH_BATCH).map((id) => gmail.users.messages.get({ userId: 'me', id, format: 'full' })));
      for (const msg of got) { const r = await addSource(userId, caseRow.id, messageToSource(msg.data, g)); if (r.created) found += 1; }
    }

    const completed = !next;
    const scanned = run.scanned + ids.length;
    const total = run.found + found;
    await pool.query(
      'UPDATE ef_sent_sweeps SET completed=$1, "nextPageToken"=$2, scanned=$3, found=$4, "updatedAt"=NOW() WHERE id=$5',
      [completed, next, scanned, total, run.id]);
    return { completed, partial: !completed, from: new Date(run.fromAt).toISOString(), to: new Date(run.toAt).toISOString(), found: total, scanned };
  } catch (err) {
    await pool.query('UPDATE ef_sent_sweeps SET error=$1, "nextPageToken"=NULL, "updatedAt"=NOW() WHERE id=$2', [String(err.message).slice(0, 300), run.id]);
    throw err;
  }
}

async function latestSweep(caseId) {
  const { rows } = await pool.query('SELECT id, "fromAt" AS "from", "toAt" AS "to", completed, found, scanned, "nextPageToken", error, "updatedAt" FROM ef_sent_sweeps WHERE "caseId"=$1 ORDER BY id DESC LIMIT 1', [caseId]);
  const w = rows[0];
  if (!w) return null;
  return {
    completed: w.completed, partial: !w.completed && !w.error && !!w.nextPageToken, from: w.from, to: w.to,
    found: w.found, scanned: w.scanned, error: w.error, at: w.updatedAt,
  };
}

/** Copy-time check (Rule 9.4): mail in the cited threads newer than the draft, read live from Gmail. Fails closed. */
async function freshInbound(userId, threadIds, sinceIso, ownerAddr) {
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
      out.push({ id: m.id, from, threadId, receivedAt: new Date(Number(m.internalDate)).toISOString() });
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
  EMAIL_RE, cleanAliases, listCases, clientName, getCase, insertCase, withLedger, patchCase,
  listSources, getSource, addSource, markExtracted,
  attachThread, suggestThreads, previewThread, fetchAttachments, runSentSweep, latestSweep, freshInbound, ownerEmail,
  listDrafts, getDraft, pendingDraftCount, insertDraft, setDraftStatus, addApproval, latestApproval,
  localDate,
};
