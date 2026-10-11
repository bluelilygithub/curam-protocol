'use strict';

// Mounted at /api/route-tracks (server/index.js). The routes live in routeTracksRouter.js, which takes the pool as an argument so
// its tests can run without a database.
module.exports = require('./routeTracksRouter').createRouter(require('../db').pool);
