'use strict';

// Mounted at /api/cellar-projects (server/index.js). The routes live in cellarProjectsRouter.js, which takes the pool as an argument so
// its tests can run without a database.
module.exports = require('./cellarProjectsRouter').createRouter(require('../db').pool);
