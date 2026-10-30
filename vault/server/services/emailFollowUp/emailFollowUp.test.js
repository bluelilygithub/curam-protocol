'use strict';

// Rule suite for Email Follow-Up (docs/email-follow-up-fixture-plan.md, Rule S1).
// Every fixture is a directory under ./fixtures with a manifest.json (fixed clock, hand-written extracted rows and
// drafts, expected outcome, named failure condition) and literal .eml messages. No model, no network, no database:
// same bytes in, same verdict out. Run: node server/services/emailFollowUp/emailFollowUp.test.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { RuleError, sha256, spanHash } = require('./common');
const { parseDeadline, localDate } = require('./deadlines');
const ledger = require('./ledger');
const { checkDraft } = require('./guard');
const approval = require('./approval');
const gates = require('./gates');
const { buildNudgeDraft } = require('./draft');
const { coverageStatement } = require('./coverage');
const { extractAttachmentText, planAttachment } = require('./attachmentText');
const { normalizeMentions } = require('./extract');

const FIXTURES = path.join(__dirname, 'fixtures');
let passed = 0;
const failures = [];

function fail(id, msg) { failures.push(`fixture ${id}: ${msg}`); }

// ---------- helpers ----------

function resolveAnchor(sources, spec) {
  const src = sources[spec.sourceId];
  if (!src) return { sourceId: spec.sourceId, versionHash: 'v?', locator: { start: 0, end: 1, clause: spec.clause }, spanHash: 'x' };
  const start = src.text.indexOf(spec.quote);
  if (start < 0) throw new Error(`fixture quote not found in ${spec.sourceId}: ${spec.quote}`);
  const end = start + spec.quote.length;
  return {
    sourceId: spec.sourceId,
    versionHash: spec.versionHash || src.versionHash || sha256(src.text),
    locator: { start, end, ...(spec.clause ? { clause: spec.clause } : {}) },
    spanHash: spanHash(spec.quote),
  };
}

function guardSources(fx) {
  const out = {};
  for (const [id, s] of Object.entries(fx.sources || {})) {
    out[id] = { id, text: s.text, versionHash: s.versionHash || sha256(s.text), supersededBy: s.supersededBy || null, parseStatus: s.parseStatus || 'parsed', clauses: s.clauses };
  }
  return out;
}

function toMention(fx, m) {
  const out = { ...m };
  if (m.dueRaw) out.due = parseDeadline(m.dueRaw, { sentAt: m.sentAt, tz: fx.eval_tz });
  if (m.sourceId && m.quote) out.anchor = resolveAnchor(fx.sources, { sourceId: m.sourceId, quote: m.quote });
  out.requestDate = m.sentAt || null;
  return out;
}

function match(id, label, actual, expected) {
  for (const [k, v] of Object.entries(expected)) {
    if (k === 'due') {
      for (const [dk, dv] of Object.entries(v)) if (actual.due[dk] !== dv) fail(id, `${label}: due.${dk} is ${JSON.stringify(actual.due[dk])}, expected ${JSON.stringify(dv)}`);
    } else if (k === 'anchorCount') {
      if (actual.anchors.length !== v) fail(id, `${label}: ${actual.anchors.length} anchors, expected ${v}`);
    } else if (k === 'itemCount') {
      if (actual.items.length !== v) fail(id, `${label}: ${actual.items.length} items, expected ${v}`);
    } else if (actual[k] !== v) {
      fail(id, `${label}: ${k} is ${JSON.stringify(actual[k])}, expected ${JSON.stringify(v)}`);
    }
  }
}

function profilesFor(fx) { return fx.profile === 'both' ? ['soft', 'professional'] : [fx.profile]; }

// ---------- checks ----------

