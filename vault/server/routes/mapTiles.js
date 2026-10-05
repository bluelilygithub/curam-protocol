'use strict';

// Mounted at /api/map-tiles (server/index.js). The router lives in mapTilesRouter.js so its tests need no database.
module.exports = require('./mapTilesRouter').createRouter();
