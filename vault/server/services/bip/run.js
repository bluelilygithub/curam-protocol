'use strict';

// BIP orchestration: stage 1 seed → stage 2 enrichment → stage 3 reconciliation → stage 4 cards. Every module is isolated: a
// module that fails or is skipped leaves a status row and never stops the others. Everything is written to Postgres as it lands.

const { MODULES, runModule, seedAll, configured, businessName } = require('./sources');
const { reconcile } = require('./reconcile');
const { buildCards } = require('./cards');
const store = require('./store');

const SEED = ['registration', 'dns', 'website', 'domainsTool'];
const ENRICHMENT = ['abr', 'asic', 'places', 'googleSearch', 'socialLinks', 'productReview', 'trustpilot', 'techStack'];
// after ENRICHMENT, with the ABN Lookup result in the seed so research can search by the registered name
const RESEARCH = ['webResearch'];
const withAbr = (seed, results) => ({ ...seed, abr: results.abr?.data || seed?.abr || null });
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
      // seed modules are stored in enrichmentData as status only (saveSeed); their data lives in seedData. Without this, refreshing
      // any one source rebuilt the cards with no website, registration or DNS data (description, phone, address all dropped out).
      for (const name of SEED) {
        if (seed?.[name] && !results[name]?.data) results[name] = { ...(results[name] || { status: 'success' }), data: seed[name] };
      }
      onProgress({ phase: 'refresh', current: 0, total: refresh.length, module: null });
      let done = 0;
      const seedNames = refresh.filter((name) => SEED.includes(name));
      const enrichNames = refresh.filter((name) => ENRICHMENT.includes(name));
      const researchNames = refresh.filter((name) => RESEARCH.includes(name));
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
      for (const name of researchNames) {
        onProgress({ phase: 'refresh', current: done, total: refresh.length, module: name });
        const result = await runModule(name, withAbr(seed, results), ctx);
        results[name] = result;
        await store.saveModule(profileId, userId, name, result);
        done += 1;
      }
    } else {
      onProgress({ phase: 'seed', current: 0, total: ENRICHMENT.length, module: null });
      const seeded = await seedAll(domain, ctx);
      seed = seeded.seed;
      results = { ...seeded.results };
      await store.saveSeed(profileId, userId, seed, summarise(results));
      onProgress({ phase: 'seed', current: 4, total: ENRICHMENT.length, module: null });

      let done = 0;
      const total = ENRICHMENT.length + RESEARCH.length;
      await Promise.all(ENRICHMENT.map(async (name) => {
        const result = await runModule(name, seed, ctx);
        results[name] = result;
        await store.saveModule(profileId, userId, name, result);
        done += 1;
        onProgress({ phase: 'enrich', current: done, total, module: name });
      }));
      for (const name of RESEARCH) {
        onProgress({ phase: 'enrich', current: done, total, module: name });
        const result = await runModule(name, withAbr(seed, results), ctx);
        results[name] = result;
        await store.saveModule(profileId, userId, name, result);
        done += 1;
      }
    }

    const reconciliation = reconcile(seed, results, decisions);
    const cards = buildCards(seed, results, reconciliation);
    const name = businessName({ ...seed, abr: results.abr?.data || null });
    await store.finishProfile(profileId, userId, { businessName: name, reconciliation: { ...reconciliation, decisions }, cards });
    // the written summary is a courtesy: if the model fails, the profile is still finished and Regenerate can try again
    onProgress({ phase: 'summary', current: 1, total: 1, module: null });
    await (deps.generateSummary || require('./summary').generateSummary)(userId, profileId)
      .catch((err) => console.warn(`[bip] summary for profile ${profileId} not written:`, err.message));
    onProgress({ phase: 'done', current: 1, total: 1, module: null });
    return { profileId, domain, status: 'done', businessName: name, conflicts: reconciliation.conflicts };
  } catch (err) {
    await store.failProfile(profileId, userId, err.message).catch(() => {});
    onProgress({ phase: 'error', current: 0, total: 1, module: null });
    throw err;
  }
}

module.exports = { runProfile, SEED, ENRICHMENT, ALL_MODULES, configured, summarise };
