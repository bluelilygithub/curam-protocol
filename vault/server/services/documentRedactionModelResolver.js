'use strict';

/**
 * Document Redaction Agent — model card + runtime resolver.
 *
 * agentId: document-redaction-agent
 * Slots (settings keys, same pattern as default_model / branch_eval_model):
 *   - local    → document_redaction_local_model  (on-device / candidate pass)
 *   - frontier → document_redaction_frontier_model (residual-risk pass)
 *
 * Both slots accept any connected vault_models entry so demos can use two
 * local models. Admin UI shows Local/Hosted icons on every option; execution
 * type is informational, not a dropdown filter.
 */

const { pool } = require('../db');
const {
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
      inventory: 'any_connected',
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
 * Either agent slot: must be a connected vault_models entry (local or hosted).
 */
async function assertConnectedModel(userId, modelId, slotLabel) {
  const id = String(modelId || '').trim();
  if (!id) {
    const err = new Error(`${slotLabel} model is required for the document redaction agent`);
    err.status = 400;
    throw err;
  }
  const { models } = await getVaultModelsConfigForUser(userId);
  const entry = catalogEntryById(models, id);
  if (!entry) {
    const err = new Error(
      `${slotLabel} model must be a connected model in the vault_models inventory`,
    );
    err.status = 400;
    throw err;
  }
  return entry;
}

async function assertLocalSlotAllowed(userId, modelId) {
  return assertConnectedModel(userId, modelId, 'Local');
}

async function assertFrontierSlotAllowed(userId, modelId) {
  return assertConnectedModel(userId, modelId, 'Frontier');
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
        execution: isValidExecution(entry?.execution) ? entry.execution : null,
        provider: entry?.provider || null,
        name: entry?.name || null,
        fromAdminFallback: localSlot.fromAdmin,
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
        fromAdminFallback: frontierSlot.fromAdmin,
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
 * Card state for admin Settings UI — both slots share the full connected inventory.
 */
async function getDocumentRedactionAgentCardConfig(userId) {
  const { models: allConnected } = await getVaultModelsConfigForUser(userId);
  const localSlot = await resolveSlotSetting(userId, SLOT_KEYS.local);
  const frontierSlot = await resolveSlotSetting(userId, SLOT_KEYS.frontier);

  const localEntry = catalogEntryById(allConnected, localSlot.modelId);
  const frontierEntry = catalogEntryById(allConnected, frontierSlot.modelId);

  return {
    agentId: AGENT_ID,
    card: AGENT_CARD,
    local: {
      settingsKey: SLOT_KEYS.local,
      label: AGENT_CARD.slots[0].label,
      modelId: localEntry ? localSlot.modelId : '',
      assignedModelId: localSlot.modelId,
      assignmentValid: !localSlot.modelId || !!localEntry,
      fromAdmin: localSlot.fromAdmin,
      execution: localEntry?.execution || null,
      choices: allConnected,
      choiceIds: allConnected.map((m) => m.id),
    },
    frontier: {
      settingsKey: SLOT_KEYS.frontier,
      label: AGENT_CARD.slots[1].label,
      modelId: frontierEntry ? frontierSlot.modelId : '',
      assignedModelId: frontierSlot.modelId,
      assignmentValid: !frontierSlot.modelId || !!frontierEntry,
      fromAdmin: frontierSlot.fromAdmin,
      execution: frontierEntry?.execution || null,
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
