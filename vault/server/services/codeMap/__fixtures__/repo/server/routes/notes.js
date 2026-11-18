const { moveToBin } = require('../services/bin');
router.delete('/:id', async () => moveToBin());
module.exports = router;
