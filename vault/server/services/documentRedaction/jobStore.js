'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Artifacts that download/export routes may serve.
 * Never includes entity-map or raw audit.jsonl under internal/.
 * INTERNAL-ONLY-audit-trail.json is gated on finalApprovedAt in exportDownload.
 */
const EXPORTABLE_ARTIFACTS = Object.freeze([
  'redacted.docx',
  'sanitized.pdf',
  'INTERNAL-ONLY-audit-trail.json',
]);

/** Snapshot of redacted.docx after the local (pre-frontier) apply pass. */
const LOCAL_PASS_DOCX = 'local-pass.docx';

function jobsRoot() {
  const base = process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads');
  return path.join(base, 'document-redaction');
}

function ensureJobsRoot() {
  const root = jobsRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function jobDir(jobId) {
  return path.join(ensureJobsRoot(), jobId);
}

/** Local-only secrets for a job — never expose via HTTP export/download. */
function internalDir(jobId) {
  const dir = path.join(jobDir(jobId), 'internal');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createJobShell(userId, meta = {}) {
  const id = crypto.randomUUID();
  const dir = jobDir(id);
  fs.mkdirSync(dir, { recursive: true });
  internalDir(id); // ensure internal/ exists from day one
  const job = {
    id,
    userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'uploaded',
    ...meta,
  };
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job, null, 2));
  return job;
}

function saveJob(job) {
  const dir = jobDir(job.id);
  fs.mkdirSync(dir, { recursive: true });
  job.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job, null, 2));
  return job;
}

function loadJob(jobId, userId) {
  const file = path.join(jobDir(jobId), 'job.json');
  if (!fs.existsSync(file)) return null;
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (userId != null && Number(job.userId) !== Number(userId)) return null;
  return job;
}

function saveOriginalDocx(jobId, buffer, filename) {
  const dest = path.join(jobDir(jobId), 'original.docx');
  fs.writeFileSync(dest, buffer);
  return { originalFilePath: dest, originalFilename: filename || 'upload.docx' };
}

function loadOriginalDocx(jobId) {
  const dest = path.join(jobDir(jobId), 'original.docx');
  if (!fs.existsSync(dest)) return null;
  return fs.readFileSync(dest);
}

function saveCandidates(jobId, candidates) {
  const dest = path.join(jobDir(jobId), 'candidates.json');
  fs.writeFileSync(dest, JSON.stringify(candidates, null, 2));
  return dest;
}

function loadCandidates(jobId) {
  const dest = path.join(jobDir(jobId), 'candidates.json');
  if (!fs.existsSync(dest)) return [];
  return JSON.parse(fs.readFileSync(dest, 'utf8'));
}

function saveIr(jobId, ir) {
  const dest = path.join(jobDir(jobId), 'document-ir.json');
  fs.writeFileSync(dest, JSON.stringify(ir, null, 2));
  return dest;
}

function loadIr(jobId) {
  const dest = path.join(jobDir(jobId), 'document-ir.json');
  if (!fs.existsSync(dest)) return null;
  return JSON.parse(fs.readFileSync(dest, 'utf8'));
}

function saveEntityMap(jobId, entityMap) {
  const dest = path.join(internalDir(jobId), 'entity-map.json');
  fs.writeFileSync(dest, JSON.stringify(entityMap, null, 2));
  return dest;
}

function loadEntityMap(jobId) {
  const dest = path.join(internalDir(jobId), 'entity-map.json');
  if (!fs.existsSync(dest)) return null;
  return JSON.parse(fs.readFileSync(dest, 'utf8'));
}

function saveRedactedDocx(jobId, buffer) {
  const dest = path.join(jobDir(jobId), 'redacted.docx');
  fs.writeFileSync(dest, buffer);
  return dest;
}

function loadRedactedDocx(jobId) {
  const dest = path.join(jobDir(jobId), 'redacted.docx');
  if (!fs.existsSync(dest)) return null;
  return fs.readFileSync(dest);
}

function saveLocalPassDocx(jobId, buffer) {
  const dest = path.join(jobDir(jobId), LOCAL_PASS_DOCX);
  fs.writeFileSync(dest, buffer);
  return dest;
}

function loadLocalPassDocx(jobId) {
  const dest = path.join(jobDir(jobId), LOCAL_PASS_DOCX);
  if (!fs.existsSync(dest)) return null;
  return fs.readFileSync(dest);
}

function hasLocalPassDocx(jobId) {
  return fs.existsSync(path.join(jobDir(jobId), LOCAL_PASS_DOCX));
}

/** Read append-only audit.jsonl as parsed objects (internal use / final report). */
function loadAuditEvents(jobId) {
  const dest = path.join(internalDir(jobId), 'audit.jsonl');
  if (!fs.existsSync(dest)) return [];
  return fs.readFileSync(dest, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { parseError: true, raw: line.slice(0, 200) };
      }
    });
}

function saveAuditTrailExport(jobId, report) {
  const dest = path.join(jobDir(jobId), 'INTERNAL-ONLY-audit-trail.json');
  fs.writeFileSync(dest, JSON.stringify(report, null, 2));
  return dest;
}

function hasAuditTrailExport(jobId) {
  return fs.existsSync(path.join(jobDir(jobId), 'INTERNAL-ONLY-audit-trail.json'));
}

