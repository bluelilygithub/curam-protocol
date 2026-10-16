'use strict';

/**
 * "Does this belong to the caller?" checks for records that carry no user column of their own.
 * A record someone else owns must behave exactly like one that does not exist, so callers answer
 * both the same way (404, or the empty result the route already gave for a missing record).
 * The chat rule is the one routes/chat.js uses: the caller owns the session, or owns the project
 * it lives in.
 */

const { pool } = require('../db');

const asInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// The caller owns the chat, or owns the project it lives in. A chat with no saved session row counts
// only if its messages sit in one of the caller's projects, so an unsaved chat cannot be claimed by id alone.
async function ownsSession(userId, sessionId) {
  if (sessionId == null || sessionId === '') return false;
  const { rows } = await pool.query(
    `SELECT 1
     WHERE EXISTS (
       SELECT 1 FROM sessions s LEFT JOIN projects p ON p.id = s."projectId"
       WHERE s."sessionId" = $1 AND (s."userId" = $2 OR (s."projectId" IS NOT NULL AND p."userId" = $2))
     )
     OR (
       NOT EXISTS (SELECT 1 FROM sessions WHERE "sessionId" = $1)
       AND EXISTS (SELECT 1 FROM messages m JOIN projects p ON p.id = m."projectId" WHERE m."sessionId" = $1 AND p."userId" = $2)
     )`,
    [String(sessionId), userId]
  );
  return rows.length > 0;
}

async function ownsProject(userId, projectId) {
  const id = asInt(projectId);
  if (!id) return false;
  const { rows } = await pool.query('SELECT 1 FROM projects WHERE id=$1 AND "userId"=$2', [id, userId]);
  return rows.length > 0;
}

// A file belongs to whoever owns its project.
async function ownsFile(userId, fileId) {
  const id = asInt(fileId);
  if (!id) return false;
  const { rows } = await pool.query(
    'SELECT 1 FROM files f JOIN projects p ON p.id = f."projectId" WHERE f.id=$1 AND p."userId"=$2',
    [id, userId]
  );
  return rows.length > 0;
}

// A message belongs to the caller if its chat does, or its project does. Returns the message, or null.
async function ownedMessage(userId, messageId) {
  const id = asInt(messageId);
  if (!id) return null;
  const { rows } = await pool.query('SELECT id, "sessionId", "projectId" FROM messages WHERE id=$1', [id]);
  const m = rows[0];
  if (!m) return null;
  if (m.projectId && (await ownsProject(userId, m.projectId))) return m;
  if (await ownsSession(userId, m.sessionId)) return m;
  return null;
}

// Which of these task ids belong to the caller. A task is theirs if it, or the task it is a subtask of
// (at any depth), carries their user id: subtasks made by a template have no user id of their own.
async function ownedTaskIds(userId, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(asInt).filter(Boolean))];
  if (!list.length) return [];
  const { rows } = await pool.query(
    `WITH RECURSIVE chain AS (
       SELECT id AS orig, id, "userId", "parentTaskId" FROM tasks WHERE id = ANY($1::int[])
       UNION ALL
       SELECT c.orig, t.id, t."userId", t."parentTaskId" FROM tasks t JOIN chain c ON t.id = c."parentTaskId"
     )
     SELECT DISTINCT orig AS id FROM chain WHERE "userId" = $2`,
    [list, userId]
  );
  return rows.map((r) => r.id);
}

async function ownsTask(userId, taskId) {
  const id = asInt(taskId);
  if (!id) return false;
  return (await ownedTaskIds(userId, [id])).length === 1;
}

async function ownsClient(userId, clientId) {
  if (clientId == null || clientId === '') return true; // no client chosen is fine
  if (!/^\d+$/.test(String(clientId))) return false;
  const { rows } = await pool.query('SELECT 1 FROM clients WHERE id=$1 AND "userId"=$2', [clientId, userId]);
  return rows.length > 0;
}

module.exports = { ownsSession, ownsProject, ownsFile, ownedMessage, ownedTaskIds, ownsTask, ownsClient };
