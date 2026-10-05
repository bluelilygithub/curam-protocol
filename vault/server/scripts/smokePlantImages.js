#!/usr/bin/env node
/**
 * Live check of the plant photo sources (staging check): node server/scripts/smokePlantImages.js [plant-id ...]
 * Uses the real APIs with an in-memory store, so it writes nothing. Prints what was accepted and why others were rejected.
 * Set ALA_API_KEY to include the Atlas of Living Australia.
 */
'use strict';
const { createPlantImageService, createMemoryStore } = require('../services/plantImages');
const names = require('../config/plantNames.json');

(async () => {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['grevillea-robusta', 'lavandula-angustifolia'];
  const store = createMemoryStore();
  const service = createPlantImageService({ store, names: (id) => names[id] ?? null, env: { ...process.env, APP_URL: process.env.APP_URL || 'https://curam-vault.up.railway.app' } });
  console.log('sources:', service.enabledSources().join(', '));
  for (const id of ids) {
    const r = await service.refresh(id);
    console.log(`\n${id} (${names[id]}): ${r.status}, ${r.accepted ?? 0} accepted`);
    for (const e of r.errors ?? []) console.log('  error:', e);
    const why = {};
    for (const x of r.rejected ?? []) why[`${x.source}: ${x.why}`] = (why[`${x.source}: ${x.why}`] ?? 0) + 1;
    for (const [k, n] of Object.entries(why)) console.log(`  rejected ${n} x ${k}`);
    for (const i of (await service.images(id)).images.slice(0, 6)) console.log(`  ${i.role.padEnd(7)} ${i.credit}  <${i.sourceUrl}>`);
  }
})();