const CHECKS = {
  fold_mentions(fx) {
    let rows = [];
    for (const m of fx.mentions) rows = ledger.applyMention(rows, toMention(fx, m)).rows;
    if (rows.length !== fx.expected_ledger.length) fail(fx.id, `${rows.length} rows, expected ${fx.expected_ledger.length}. ${fx.failure_condition}`);
    for (const exp of fx.expected_ledger) {
      const row = rows.find((r) => r.id === exp.id);
      if (!row) { fail(fx.id, `no row ${exp.id}`); continue; }
      match(fx.id, exp.id, row, exp);
    }
    // Rule 4.1: nothing conditional may ever surface as agreed
    for (const r of rows) if (r.condition && r.claimType === 'agreed') fail(fx.id, '§4.1 violated: conditional text stored as agreed');
  },

  deadline(fx) {
    for (const c of fx.cases) {
      const d = parseDeadline(c.raw, { sentAt: c.sentAt, tz: fx.eval_tz, startDate: c.startDate });
      const e = c.expected;
      if (d.status !== e.status) fail(fx.id, `"${c.raw}": status ${d.status}, expected ${e.status}. ${fx.failure_condition}`);
      if (e.date !== undefined && d.date !== e.date) fail(fx.id, `"${c.raw}": date ${d.date}, expected ${e.date}`);
      if (e.rawPreserved && d.raw !== c.raw) fail(fx.id, `"${c.raw}": raw text not preserved`);
      if (e.missingIncludes && !d.missing.some((x) => x.includes(e.missingIncludes))) fail(fx.id, `"${c.raw}": missing input not named (${JSON.stringify(d.missing)})`);
    }
  },

  affirmation(fx) {
    const { rows } = ledger.applyMention([], toMention(fx, fx.mention));
    const row = rows[0];
    const t = ledger.transition(row, { type: 'affirmation', text: fx.affirmation });
    if (t.row.status !== fx.expected.status || t.row.claimType !== fx.expected.claimType) fail(fx.id, `row is ${t.row.status}/${t.row.claimType} after "${fx.affirmation}". ${fx.failure_condition}`);
    const d = ledger.transition(row, { type: 'deliverable', anchor: row.anchors[0] });
    if (d.ok || d.rule !== fx.expected.deliverableRefusedRule) fail(fx.id, `deliverable should be refused under §${fx.expected.deliverableRefusedRule}, got ${JSON.stringify({ ok: d.ok, rule: d.rule })}`);
    const sources = guardSources(fx);
    const bad = checkDraft({ claims: [{ kind: 'fact', text: fx.badDraftClaim, anchor: row.anchors[0] }] }, { sources, profile: 'professional', row });
    if (bad.results[0].code !== fx.expected.badDraftCode) fail(fx.id, `"as agreed" draft gave ${bad.results[0].code}, expected ${fx.expected.badDraftCode}`);
    const good = checkDraft(buildNudgeDraft(row, { to: ['client@acme.com'] }), { sources, profile: 'professional', row });
    if (good.verdict !== 'pass') fail(fx.id, `a faithful draft should pass, got ${good.verdict}: ${good.reasons.join(' | ')}`);
  },

  case_creation(fx) {
    try { gates.createCaseFromMessage(fx.message); fail(fx.id, `no refusal. ${fx.failure_condition}`); } catch (e) {
      if (!(e instanceof RuleError) || e.rule !== fx.expected.refusedRule) fail(fx.id, `wrong refusal: ${e.message}`);
    }
    const unknown = gates.suggestCaseForMessage(fx.message, fx.cases);
    if (unknown.action !== fx.expected.unknownSenderAction || unknown.attached) fail(fx.id, `unknown sender: ${JSON.stringify(unknown)}`);
    const known = gates.suggestCaseForMessage({ ...fx.message, from: 'Client <client@acme.com>' }, fx.cases);
    if (known.action !== fx.expected.knownSenderAction || !known.needsAcceptance || known.attached) fail(fx.id, `known sender: ${JSON.stringify(known)}`);
    try { gates.createCase({ title: 'x', obligation: 'y' }, { type: 'system' }); fail(fx.id, 'a non-human actor opened a case'); } catch (e) { if (e.rule !== '1.1') fail(fx.id, e.message); }
    try { gates.createCase({ title: 'x' }, { type: 'human' }); fail(fx.id, 'a case opened with no obligation'); } catch (e) { if (e.rule !== '1.1') fail(fx.id, e.message); }
    const ok = gates.createCase({ title: 'Q3 documents', obligation: 'Client owes the Q3 ledger' }, { type: 'human' });
    if (ok.status !== 'active' || ok.profile !== 'soft') fail(fx.id, `new case should start active with relaxed checking, got ${JSON.stringify(ok)}`);
  },

  can_draft(fx) {
    const run = (watermark) => gates.canDraft({ row: fx.row, watermark, now: fx.eval_now, sentLinks: fx.sentLinks || [] });
    const r = run(fx.watermark);
    const e = fx.expected;
    if (r.ok !== e.ok) fail(fx.id, `ok=${r.ok}, expected ${e.ok}. ${fx.failure_condition}`);
    if (e.close !== undefined && !!r.close !== e.close) fail(fx.id, `close=${r.close}, expected ${e.close}`);
    if (e.rule && !r.blocks.some((b) => b.rule === e.rule)) fail(fx.id, `expected a §${e.rule} block, got ${JSON.stringify(r.blocks)}`);
    for (const c of fx.controls || []) {
      const rc = run(c.watermark);
      if (rc.ok !== c.expected.ok) fail(fx.id, `control ${JSON.stringify(c.watermark)}: ok=${rc.ok}, expected ${c.expected.ok}`);
      if (c.expected.rule && !rc.blocks.some((b) => b.rule === c.expected.rule)) fail(fx.id, `control: expected §${c.expected.rule}, got ${JSON.stringify(rc.blocks)}`);
    }
  },

  guard_draft(fx) {
    const sources = guardSources(fx);
    const mk = (d) => ({ ...d, claims: d.claims.map((c) => ({ ...c, anchor: c.anchor ? resolveAnchor(fx.sources, c.anchor) : undefined })) });
    for (const profile of profilesFor(fx)) {
      const res = checkDraft(mk(fx.draft), { sources, profile, row: fx.row });
      const e = fx.expected;
      const first = res.results.find((r) => r.verdict !== 'pass') || res.results[0];
      if (res.verdict !== e.verdict) fail(fx.id, `[${profile}] verdict ${res.verdict}, expected ${e.verdict}. ${fx.failure_condition}`);
      if (e.code && first.code !== e.code) fail(fx.id, `[${profile}] code ${first.code}, expected ${e.code}`);
      if (e.mustNameId && !first.message.includes(e.mustNameId)) fail(fx.id, `[${profile}] failure does not name ${e.mustNameId}: ${first.message}`);
      if (e.questionIncludes && !String(first.question || '').includes(e.questionIncludes)) fail(fx.id, `[${profile}] no named question`);
      if (e.exportAllowed !== undefined && res.exportAllowed !== e.exportAllowed) fail(fx.id, `[${profile}] exportAllowed=${res.exportAllowed}`);
      if (fx.controlDraft) {
        const c = checkDraft(mk(fx.controlDraft), { sources, profile, row: fx.row });
        if (c.verdict !== e.controlVerdict) fail(fx.id, `[${profile}] control draft gave ${c.verdict} (${c.reasons.join(' | ')}), expected ${e.controlVerdict}`);
      }
    }
  },

  ocr_source(fx) {
    const claim = { kind: 'fact', text: 'You wrote: "Total due $3,450.00"', anchor: { sourceId: 'doc-24', quote: 'Total due $3,450.00' } };
    const run = (ocr) => {
      const sources = guardSources({ sources: { 'doc-24': { text: fx.sources['doc-24'].text, ocr } } });
      sources['doc-24'].ocr = ocr;
      return checkDraft({ claims: [{ ...claim, anchor: resolveAnchor(fx.sources, claim.anchor) }] }, { sources, profile: 'professional', row: fx.row });
    };
    const scan = run(true);
    if (scan.verdict !== 'needs_review' || scan.results[0].code !== 'OCR_SOURCE') fail(fx.id, `a quote from an OCR'd scan gave ${scan.verdict}/${scan.results[0].code}. ${fx.failure_condition}`);
    const real = run(false);
    if (real.verdict !== 'pass') fail(fx.id, `the same quote from a real text layer should pass, got ${real.verdict}`);
    // a figure that OCR got wrong is still caught as needs_review, never silently passed
    const wrong = checkDraft({ claims: [{ kind: 'fact', text: 'You owe $3,950.00', anchor: resolveAnchor(fx.sources, claim.anchor) }] }, { sources: (() => { const s = guardSources({ sources: { 'doc-24': { text: fx.sources['doc-24'].text } } }); s['doc-24'].ocr = true; return s; })(), profile: 'professional', row: fx.row });
    if (wrong.verdict !== 'fail') fail(fx.id, 'a figure not in the OCR text should fail');
  },

  claim_checks(fx) {
    const sources = guardSources(fx);
    for (const c of fx.cases) {
      const anchor = resolveAnchor(fx.sources, { sourceId: 'msg-023-a', quote: c.quote });
      const res = checkDraft({ claims: [{ kind: 'fact', text: c.text, anchor }] }, { sources, profile: 'professional', row: fx.row });
      if (res.results[0].code !== c.expected) fail(fx.id, `${c.name}: got ${res.results[0].code}, expected ${c.expected}. ${fx.failure_condition}`);
    }
  },

  conflict(fx) {
    let rows = [];
    for (const m of fx.mentions) rows = ledger.applyMention(rows, toMention(fx, m)).rows;
    const [a, b] = rows;
    if (rows.length !== 2 || a.status !== 'open' || b.status !== 'open') fail(fx.id, `expected two open rows, got ${JSON.stringify(rows.map((r) => [r.id, r.status]))}. ${fx.failure_condition}`);
    else {
      if (a.conflictWith !== b.id || b.conflictWith !== a.id) fail(fx.id, '§4.3: the two rows are not flagged against each other');
      if (!/Which is right\?/.test(a.conflictQuestion || '')) fail(fx.id, 'no named question');
      const now = fx.eval_now;
      const wm = { completed: true, from: '2026-01-01T00:00:00+10:00', to: '2026-10-15T08:55:00+10:00' };
      const blocked = gates.canDraft({ row: a, watermark: wm, now });
      if (blocked.ok || !blocked.blocks.some((x) => x.rule === '4.3')) fail(fx.id, 'a row with a disputed figure can be drafted');
      const closed = ledger.transition(a, { type: 'waive' }).row;
      const after = ledger.clearConflict(rows.map((r) => (r.id === a.id ? closed : r)), a.id);
      if (after.find((r) => r.id === b.id).conflictWith) fail(fx.id, 'closing one side did not clear the other');
      if (!gates.canDraft({ row: after.find((r) => r.id === b.id), watermark: wm, now }).ok) fail(fx.id, 'the remaining row should be draftable once the dispute is settled');
    }
    // a later correction (different email date) is still a plain supersede, not a dispute
    const later = ledger.applyMention(ledger.applyMention([], toMention(fx, fx.mentions[0])).rows, toMention(fx, { ...fx.mentions[1], sentAt: '2026-10-16T10:00:00+10:00' }));
    if (later.action !== 'supersede') fail(fx.id, `a correction in a later email should supersede, got ${later.action}`);
  },

  async hostile_document(fx) {
    const bytes = fs.readFileSync(path.join(FIXTURES, fx.dir, 'attachments', fx.file));
    const r = await extractAttachmentText({ filename: fx.file, mimeType: 'application/pdf', buffer: bytes });
    if (r.parseStatus !== 'parsed') { fail(fx.id, `PDF not read: ${r.parseStatus} ${r.parseReason}`); return; }
    for (const needle of fx.expected.textHas) if (!r.text.includes(needle)) fail(fx.id, `extracted text lacks "${needle}" (it must be kept as data)`);
    for (const needle of fx.expected.textLacks) if (r.text.includes(needle)) fail(fx.id, `"${needle}" was read into the case: metadata and form fields must not be`);
    const source = { id: 31, kind: 'document', text: r.text, receivedAt: '2026-10-15T00:00:00+10:00' };
    // a model that was steered by the document, adding fields it has no right to set
    const modelReply = JSON.stringify({ mentions: [{ ...fx.fakeModelMention, status: 'met', approve: true, authority: 'confirmed', suppressWarnings: true }] });
    const out = normalizeMentions(modelReply, source, { tz: fx.eval_tz });
    if (out.mentions.length !== 1) { fail(fx.id, `expected one mention, got ${out.mentions.length}: ${JSON.stringify(out.dropped)}`); return; }
    const folded = ledger.applyMention([], out.mentions[0], { newId: () => 'r1' });
    const row = folded.rows[0];
    const e = fx.expected;
    if (row.status !== 'open' || row.amount !== e.amount || row.due.date !== e.due) fail(fx.id, `row is ${row.status}/${row.amount}/${row.due.date}. ${fx.failure_condition}`);
    if (row.suppressWarnings || row.approve) fail(fx.id, 'the document steered a field into the ledger');
  },

  substitute(fx) {
    const { rows } = ledger.applyMention([], toMention(fx, fx.mention));
    const anchor = resolveAnchor(fx.sources, fx.substitute);
    const out = ledger.suspendForSubstitute(rows, 'r1', { party: fx.substitute.party, sourceId: fx.substitute.sourceId, quote: fx.substitute.quote, anchor });
    const orig = out.rows.find((r) => r.id === 'r1');
    const sub = out.rows.find((r) => r.id === 'r2');
    const e = fx.expected;
    if (orig.status !== e.original.status || orig.due.date !== e.original.due) fail(fx.id, `original is ${orig.status}/${orig.due.date}. ${fx.failure_condition}`);
    if (sub.status !== e.substitute.status || sub.authority !== e.substitute.authority || sub.due.date !== e.substitute.due) fail(fx.id, `substitute is ${sub.status}/${sub.authority}/${sub.due.date}`);
    const clear = ledger.transition(sub, { type: 'deliverable', anchor });
    if (clear.ok || clear.rule !== e.deliverableRefusedRule) fail(fx.id, `unconfirmed substitute cleared the obligation: ${JSON.stringify({ ok: clear.ok, rule: clear.rule })}`);
    const origClear = ledger.transition(orig, { type: 'deliverable', anchor });
    if (origClear.ok) fail(fx.id, 'a suspended row was cleared');
    const confirmed = ledger.transition(sub, { type: 'confirm_authority', by: 'human_note' }).row;
    const after = ledger.transition(confirmed, { type: 'deliverable', anchor });
    if (!after.ok || after.row.status !== e.afterConfirm) fail(fx.id, `after confirmation the row should clear, got ${JSON.stringify({ ok: after.ok, rule: after.rule })}`);
  },

  approval_stale(fx) {
    const rec = approval.approve(fx.draft, { userId: 1, at: fx.eval_now });
    const stale = approval.checkAtCopy(rec, fx.draft, fx.inboundSince);
    if (stale.ok || stale.rule !== fx.expected.staleRule || stale.status !== 'pending') fail(fx.id, `stale approval survived: ${JSON.stringify(stale)}. ${fx.failure_condition}`);
    if (!approval.checkAtCopy(rec, fx.draft, fx.unrelated).ok) fail(fx.id, 'unrelated mail reset the approval');
    if (!approval.checkAtCopy(rec, fx.draft, []).ok) fail(fx.id, 'a clean approved draft failed at copy time');
  },

  approval_hash(fx) {
    const rec = approval.approve(fx.draft, { userId: 1, at: fx.eval_now });
    if (!approval.checkAtCopy(rec, fx.draft, []).ok) fail(fx.id, 'unchanged draft should copy');
    for (const ed of fx.edits) {
      const changed = { ...fx.draft, [ed.field]: ed.value };
      const r = approval.checkAtCopy(rec, changed, []);
      if (r.ok || r.rule !== ed.rule) fail(fx.id, `editing ${ed.field} left the draft approved (${JSON.stringify(r)}). ${fx.failure_condition}`);
    }
    const cited = { ...fx.draft, claims: [{ ...fx.draft.claims[0], anchor: { ...fx.draft.claims[0].anchor, spanHash: 'zzz' } }] };
    if (approval.checkAtCopy(rec, cited, []).ok) fail(fx.id, 'changing the citation set kept the approval');
    const v2 = approval.checkAtCopy(rec, { ...fx.draft, version: 2 }, []);
    if (v2.rule !== fx.expected.newVersionRule) fail(fx.id, `new version: ${JSON.stringify(v2)}`);
    const none = approval.checkAtCopy(null, fx.draft, []);
    if (none.ok || none.rule !== fx.expected.noRecordRule) fail(fx.id, `no record: ${JSON.stringify(none)}`);
  },

  export_gates(fx) {
    for (const c of fx.cases) {
      const r = gates.exportGates({ profile: c.profile, sources: c.sources, rows: c.rows, governing: c.governing });
      if (r.exportBlocked !== c.expected.exportBlocked) fail(fx.id, `${c.name}: exportBlocked=${r.exportBlocked}. ${fx.failure_condition}`);
    }
  },

  parse_scope(fx) {
    for (const c of fx.cases) {
      const r = gates.exportGates({ profile: c.profile, sources: c.sources, rows: c.rows, governing: [] });
      const e = c.expected;
      if (r.exportBlocked !== e.exportBlocked) fail(fx.id, `${c.name}: exportBlocked=${r.exportBlocked}, expected ${e.exportBlocked}. ${fx.failure_condition}`);
      if (e.blockedDraftSources && JSON.stringify(r.blockedDraftSources) !== JSON.stringify(e.blockedDraftSources)) fail(fx.id, `${c.name}: draft blocks ${JSON.stringify(r.blockedDraftSources)}`);
      if (e.ruleInReason && !r.reasons.some((x) => x.includes(`§${e.ruleInReason}`))) fail(fx.id, `${c.name}: reason does not name §${e.ruleInReason}: ${JSON.stringify(r.reasons)}`);
    }
  },

  backlog(fx) {
    for (const c of fx.cases) {
      const r = gates.canDraft({ row: fx.row, watermark: null, now: fx.eval_now, pendingDrafts: c.pendingDrafts, cap: fx.cap });
      if (r.ok !== c.expected.ok) fail(fx.id, `${c.pendingDrafts} waiting: ok=${r.ok}. ${fx.failure_condition}`);
      if (c.expected.rule && !r.blocks.some((b) => b.rule === c.expected.rule)) fail(fx.id, `expected §${c.expected.rule}`);
    }
  },

  hostile_body(fx) {
    let rows = [];
    for (const m of fx.mentions) rows = ledger.applyMention(rows, toMention(fx, m)).rows;
    if (!rows.every((r) => r.status === 'open')) fail(fx.id, `a status changed: ${rows.map((r) => r.status)}. ${fx.failure_condition}`);
    const hostile = rows.find((r) => /IGNORE PREVIOUS/.test(r.quote || ''));
    if (!hostile) fail(fx.id, 'hostile text was not stored verbatim as content');
    // the ledger has no path from text to an approval: nothing here can mint one
    if (typeof approval.approve !== 'function' || approval.approve.length < 2) fail(fx.id, 'approval API changed shape');
  },
};

