'use strict';

/**
 * Document Redaction Agent — model card + runtime resolver.
 *
 * agentId: document-redaction-agent
 * Slots (settings keys, same pattern as default_model / branch_eval_model):
 *   - local    → document_redaction_local_model
 *   - frontier → document_redaction_frontier_model
 *
 * Local slot is privacy-critical: only models with admin-confirmed
 * execution === 'local' (via getModelsByExecution) may be assigned.
 */

const { pool } = require('../db');
const {
  getModelsByExecution,
  getVaultModelsConfigForUser,
  isValidExecution,
} = require('./modelResolver');

const AGENT_ID = 'document-redaction-agent';

const SLOT_KEYS = {
  local: 'document_redaction_local_model',
  frontier: 'document_redaction_frontier_model',
};

const AGENT_CARD = {
  agentId: AGENT_ID,
  title: 'Document redaction agent',
  slots: [
    {
      id: 'local',
      settingsKey: SLOT_KEYS.local,
      label: 'Local model (candidate extraction & redaction application)',
      required: true,
      /** Only admin-confirmed execution:local — never provider/id heuristics. */
      inventory: 'local_execution_only',
    },
    {
      id: 'frontier',
      settingsKey: SLOT_KEYS.frontier,
      label: 'Frontier model (residual-risk analysis on sanitized output)',
      required: true,
      inventory: 'any_connected',
    },
  ],
};

async function loadSetting(userId, key) {
  if (!userId || !key) return null;
  const { rows } = await pool.query(
    'SELECT value FROM settings WHERE "userId"=$1 AND key=$2',
    [userId, key],
  );
  const v = rows[0]?.value;
  return v != null && String(v).trim() ? String(v).trim() : null;
}

async function loadFirstAdminSetting(key) {
  const { rows } = await pool.query(
    `SELECT s.value
     FROM settings s
     JOIN users u ON u.id = s."userId"
     WHERE u."isAdmin" = TRUE AND s.key = $1
     ORDER BY s."userId" ASC
     LIMIT 1`,
    [key],
  );
  const v = rows[0]?.value;
  return v != null && String(v).trim() ? String(v).trim() : null;
}

/** Resolve setting from user, else first admin (same fallback style as vault_models). */
async function resolveSlotSetting(userId, key) {
  const own = await loadSetting(userId, key);
  if (own) return { modelId: own, fromAdmin: false };
  const admin = await loadFirstAdminSetting(key);
  if (admin) return { modelId: admin, fromAdmin: true };
  return { modelId: null, fromAdmin: false };
}

function catalogEntryById(models, modelId) {
  if (!modelId || !Array.isArray(models)) return null;
  return models.find((m) => m && String(m.id).trim() === modelId) || null;
}

/**
 * Validate a proposed local-slot assignment.
 * Must appear in getModelsByExecution(userId, 'local') — no full-inventory fallback.
 */
async function assertLocalSlotAllowed(userId, modelId) {
  const id = String(modelId || '').trim();
  if (!id) {
    const err = new Error('Local model is required for the document redaction agent');
    err.status = 400;
    throw err;
  }
  const localModels = await getModelsByExecution(userId, 'local');
  const allowed = localModels.some((m) => String(m.id).trim() === id);
  if (!allowed) {
    const err = new Error(
      'Local redaction model must be chosen from admin-confirmed local-execution inventory '
      + '(getModelsByExecution("local")). Hosted/API models cannot be assigned to this slot.',
    );
    err.status = 400;
    err.localExecutionModelIds = localModels.map((m) => m.id);
    throw err;
  }
  return localModels.find((m) => String(m.id).trim() === id);
}

/**
 * Frontier may be any connected catalog model (local or hosted) that exists in vault_models.
 */
async function assertFrontierSlotAllowed(userId, modelId) {
  const id = String(modelId || '').trim();
  if (!id) {
    const err = new Error('Frontier model is required for the document redaction agent');
    err.status = 400;
    throw err;
  }
  const { models } = await getVaultModelsConfigForUser(userId);
  const entry = catalogEntryById(models, id);
  if (!entry) {
    const err = new Error('Frontier model must be a connected model in the vault_models inventory');
    err.status = 400;
    throw err;
  }
  return entry;
}

