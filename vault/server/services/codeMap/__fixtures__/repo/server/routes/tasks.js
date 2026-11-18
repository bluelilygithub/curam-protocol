const { callModel } = require('../services/callModel');
const { aiLimiter } = require('../middleware/limits');
router.post('/x', aiLimiter, () => callModel({ model: getModelsForUser(1).light }));