// ---------- run ----------

(async () => {

const dirs = fs.readdirSync(FIXTURES).filter((d) => fs.statSync(path.join(FIXTURES, d)).isDirectory()).sort();
for (const dir of dirs) {
  const fx = JSON.parse(fs.readFileSync(path.join(FIXTURES, dir, 'manifest.json'), 'utf8'));
  const before = failures.length;
  // Rule 14.1: a fixture without a fixed instant and zone is invalid and cannot pass
  if (!fx.eval_now || Number.isNaN(new Date(fx.eval_now).getTime())) fail(fx.id, '§14.1: missing or invalid eval_now');
  else {
    try { new Intl.DateTimeFormat('en', { timeZone: fx.eval_tz }); } catch { fail(fx.id, '§14.1: missing or invalid eval_tz'); }
  }
  if (!fx.failure_condition) fail(fx.id, '§14.2: no failure_condition');
  if (!dir.startsWith(`${fx.id}_`)) fail(fx.id, 'id does not match directory prefix');
  const msgDir = path.join(FIXTURES, dir, 'messages');
  if (fs.existsSync(msgDir)) {
    for (const f of fs.readdirSync(msgDir)) {
      const raw = fs.readFileSync(path.join(msgDir, f), 'utf8');
      if (!/^Message-ID: <[^>]+>$/m.test(raw) || !/^Date: /m.test(raw)) fail(fx.id, `${f} is not a well-formed RFC 5322 message`);
    }
  }
  if (!CHECKS[fx.check]) fail(fx.id, `unknown check ${fx.check}`);
  else if (failures.length === before) {
    try { await CHECKS[fx.check](fx); } catch (e) { fail(fx.id, `threw: ${e.stack || e.message}`); }
  }
  if (failures.length === before) passed += 1;
}

// ---------- direct unit checks ----------

await (async function unit() {
  const sent = '2026-10-14T10:00:00+10:00';
  const tz = 'Australia/Brisbane';
  const check = (name, fn) => { try { fn(); } catch (e) { failures.push(`unit ${name}: ${e.message}`); } };
  check('weekday and date disagree', () => {
    const d = parseDeadline('by Friday the 24th', { sentAt: sent, tz });
    assert.strictEqual(d.status, 'needs_review');
  });
  check('next friday is ambiguous', () => assert.strictEqual(parseDeadline('next Friday', { sentAt: sent, tz }).status, 'needs_review'));
  check('zone not viewer', () => assert.strictEqual(localDate('2026-10-14T20:00:00Z', tz), '2026-10-15'));
  check('stated month', () => assert.strictEqual(parseDeadline('by 3 November', { sentAt: sent, tz }).date, '2026-11-03'));
  check('stated month rolls year', () => assert.strictEqual(parseDeadline('by 3 January', { sentAt: sent, tz }).date, '2027-01-03'));
  check('conditional needs condition', () => assert.throws(() => ledger.rowFromMention({ kind: 'commitment', direction: 'i_owe', party: 'a', items: ['x'], claimType: 'conditional' }, 'r1'), /4\.1/));
  check('human close needs no note', () => {
    const { rows } = ledger.applyMention([], { kind: 'waiting_on', direction: 'they_owe', party: 'a', items: ['x'], claimType: 'agreed' });
    const t = ledger.transition(rows[0], { type: 'human_close' });
    assert.ok(t.ok && t.row.status === 'met' && t.row.closedBy.provenance === 'human');
  });
  check('aging downgrades', () => {
    const { rows } = ledger.applyMention([], { kind: 'waiting_on', direction: 'they_owe', party: 'a', items: ['x'], claimType: 'agreed', requestDate: '2026-09-01T00:00:00Z' });
    assert.strictEqual(ledger.ageRows(rows, '2026-10-15T00:00:00Z')[0].status, 'unverified');
    assert.ok(!gates.canDraft({ row: { ...rows[0], status: 'unverified' }, watermark: null, now: '2026-10-15T00:00:00Z' }).ok);
  });
  check('soft uncited needs acceptance', () => {
    const d = { claims: [{ kind: 'fact', text: 'They owe 3 items.' }] };
    const soft = checkDraft(d, { sources: {}, profile: 'soft', row: null });
    assert.strictEqual(soft.verdict, 'needs_review');
    assert.ok(!soft.exportAllowed);
    const ok = checkDraft({ ...d, acceptedWarnings: [{ index: 0, code: 'UNCITED_SOFT' }] }, { sources: {}, profile: 'soft', row: null });
    assert.ok(ok.exportAllowed);
    assert.strictEqual(checkDraft(d, { sources: {}, profile: 'professional', row: null }).verdict, 'fail');
  });
  check('the feature flag exists on the server and is off by default', () => {
    // requireFeature() lets an UNKNOWN key straight through, so a missing key would silently open this tool to every member.
    const { FEATURE_ACCESS_KEYS, FEATURE_ACCESS_DEFAULTS, accountantFlags } = require('../../config/featureAccess');
    assert.ok(FEATURE_ACCESS_KEYS.includes('emailFollowUp'));
    assert.strictEqual(FEATURE_ACCESS_DEFAULTS.emailFollowUp, false);
    if (typeof accountantFlags === 'function') assert.notStrictEqual(accountantFlags({}).emailFollowUp, true);
  });
  // ----- attachment text: reads what it should, refuses what it should, and says why (async checks, awaited below) -----
  const pdfLib = require('pdf-lib');
  const mkPdf = async (text) => { const d = await pdfLib.PDFDocument.create(); const p = d.addPage(); if (text) p.drawText(text, { x: 40, y: 700, size: 12 }); return Buffer.from(await d.save()); };
  const att = async (name, filename, buffer, mimeType) => { try { return await extractAttachmentText({ filename, mimeType, buffer }); } catch (e) { failures.push(`unit ${name}: threw ${e.message}`); return {}; } };
  const must = (name, cond, got) => { if (!cond) failures.push(`unit ${name}: ${JSON.stringify(got)}`); };

  let r = await att('pdf text', 'a.pdf', await mkPdf('Invoice INV-1 Total due $3,450.00 payable in 30 days'), 'application/pdf');
  must('a PDF with text is parsed', r.parseStatus === 'parsed' && /3,450\.00/.test(r.text) && /pdfjs/.test(r.parser), r);
  r = await att('scan', 'scan.pdf', await mkPdf(''), 'application/pdf');
  must('a PDF with no text layer is kept with a reason, not read', r.parseStatus === 'reference_only' && /OCR/.test(r.parseReason) && r.text === '', r);
  r = await att('program renamed', 'invoice.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]), 'application/pdf');
  must('a program renamed .pdf is refused by its first bytes', r.parseStatus === 'failed' && /program/.test(r.parseReason), r);
  r = await att('script renamed', 'notes.txt', Buffer.from('#!/bin/sh\nrm -rf /\n'), 'text/plain');
  must('a script renamed .txt is refused', r.parseStatus === 'failed', r);
  r = await att('png', 'logo.pdf', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)]), 'application/pdf');
  must('a picture is kept with a reason', r.parseStatus === 'reference_only' && /picture/.test(r.parseReason), r);
  r = await att('broken pdf', 'bad.pdf', Buffer.from('%PDF-1.7\nthis is not really a pdf'), 'application/pdf');
  must('a broken PDF fails with a reason', r.parseStatus === 'failed' && r.parseReason, r);
  r = await att('text', 'list.csv', Buffer.from('item,amount\nQ3 ledger,4000\n'), 'text/csv');
  must('plain text is read', r.parseStatus === 'parsed' && /Q3 ledger/.test(r.text), r);
  r = await att('binary as text', 'x.txt', Buffer.alloc(300, 0), 'text/plain');
  must('binary posing as text fails', r.parseStatus === 'failed', r);
  r = await att('empty', 'e.pdf', Buffer.alloc(0), 'application/pdf');
  must('an empty file fails', r.parseStatus === 'failed', r);
  must('pictures and spreadsheets are not even downloaded', !planAttachment({ filename: 'a.png', mimeType: 'image/png', size: 100 }).fetch && !planAttachment({ filename: 'a.xlsx', size: 100 }).fetch, null);
  must('a PDF is downloaded', planAttachment({ filename: 'a.pdf', mimeType: 'application/pdf', size: 100 }).fetch, null);
  must('a huge file is not downloaded', !planAttachment({ filename: 'a.pdf', size: 50 * 1024 * 1024 }).fetch, null);

  // ----- OCR (a fake engine: what matters here is what is done with its answer) -----
  const mkPdfPages = async (texts) => { const d = await pdfLib.PDFDocument.create(); for (const t of texts) { const p = d.addPage(); if (t) p.drawText(t, { x: 40, y: 700, size: 12 }); } return Buffer.from(await d.save()); };
  const fakeOcr = (text, confidence = 90, calls) => async (buf, pages) => { if (calls) calls.push(pages); return pages.map((p) => ({ page: p, text, confidence })); };
  const scanBuf = await mkPdf('');
  const o = (ocr, buffer = scanBuf) => extractAttachmentText({ filename: 's.pdf', mimeType: 'application/pdf', buffer, ocr });

  r = await o(fakeOcr('INVOICE 1042 Total due $3,450.00 payable within 30 days'));
  must('a scan is read by OCR and marked as OCR', r.parseStatus === 'parsed' && /tesseract/.test(r.parser) && /confidence 90%/.test(r.parseReason) && /misread/.test(r.parseReason) && /3,450.00/.test(r.text) && r.ocrUsed, r);
  r = await o(fakeOcr('smudge smudge smudge smudge smudge', 30));
  must('OCR that is not confident is not trusted', r.parseStatus === 'reference_only' && /reliably/.test(r.parseReason) && r.text === '', r);
  r = await o(fakeOcr('', 95));
  must('OCR that finds nothing says so', r.parseStatus === 'reference_only' && /no readable text/.test(r.parseReason), r);
  r = await o(async () => { const e = new Error('spawn pdftoppm ENOENT'); e.code = 'ENOENT'; throw e; });
  must('no OCR tools on the server is reported, not hidden', r.parseStatus === 'failed' && /not available on this server/.test(r.parseReason), r);
  r = await o(undefined);
  must('without OCR a scan is reported as needing it', r.parseStatus === 'reference_only' && r.needsOcr === true && /OCR was not run/.test(r.parseReason), r);
  const mixed = await mkPdfPages(['Page one has a real text layer with the total $100.00', '']);
  const calls = [];
  r = await o(fakeOcr('Page two was a scan: balance $250.00', 88, calls), mixed);
  must('only the pages with no text layer are sent to OCR', JSON.stringify(calls) === '[[2]]', calls);
  must('a mixed PDF keeps its real text and adds the OCR page in order', r.parseStatus === 'parsed' && r.text.indexOf('$100.00') < r.text.indexOf('$250.00') && /pdfjs\+tesseract/.test(r.parser), r);
  const long = await mkPdfPages(Array(12).fill(''));
  const calls2 = [];
  r = await o(fakeOcr('A scanned page with enough words on it to count', 90, calls2), long);
  must('OCR is limited to ten pages and says so', calls2[0].length === 10 && /2 further scanned pages not read/.test(r.parseReason), { calls: calls2[0] && calls2[0].length, r: r.parseReason });
  const calls3 = [];
  r = await extractAttachmentText({ filename: 'x.pdf', mimeType: 'application/pdf', buffer: await mkPdf('Total due $9.00 and plenty of ordinary text here'), ocr: async (b, p) => { calls3.push(p); return []; } });
  must('a PDF with a text layer never calls OCR', r.parseStatus === 'parsed' && /pdfjs/.test(r.parser) && !r.ocrUsed && calls3.length === 0 && !r.parseReason, { r, calls3 });

  check('coverage: a row with no deadline is not a to-do, a deadline that was said but unclear is', () => {
    const row = (items, due) => ({ id: 'r', items, status: 'open', claimType: 'agreed', authority: 'confirmed', due });
    const c = coverageStatement({ sources: [], rows: [
      row(['quiet'], { status: 'needs_review', raw: null, missing: ['deadline wording'] }),
      row(['vague'], { status: 'needs_review', raw: 'soon', missing: ['a stated date'] }),
    ] });
    assert.ok(!c.verify.some((v) => v.includes('"quiet"')), 'no deadline stated is not listed');
    assert.ok(c.verify.some((v) => v.includes('"vague"') && v.includes('soon')), 'a vague deadline is listed with what was said');
  });
  check('coverage: attachments not fetched counts only what is really unfetched', () => {
    const docs = [{ id: 1, kind: 'document', parseStatus: 'parsed', parser: 'pdfjs/x' }, { id: 2, kind: 'document', parseStatus: 'reference_only', parseReason: 'picture' }];
    const done = coverageStatement({ sources: docs, rows: [], attachmentsNotFetched: 0 });
    assert.ok(!done.notVisible.some((x) => /not been fetched/.test(x)), 'nothing unfetched, nothing said');
    assert.ok(done.notVisible.some((x) => /1 of 2 attachments fetched was read/.test(x)));
    const some = coverageStatement({ sources: docs, rows: [], attachmentsNotFetched: 3 });
    assert.ok(some.notVisible.some((x) => /3 attachments on the attached mail have not been fetched yet\./.test(x)));
    const none = coverageStatement({ sources: [], rows: [], attachmentsNotFetched: 2 });
    assert.ok(none.notVisible.some((x) => /not been fetched yet, so none were read/.test(x)));
  });
  check('coverage prints the misses', () => {
    const c = coverageStatement({ sources: [{ id: 's1', parseStatus: 'parsed', receivedAt: '2026-10-01T00:00:00Z' }], rows: [], sentWatermark: null });
    assert.ok(c.notVisible.some((x) => /phone|portal/i.test(x)) && c.notVisible.some((x) => /Sent mail has not been checked/.test(x)));
  });
})();

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S)\n  - ${failures.join('\n  - ')}`);
  console.error(`\n${passed}/${dirs.length} fixtures passed`);
  process.exit(1);
}
console.log(`email-follow-up: ${passed}/${dirs.length} fixtures passed, unit checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
