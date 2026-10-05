'use strict';

// Mounted at /api/plant-images (server/index.js). Wires the image service to the database, the server's own plant-name list, and the logger.
const { requireAdmin } = require('../middleware/auth');
const { createPlantImageService, createPgStore } = require('../services/plantImages');
const names = require('../config/plantNames.json');

const service = createPlantImageService({
  store: createPgStore(require('../db').pool),
  names: (id) => (Object.prototype.hasOwnProperty.call(names, id) ? names[id] : null),
  log: require('../lib/logger'),
});
module.exports = require('./plantImagesRouter').createRouter(service, requireAdmin);