/**
 * Runtime resolver for later milestones.
 * @param {{ userId: number|string, jobId?: string }} ctx
 * @returns {{ agentId, local, frontier, ok, errors }}
 */
async function resolveDocumentRedactionModels(ctx = {}) {
  const userId = ctx.userId;
  if (!userId) {
    return {
      agentId: AGENT_ID,
      jobId: ctx.jobId || null,
      ok: false,
      local: null,
      frontier: null,
      errors: ['userId required'],
    };
  }

  const errors = [];
  const localSlot = await resolveSlotSetting(userId, SLOT_KEYS.local);
  const frontierSlot = await resolveSlotSetting(userId, SLOT_KEYS.frontier);

  let localHandle = null;
  let frontierHandle = null;

  try {
    if (!localSlot.modelId) {
      errors.push('No local model assigned on the document-redaction-agent card');
    } else {
      const entry = await assertLocalSlotAllowed(userId, localSlot.modelId);
      localHandle = {
        slot: 'local',
        modelId: localSlot.modelId,
        execution: 'local',
        provider: entry?.provider || null,
        name: entry?.name || null,
        fromAdmin: localSlot.fromAdmin,
        settingsKey: SLOT_KEYS.local,
      };
    }
  } catch (err) {
    errors.push(err.message);
  }

  try {
    if (!frontierSlot.modelId) {
      errors.push('No frontier model assigned on the document-redaction-agent card');
    } else {
      const entry = await assertFrontierSlotAllowed(userId, frontierSlot.modelId);
      frontierHandle = {
        slot: 'frontier',
        modelId: frontierSlot.modelId,
        execution: isValidExecution(entry?.execution) ? entry.execution : null,
        provider: entry?.provider || null,
        name: entry?.name || null,
        fromAdmin: frontierSlot.fromAdmin,
        settingsKey: SLOT_KEYS.frontier,
      };
    }
  } catch (err) {
    errors.push(err.message);
  }

  return {
    agentId: AGENT_ID,
    jobId: ctx.jobId || null,
    ok: errors.length === 0 && !!localHandle && !!frontierHandle,
    local: localHandle,
    frontier: frontierHandle,
    errors,
  };
}

/**
 * Card state for admin Settings UI.
 * localChoices comes ONLY from getModelsByExecution('local') — empty means empty dropdown.
 */
async function getDocumentRedactionAgentCardConfig(userId) {
  const localChoices = await getModelsByExecution(userId, 'local');
  const { models: allConnected } = await getVaultModelsConfigForUser(userId);
  const localSlot = await resolveSlotSetting(userId, SLOT_KEYS.local);
  const frontierSlot = await resolveSlotSetting(userId, SLOT_KEYS.frontier);

  const localStillValid = localSlot.modelId
    && localChoices.some((m) => String(m.id).trim() === localSlot.modelId);

  return {
    agentId: AGENT_ID,
    card: AGENT_CARD,
    local: {
      settingsKey: SLOT_KEYS.local,
      label: AGENT_CARD.slots[0].label,
      modelId: localStillValid ? localSlot.modelId : '',
      assignedModelId: localSlot.modelId,
      assignmentValid: !localSlot.modelId || !!localStillValid,
      fromAdmin: localSlot.fromAdmin,
      /** Sole source for the local dropdown — never substitute full inventory. */
      choices: localChoices,
      choiceIds: localChoices.map((m) => m.id),
    },
    frontier: {
      settingsKey: SLOT_KEYS.frontier,
      label: AGENT_CARD.slots[1].label,
      modelId: frontierSlot.modelId || '',
      fromAdmin: frontierSlot.fromAdmin,
      choices: allConnected,
    },
  };
}

module.exports = {
  AGENT_ID,
  AGENT_CARD,
  SLOT_KEYS,
  resolveDocumentRedactionModels,
  getDocumentRedactionAgentCardConfig,
  assertLocalSlotAllowed,
  assertFrontierSlotAllowed,
};
