'use strict';

// Mounted at /api/geocode (server/index.js). The router lives in geocodeRouter.js so its tests need no database.
const { createGeocoder, pgStore } = require('../services/geocode');

module.exports = require('./geocodeRouter').createRouter(createGeocoder({ store: pgStore(require('../db').pool) }));