function hasSanitizedPdf(jobId) {
  return fs.existsSync(path.join(jobDir(jobId), 'sanitized.pdf'));
}

function saveSanitizedPdf(jobId, buffer) {
  const dest = path.join(jobDir(jobId), 'sanitized.pdf');
  fs.writeFileSync(dest, buffer);
  return dest;
}

function deleteSanitizedPdf(jobId) {
  const dest = path.join(jobDir(jobId), 'sanitized.pdf');
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  return true;
}

function hashSanitizedPdf(jobId) {
  const dest = path.join(jobDir(jobId), 'sanitized.pdf');
  if (!fs.existsSync(dest)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
}

/**
 * Append-only audit log (local). Lives under internal/ so real values never ride export paths.
 * @param {string} jobId
 * @param {object} event
 */
function appendAudit(jobId, event) {
  const dest = path.join(internalDir(jobId), 'audit.jsonl');
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...event,
  });
  fs.appendFileSync(dest, `${line}\n`);
  return dest;
}

/**
 * Resolve a downloadable artifact path. Rejects anything under internal/ or unknown names.
 * @param {string} jobId
 * @param {string} artifactName
 * @returns {string} absolute path
 */
function resolveExportArtifactPath(jobId, artifactName) {
  const name = String(artifactName || '').trim();
  if (!EXPORTABLE_ARTIFACTS.includes(name)) {
    const err = new Error(`Unknown or non-exportable artifact: ${name}`);
    err.status = 404;
    throw err;
  }
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('internal')) {
    const err = new Error('Invalid artifact path');
    err.status = 400;
    throw err;
  }

  const root = path.resolve(jobDir(jobId));
  const full = path.resolve(root, name);

  if (full !== root && !full.startsWith(root + path.sep)) {
    const err = new Error('Path escape rejected');
    err.status = 400;
    throw err;
  }
  if (isUnderInternal(full, root)) {
    const err = new Error('Internal job files are not downloadable');
    err.status = 403;
    throw err;
  }
  if (!fs.existsSync(full)) {
    const err = new Error('Artifact not found — run apply first');
    err.status = 404;
    throw err;
  }
  return full;
}

/** True if absPath is the job's internal/ dir or a file beneath it. */
function isUnderInternal(absPath, jobRootAbs) {
  const internal = path.resolve(jobRootAbs, 'internal');
  const target = path.resolve(absPath);
  return target === internal || target.startsWith(internal + path.sep);
}

/**
 * Guard used by tests + routes: given any requested relative path under a job,
 * return whether it would be forbidden for export.
 */
function isExportForbiddenRelativePath(relativePath) {
  const rel = String(relativePath || '').replace(/\\/g, '/');
  if (!rel || rel.includes('..')) return true;
  if (rel === 'internal' || rel.startsWith('internal/')) return true;
  const base = path.posix.basename(rel);
  return !EXPORTABLE_ARTIFACTS.includes(base) || rel.includes('/');
}

function listJobsForUser(userId, limit = 20) {
  const root = ensureJobsRoot();
  if (!fs.existsSync(root)) return [];
  const ids = fs.readdirSync(root).filter((name) => {
    try {
      return fs.statSync(path.join(root, name)).isDirectory();
    } catch {
      return false;
    }
  });
  const jobs = [];
  for (const id of ids) {
    try {
      const job = loadJob(id, userId);
      if (job) jobs.push(job);
    } catch { /* skip */ }
  }
  jobs.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return jobs.slice(0, limit);
}

/**
 * Permanently delete a job directory owned by userId.
 * @returns {{ deleted: true, id: string } | never}
 */
function deleteJob(jobId, userId) {
  const job = loadJob(jobId, userId);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }
  const root = path.resolve(ensureJobsRoot());
  const dir = path.resolve(jobDir(job.id));
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    const err = new Error('Invalid job path');
    err.status = 400;
    throw err;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { deleted: true, id: job.id };
}

/**
 * @param {string[]} jobIds
 * @param {number|string} userId
 */
function deleteJobs(jobIds, userId) {
  const ids = [...new Set((jobIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) {
    const err = new Error('No job ids provided');
    err.status = 400;
    throw err;
  }
  const deleted = [];
  const failed = [];
  for (const id of ids) {
    try {
      deleteJob(id, userId);
      deleted.push(id);
    } catch (err) {
      failed.push({ id, error: err.message, status: err.status || 500 });
    }
  }
  return { deleted, failed };
}

module.exports = {
  jobsRoot,
  createJobShell,
  saveJob,
  loadJob,
  deleteJob,
  deleteJobs,
  saveOriginalDocx,
  loadOriginalDocx,
  saveCandidates,
  loadCandidates,
  saveIr,
  loadIr,
  saveEntityMap,
  loadEntityMap,
  saveRedactedDocx,
  loadRedactedDocx,
  saveLocalPassDocx,
  loadLocalPassDocx,
  hasLocalPassDocx,
  LOCAL_PASS_DOCX,
  hasSanitizedPdf,
  saveSanitizedPdf,
  deleteSanitizedPdf,
  hashSanitizedPdf,
  appendAudit,
  loadAuditEvents,
  saveAuditTrailExport,
  hasAuditTrailExport,
  resolveExportArtifactPath,
  isUnderInternal,
  isExportForbiddenRelativePath,
  EXPORTABLE_ARTIFACTS,
  listJobsForUser,
  jobDir,
  internalDir,
};
