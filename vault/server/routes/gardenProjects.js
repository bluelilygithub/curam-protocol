'use strict';

// Mounted at /api/garden-projects (server/index.js). The routes live in gardenProjectsRouter.js, which takes the pool as an argument so
// its tests can run without a database.
module.exports = require('./gardenProjectsRouter').createRouter(require('../db').pool);
