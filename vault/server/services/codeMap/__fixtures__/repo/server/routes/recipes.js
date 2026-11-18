const { callModel } = require('../services/callModel');
const kit = require('../services/recipeKit');
const { safeFetch } = require('../utils/safeFetch');
router.post('/import', async (req) => safeFetch(req.body.url).then(() => callModel({ model: getModelsForUser(1).standard, kit })));
