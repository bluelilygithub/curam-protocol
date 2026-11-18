const { callModel } = require('../services/callModel');
const FALLBACK = 'claude-sonnet-4-6';
router.post('/fetch', async (req) => {
  const { url } = req.body;
  const page = await fetch(url);
  return callModel({ model: getModelsForUser(1).standard || FALLBACK, page });
});
