'use strict';

// How the recycle bin handles Graphics recipes. The delete route (server/routes/graphics/recipes.js) snapshots the row and calls
// moveToBin(); this puts it back. A recipe has no child tables, so the row is the whole payload. See docs/recycle-bin.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');
const { MAX_RECIPES_PER_USER } = require('../../graphicsRecipes');

register('graphics-recipe', {
  label: 'Graphics recipe',
  async restore(db, userId, payload) {
    const r = payload?.recipe;
    if (!r || !Array.isArray(r.steps)) throw new Error('This deleted recipe has nothing to restore.');
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM graphics_recipes WHERE "userId" = $1', [userId]);
    if (Number(rows[0]?.n ?? 0) >= MAX_RECIPES_PER_USER) throw new RestoreError(`You already have ${MAX_RECIPES_PER_USER} recipes. Delete some to bring this one back.`, 409);
    // JSONB goes in as text: the driver would turn a JavaScript array into a Postgres array instead of JSON
    const entityId = await insertRow(db, 'graphics_recipes', r, { userId, override: { steps: JSON.stringify(r.steps) } });
    return { entityId };
  },
});
