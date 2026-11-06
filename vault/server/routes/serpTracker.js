'use strict';

const { pool } = require('../db');
const { createGeocoder, pgStore } = require('../services/geocode');

module.exports = require('./serpTrackerRouter').createRouter(pool, { geocoder: createGeocoder({ store: pgStore(pool) }) });
