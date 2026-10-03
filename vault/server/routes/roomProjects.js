'use strict';

// Mounted at /api/room-projects (server/index.js). The routes live in roomProjectsRouter.js, which takes the pool as an argument so
// its tests can run without a database.
module.exports = require('./roomProjectsRouter').createRouter(require('../db').pool);
