'use strict';

// BIP orchestration: stage 1 seed → stage 2 enrichment → stage 3 reconciliation → stage 4 cards. Every module is isolated: a
// module that fails or is skipped leaves a status row and never stops the others. Everything is written to Postgres as it lands.

const { MODULES, runModule, seedAll, configured, businessName } = require('./sources');
const { reconcile } = require('./reconcile');
const { buildCards } = require('./cards');
const store = require('./store');

const SEED = ['registration', 'dns', 'website', 'domainsTool'];
const ENRICHMENT = ['abr', 'asic', 'places', 'googleSearch', 'socialLinks', 'productReview', 'trustpilot', 'techStack'];
const ALL_MODULES = MODULES.map((m) => m.name);

function summarise(results) {
  const out = {};
  for (const [name, result] of Object.entries(results || {})) {
    out[name] = { status: result?.status || 'failed', reason: result?.reason || null, error: result?.error || null };
  }
  return out;
}

/**
 * Run (or re-run) a profile.
 * @param {{profileId:number,userId:number,domain:string,modules?:string[],decisions?:object,deps?:object,onProgress?:Function}} opts
 */
async function runProfile({ profileId, userId, domain, modules = null, decisions = {}, deps = {}, onProgress = () => {} }) {
  const ctx = { deps, userId, profileId };
  const refresh = Array.isArray(modules) && modules.length ? modules.filter((n) => ALL_MODULES.includes(n)) : null;
  try {
    let seed;
    let results = {};

    if (refresh) {
      const current = await store.getProfile(userId, profileId);
      if (!current) throw new Error('That profile no longer exists.');
      seed = current.seed;
      results = { ...(current.modules || {}) };
      onProgress({ phase: 'refresh', current: 0, total: refresh.length, module: null });
      let done = 0;
      const seedNames = refresh.filter((name) => SEED.includes(name));
      const enrichNames = refresh.filter((name) => ENRICHMENT.includes(name));
      // Seed sources run first: enrichment modules read the seed, so a website refresh must land before social links or tech stack.
      for (const name of seedNames) {
        const result = await runModule(name, seed, ctx);
        results[name] = result;
        if (result.data && typeof result.data === 'object') seed[name] = result.data;
        await store.saveModule(profileId, userId, name, result);
        await store.saveSeedData(profileId, userId, seed);
        done += 1;
        onProgress({ phase: 'refresh', current: done, total: refresh.length, module: name });
      }
      await Promise.all(enrichNames.map(async (name) => {
        const result = await runModule(name, seed, ctx);
        results[name] = result;
        await store.saveModule(profileId, userId, name, result);
        done += 1;
        onProgress({ phase: 'refresh', current: done, total: refresh.length, module: name });
      }));
    } else {
      onProgress({ phase: 'seed', current: 0, total: ENRICHMENT.length, module: null });
      const seeded = await seedAll(domain, ctx);
      seed = seeded.seed;
      results = { ...seeded.results };
      await store.saveSeed(profileId, userId, seed, summarise(results));
      onProgress({ phase: 'seed', current: 4, total: ENRICHMENT.length, module: null });

      let done = 0;
      await Promise.all(ENRICHMENT.map(async (name) => {
        const result = await runModule(name, seed, ctx);
        results[name] = result;
        await store.saveModule(profileId, userId, name, result);
        done += 1;
        onProgress({ phase: 'enrich', current: done, total: ENRICHMENT.length, module: name });
      }));
    }

    const reconciliation = reconcile(seed, results, decisions);
    const cards = buildCards(seed, results, reconciliation);
    const name = businessName({ ...seed, abr: results.abr?.data || null });
    await store.finishProfile(profileId, userId, { businessName: name, reconciliation: { ...reconciliation, decisions }, cards });
    onProgress({ phase: 'done', current: 1, total: 1, module: null });
    return { profileId, domain, status: 'done', businessName: name, conflicts: reconciliation.conflicts };
  } catch (err) {
    await store.failProfile(profileId, userId, err.message).catch(() => {});
    onProgress({ phase: 'error', current: 0, total: 1, module: null });
    throw err;
  }
}

module.exports = { runProfile, SEED, ENRICHMENT, ALL_MODULES, configured, summarise };
