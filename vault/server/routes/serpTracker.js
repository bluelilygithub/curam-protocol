'use strict';

module.exports = require('./serpTrackerRouter').createRouter(require('../db').pool);
