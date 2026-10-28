'use strict';

// Vault Shelf wiring (server/index.js). The routes live in quickIngestRouter.js, which takes its dependencies as an argument so the test can
// run without a model or the network. `routeDeps` is exported so a test can swap one (the model call, the file saver) after the app is loaded.
//   ingestRouter  -> /api/quick-ingest   BEFORE requireAuth and before the body parser (it checks its own key first)
//   tokensRouter  -> /api/shelf-tokens   behind requireAuth + requireFeature('shelf')
//   inboxRouter   -> /api/shelf-inbox    behind requireAuth + requireFeature('clients')

const { pool } = require('../db');
const { loadFeatureAccess } = require('../middleware/auth');
const { createRouters } = require('./quickIngestRouter');

const routeDeps = {
  pool,
  loadFeatureAccess,
  // loaded when first used: these pull in large modules (Gmail, models, image tools) that a key check should not wait for
  extractExpenseClip: (clip) => require('../services/shelfExtract').extractExpenseClip(clip),
  saveInvoiceFile: (...a) => require('../services/expenseReviewService').saveInvoiceFile(...a),
  queueEmbed: (userId, noteId) => { try { require('../services/noteEmbeddings').queueEmbed(userId, noteId); } catch { /* search by meaning catches up later */ } },
  assertAttachmentQuota: (userId, bytes) => require('../utils/attachments').assertWithinQuota(userId, bytes),
  saveBufferAttachment: (a) => require('../utils/attachments').saveBufferAttachment(a),
  deleteAttachmentsForEntityIds: (...a) => require('../utils/attachments').deleteAttachmentsForEntityIds(...a),
  logCrmAudit: (a) => require('../utils/crmAudit').logCrmAudit(a),
};

const { ingest, tokens, inbox } = createRouters(routeDeps);

module.exports = { ingestRouter: ingest, tokensRouter: tokens, inboxRouter: inbox, routeDeps };
