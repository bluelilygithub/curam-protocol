'use strict';

// Recycle bin support for Presentations (docs/presentations.md). The delete routes snapshot the row in the same transaction
// and put it in the bin; these two adapters put it back if the person changes their mind.

const { register } = require('../index');
const { insertRow } = require('../rowRestore');

register('presentation-deck', {
  label: 'Presentation deck',
  async restore(db, userId, payload) {
    const row = payload?.deck;
    if (!row || !Array.isArray(row.data?.slides)) throw new Error('This deleted presentation has nothing to restore.');
    const id = await insertRow(db, 'presentation_decks', row, { userId });
    return { entityId: id };
  },
});

register('presentation-template', {
  label: 'Presentation theme',
  async restore(db, userId, payload) {
    const row = payload?.theme;
    if (!row || !row.theme || typeof row.theme !== 'object') throw new Error('This deleted theme has nothing to restore.');
    const id = await insertRow(db, 'presentation_templates', row, { userId });
    return { entityId: id };
  },
});
