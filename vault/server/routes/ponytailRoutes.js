'use strict';

// Ponytail report wiring (server/index.js). The routes live in ponytail.js, which takes its dependencies so the test can swap them.
//   ingestRouter -> /api/ponytail/ingest  BEFORE requireAuth and before the body parser (it checks its own key first)
//   adminRouter  -> /api/ponytail         behind requireAuth + requireAdmin

const { pool } = require('../db');
const { createRouters } = require('./ponytail');

const { ingest, admin } = createRouters({ pool });

module.exports = { ingestRouter: ingest, adminRouter: admin };
