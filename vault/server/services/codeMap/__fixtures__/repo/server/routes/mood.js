const { callModel } = require('../services/callModel');
router.post('/', () => callModel({ messages: [] }));
router.delete('/:id', () => null);
console.log('a'); console.log('b'); console.warn('c');
console.error('d'); console.info('e'); console.log('f');
