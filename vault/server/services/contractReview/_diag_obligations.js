'use strict';
// Temporary diagnostic — not part of the test suite. Prints the RAW model
// output for the scanned fixture's obligation extraction, before any
// sanitization, so a null-rrule bug can be diagnosed without the test's own
// cleanup deleting the evidence first.
require('dotenv').config();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool, initSchema } = require('../../db');
const ContractService = require('./contractService');
const { ingestDocument } = require('./ingest');
const { segmentDocument } = require('./segmentation');
const { runAnalysis } = require('./analysisPipeline');
const { buildAllFixtures } = require('./smokeSet/buildFixtures');

async function main() {
  await initSchema();
  const { rows } = await pool.query(`INSERT INTO users (email, "passwordHash") VALUES ($1, 'x') RETURNING id`, [`diag-${Date.now()}@example.invalid`]);
  const userId = rows[0].id;
  await pool.query(`INSERT INTO settings ("userId", key, value) VALUES ($1, 'vault_models', $2)`, [userId, JSON.stringify([{ id: 'claude-haiku-4-5-20251001', name: 'Haiku', provider: 'anthropic' }])]);

  const fx = (await buildAllFixtures()).scanned;
  const contract = await ContractService.createContract(userId, { title: 'diag' });
  const doc = await ContractService.addDocument(userId, contract.id, { file: { buffer: fx.buffer, filename: fx.filename, mimeType: fx.mimeType } });
  const ingestResult = await ingestDocument(doc.id);
  console.log('ingest outcome:', ingestResult.outcome);
  await segmentDocument(ingestResult.reviewId, ingestResult.extractedText, ingestResult.pageMap, { userId });
  await runAnalysis(ingestResult.reviewId, { userId });

  const { rows: parties } = await pool.query(`SELECT * FROM contract_parties WHERE "contractId"=$1`, [contract.id]);
  console.log('parties:', parties.map(p => ({ name: p.name, role: p.role })));
  const tenant = parties.find(p => /orchard/i.test(p.name));
  await ContractService.confirmParty(userId, contract.id, tenant.id);
  const { resumeAfterRoleConfirmation } = require('./analysisPipeline');
  await resumeAfterRoleConfirmation(ingestResult.reviewId, { userId });

  const { rows: rawOutputs } = await pool.query(
    `SELECT stage, "rawResponse" FROM contract_review_raw_outputs WHERE "reviewId"=$1 AND stage='extracting_obligations'`,
    [ingestResult.reviewId]
  );
  for (const r of rawOutputs) {
    console.log('=== RAW MODEL RESPONSE (extracting_obligations) ===');
    console.log(JSON.stringify(r.rawResponse, null, 2));
  }

  const { rows: obligations } = await pool.query(`SELECT * FROM contract_obligations WHERE "reviewId"=$1`, [ingestResult.reviewId]);
  console.log('=== STORED OBLIGATIONS ===');
  console.log(JSON.stringify(obligations, null, 2));

  await pool.query(`DELETE FROM users WHERE id=$1`, [userId]);
  await pool.end();
}

main().catch(async (err) => { console.error(err); try { await pool.end(); } catch (_) {} process.exit(1); });
