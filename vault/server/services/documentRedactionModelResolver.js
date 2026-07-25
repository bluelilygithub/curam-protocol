'use strict';

/**
 * Document Redaction Agent — model card + runtime resolver.
 *
 * agentId: document-redaction-agent
 * Slots (settings keys):
 *   - local    → document_redaction_local_model  (candidate / apply pass)
 *   - frontier → document_redaction_frontier_model (residual-risk pass)
 *
 * Both slots accept any connected vault_models entry. No Local/Hosted designation.
 */

const { pool } = require('../db');
const { getVaultModelsConfigForUser } = require('./modelResolver');

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
      label: 'Candidate / apply model',
      required: true,
      inventory: 'any_connected',
    },
    {
      id: 'frontier',
      settingsKey: SLOT_KEYS.frontier,
      label: 'Residual-risk / frontier model',
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

/** Either agent slot: must be a connected vault_models entry. */
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
  return assertConnectedModel(userId, modelId, 'Candidate / apply');
}

async function assertFrontierSlotAllowed(userId, modelId) {
  return assertConnectedModel(userId, modelId, 'Residual-risk');
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
      errors.push('No candidate / apply model assigned on the document-redaction-agent card');
    } else {
      const entry = await assertLocalSlotAllowed(userId, localSlot.modelId);
      localHandle = {
        slot: 'local',
        modelId: localSlot.modelId,
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
      errors.push('No residual-risk model assigned on the document-redaction-agent card');
    } else {
      const entry = await assertFrontierSlotAllowed(userId, frontierSlot.modelId);
      frontierHandle = {
        slot: 'frontier',
        modelId: frontierSlot.modelId,
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

/** Card state for admin Settings UI — both slots share the full connected inventory. */
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
