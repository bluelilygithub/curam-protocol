'use strict';

/**
 * Shared download gate for redaction job artifacts.
 * Only redacted.docx / sanitized.pdf / INTERNAL-ONLY-audit-trail.json —
 * never entity-map or raw audit.jsonl under internal/.
 */

const {
  loadJob,
  resolveExportArtifactPath,
  isExportForbiddenRelativePath,
  EXPORTABLE_ARTIFACTS,
} = require('./jobStore');

const AUDIT_TRAIL_ARTIFACT = 'INTERNAL-ONLY-audit-trail.json';

/**
 * Resolve a downloadable file for a job, or throw with .status.
 * @returns {{ filePath: string, downloadName: string, job: object }}
 */
function resolveJobDownload(jobId, userId, artifactName) {
  let artifact = String(artifactName || '').trim();
  try {
    artifact = decodeURIComponent(artifact);
  } catch {
    /* keep raw */
  }

  if (isExportForbiddenRelativePath(artifact)) {
    const err = new Error(
      'Artifact is not exportable (internal files and unknown names are blocked)',
    );
    err.status = 403;
    err.code = 'EXPORT_FORBIDDEN';
    err.allowed = [...EXPORTABLE_ARTIFACTS];
    throw err;
  }

  const job = loadJob(jobId, userId);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }

  if (artifact === AUDIT_TRAIL_ARTIFACT) {
    if (!job.finalApprovedAt) {
      const err = new Error(
        'INTERNAL-ONLY audit trail is only available after final document approval',
      );
      err.status = 403;
      err.code = 'FINAL_APPROVAL_REQUIRED';
      throw err;
    }
  }

  const filePath = resolveExportArtifactPath(job.id, artifact);
  const base = String(job.originalFilename || 'document').replace(/\.docx$/i, '');
  const downloadName = artifact === AUDIT_TRAIL_ARTIFACT
    ? `${base}-INTERNAL-ONLY-audit-trail.json`
    : `${base}-${artifact}`;
  return {
    job,
    filePath,
    downloadName,
  };
}

/** Express-compatible handler factory (used by routes + HTTP tests). */
function createDownloadHandler() {
  return (req, res) => {
    try {
      const artifact = req.params.artifact != null && req.params.artifact !== ''
        ? req.params.artifact
        : (req.params[0] || '');
      const { filePath, downloadName } = resolveJobDownload(
        req.params.id,
        req.user.id,
        artifact,
      );
      res.download(filePath, downloadName);
    } catch (err) {
      res.status(err.status || 500).json({
        error: err.message,
        code: err.code,
        allowed: err.allowed,
      });
    }
  };
}

module.exports = {
  resolveJobDownload,
  createDownloadHandler,
  EXPORTABLE_ARTIFACTS,
  AUDIT_TRAIL_ARTIFACT,
};
