'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

const EMOTION_COLOURS = {
  joy: '#C9A84C',
  trust: '#6B9E70',
  fear: '#507A60',
  surprise: '#6B97B5',
  sadness: '#5B6FAD',
  disgust: '#8A5C8A',
  anger: '#A85C5C',
  anticipation: '#C48B3C',
};

const PLUTCHIK_WHEEL = [
  {
    id: 'joy', label: 'Joy', color: '#FFD700', angle: 0,
    secondary: [
      { id: 'serenity', label: 'Serenity', tertiary: [{ id: 'optimism', label: 'Optimism' }] },
      { id: 'ecstasy', label: 'Ecstasy', tertiary: [{ id: 'love', label: 'Love' }] },
    ],
  },
  {
    id: 'trust', label: 'Trust', color: '#7CFC00', angle: 45,
    secondary: [
      { id: 'acceptance', label: 'Acceptance', tertiary: [{ id: 'love', label: 'Love' }] },
      { id: 'admiration', label: 'Admiration', tertiary: [{ id: 'submission', label: 'Submission' }] },
    ],
  },
  {
    id: 'fear', label: 'Fear', color: '#228B22', angle: 90,
    secondary: [
      { id: 'apprehension', label: 'Apprehension', tertiary: [{ id: 'awe', label: 'Awe' }] },
      { id: 'terror', label: 'Terror', tertiary: [{ id: 'submission', label: 'Submission' }] },
    ],
  },
  {
    id: 'surprise', label: 'Surprise', color: '#87CEEB', angle: 135,
    secondary: [
      { id: 'distraction', label: 'Distraction', tertiary: [{ id: 'awe', label: 'Awe' }] },
      { id: 'amazement', label: 'Amazement', tertiary: [{ id: 'disapproval', label: 'Disapproval' }] },
    ],
  },
  {
    id: 'sadness', label: 'Sadness', color: '#4169E1', angle: 180,
    secondary: [
      { id: 'pensiveness', label: 'Pensiveness', tertiary: [{ id: 'remorse', label: 'Remorse' }] },
      { id: 'grief', label: 'Grief', tertiary: [{ id: 'contempt', label: 'Contempt' }] },
    ],
  },
  {
    id: 'disgust', label: 'Disgust', color: '#800080', angle: 225,
    secondary: [
      { id: 'boredom', label: 'Boredom', tertiary: [{ id: 'contempt', label: 'Contempt' }] },
      { id: 'loathing', label: 'Loathing', tertiary: [{ id: 'remorse', label: 'Remorse' }] },
    ],
  },
  {
    id: 'anger', label: 'Anger', color: '#FF4500', angle: 270,
    secondary: [
      { id: 'annoyance', label: 'Annoyance', tertiary: [{ id: 'contempt', label: 'Contempt' }] },
      { id: 'rage', label: 'Rage', tertiary: [{ id: 'aggressiveness', label: 'Aggressiveness' }] },
    ],
  },
  {
    id: 'anticipation', label: 'Anticipation', color: '#FF8C00', angle: 315,
    secondary: [
      { id: 'interest', label: 'Interest', tertiary: [{ id: 'optimism', label: 'Optimism' }] },
      { id: 'vigilance', label: 'Vigilance', tertiary: [{ id: 'aggressiveness', label: 'Aggressiveness' }] },
    ],
  },
];

// ── Auth helper ───────────────────────────────────────────────────────────────
function getUserId(req) {
  return req.user.id;
}

// POST /api/mood/checkin
router.post('/checkin', async (req, res) => {
  try {
    const userId = getUserId(req);
    const {
      entityType, entityId, coreEmotion, secondaryEmotion, tertiaryEmotion,
      intensity, bodyLocations, note,
    } = req.body;

    if (!entityType || !coreEmotion) {
      return res.status(400).json({ error: 'entityType and coreEmotion are required' });
    }

    const result = await pool.query(
      `INSERT INTO mood_checkins
         (user_id, entity_type, entity_id, core_emotion, secondary_emotion, tertiary_emotion,
          intensity, body_locations, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId,
        entityType,
        entityId || null,
        coreEmotion,
        secondaryEmotion || null,
        tertiaryEmotion || null,
        intensity || 5,
        bodyLocations ? JSON.stringify(bodyLocations) : null,
        note || null,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[mood] checkin error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mood/dominant/batch
// Body: { entities: [{ entityType, entityId }] }
// Returns: { "entityType:entityId": { coreEmotion, color, count } }
router.post('/dominant/batch', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { entities } = req.body;
    if (!Array.isArray(entities) || entities.length === 0) return res.json({});

    const types = entities.map(e => e.entityType);
    const ids   = entities.map(e => String(e.entityId));

    // Parallel UNNEST pairs entity_type and entity_id by position
    const result = await pool.query(
      `WITH target AS (
         SELECT UNNEST($2::text[]) AS et, UNNEST($3::text[]) AS eid
       )
       SELECT mc.entity_type, mc.entity_id, mc.core_emotion, COUNT(*) AS cnt
       FROM mood_checkins mc
       JOIN target t ON mc.entity_type = t.et AND mc.entity_id = t.eid
       WHERE mc.user_id = $1
       GROUP BY mc.entity_type, mc.entity_id, mc.core_emotion`,
      [userId, types, ids]
    );

    // For each entity keep only the highest-count emotion
    const map = {};
    for (const row of result.rows) {
      const key = `${row.entity_type}:${row.entity_id}`;
      const cnt = parseInt(row.cnt, 10);
      if (!map[key] || cnt > map[key].count) {
        map[key] = { coreEmotion: row.core_emotion, color: EMOTION_COLOURS[row.core_emotion] || '#888', count: cnt };
      }
    }
    res.json(map);
  } catch (err) {
    console.error('[mood] dominant/batch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/mood/dominant/:entityType/:entityId
router.get('/dominant/:entityType/:entityId', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { entityType, entityId } = req.params;

    let query, params;
    if (entityType === 'general') {
      query = `SELECT core_emotion, COUNT(*) as count
               FROM mood_checkins
               WHERE user_id=$1 AND entity_type='general'
               GROUP BY core_emotion ORDER BY count DESC LIMIT 1`;
      params = [userId];
    } else {
      query = `SELECT core_emotion, COUNT(*) as count
               FROM mood_checkins
               WHERE user_id=$1 AND entity_type=$2 AND entity_id=$3
               GROUP BY core_emotion ORDER BY count DESC LIMIT 1`;
      params = [userId, entityType, String(entityId)];
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.json({ coreEmotion: null });
    }
    const row = result.rows[0];
    res.json({
      coreEmotion: row.core_emotion,
      color: EMOTION_COLOURS[row.core_emotion] || '#888',
      count: parseInt(row.count, 10),
    });
  } catch (err) {
    console.error('[mood] dominant error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/mood/summary/overall
router.get('/summary/overall', async (req, res) => {
  try {
    const userId = getUserId(req);

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 86400000).toISOString();
    const defaultTo = now.toISOString();
    const from = req.query.from || defaultFrom;
    const to = req.query.to || defaultTo;
    // Validate timezone — IANA names are alphanumeric plus _ / + -
    const rawTz = req.query.tz || '';
    const tz = /^[A-Za-z0-9_/+\-]+$/.test(rawTz) ? rawTz : 'UTC';

    // Optional filters — project and entity type
    const filterProjectId = req.query.projectId ? parseInt(req.query.projectId, 10) : null;
    const validEntityTypes = ['project', 'task', 'note', 'goal', 'key_result', 'session', 'general'];
    const filterEntityTypes = (req.query.entityTypes || '').split(',')
      .map(s => s.trim()).filter(s => validEntityTypes.includes(s));

    // Safe SQL fragments (filterProjectId is a validated integer; filterEntityTypes are whitelisted)
    const projectFilterSQL = Number.isFinite(filterProjectId) ? `AND (
      (entity_type = 'project' AND entity_id::text = '${filterProjectId}')
      OR (entity_type = 'task' AND entity_id::text IN (SELECT id::text FROM tasks WHERE "projectId" = ${filterProjectId}))
      OR (entity_type = 'note' AND entity_id::text IN (SELECT id::text FROM notes WHERE project_id = ${filterProjectId}))
    )` : '';
    const entityTypeFilterSQL = filterEntityTypes.length > 0
      ? `AND entity_type IN (${filterEntityTypes.map(t => `'${t}'`).join(', ')})`
      : '';

    // Diagnostic: show what entity_types/ids exist for this user in this period
    if (filterProjectId) {
      const diagResult = await pool.query(
        `SELECT entity_type, entity_id::text, COUNT(*) as cnt
         FROM mood_checkins
         WHERE user_id=$1 AND created_at >= $2 AND created_at <= $3
         GROUP BY entity_type, entity_id`,
        [userId, from, to]
      );
      console.log('[mood] all checkins in period:', JSON.stringify(diagResult.rows));
      console.log('[mood] project filter SQL:', projectFilterSQL);
    }

    // Emotion counts and avg intensity
    const emotionsResult = await pool.query(
      `SELECT core_emotion as emotion, COUNT(*) as count, AVG(intensity) as avg_intensity
       FROM mood_checkins
       WHERE user_id=$1 AND created_at >= $2 AND created_at <= $3
       ${projectFilterSQL} ${entityTypeFilterSQL}
       GROUP BY core_emotion ORDER BY count DESC`,
      [userId, from, to]
    );

    // Daily series — grouped by local day using the client's timezone
    const dailyResult = await pool.query(
      `SELECT TO_CHAR(DATE_TRUNC('day', created_at AT TIME ZONE $4), 'YYYY-MM-DD') as day,
              core_emotion, AVG(intensity) as avg_intensity
       FROM mood_checkins
       WHERE user_id=$1 AND created_at >= $2 AND created_at <= $3
       ${projectFilterSQL} ${entityTypeFilterSQL}
       GROUP BY TO_CHAR(DATE_TRUNC('day', created_at AT TIME ZONE $4), 'YYYY-MM-DD'), core_emotion
       ORDER BY 1`,
      [userId, from, to, tz]
    );

    // Project breakdown — skipped when a specific project is already selected
    let taskProjectRows = [];
    let noteProjectRows = [];
    let directProjectRows = [];

    if (!filterProjectId) {
      const mcEntityTypeFilterSQL = filterEntityTypes.length > 0
        ? `AND mc.entity_type IN (${filterEntityTypes.map(t => `'${t}'`).join(', ')})`
        : '';

      try {
        const taskProjectResult = await pool.query(
          `SELECT t."projectId" as project_id, p.name, COUNT(*) as count, mc.core_emotion
           FROM mood_checkins mc
           JOIN tasks t ON mc.entity_id = t.id::text AND mc.entity_type='task'
           JOIN projects p ON t."projectId"=p.id
           WHERE mc.user_id=$1 AND mc.created_at >= $2 AND mc.created_at <= $3
             AND t."projectId" IS NOT NULL ${mcEntityTypeFilterSQL}
           GROUP BY t."projectId", p.name, mc.core_emotion`,
          [userId, from, to]
        );
        taskProjectRows = taskProjectResult.rows;
      } catch (e) {
        console.error('[mood] task project breakdown error:', e.message);
      }

      try {
        const noteProjectResult = await pool.query(
          `SELECT n.project_id, p.name, COUNT(*) as count, mc.core_emotion
           FROM mood_checkins mc
           JOIN notes n ON mc.entity_id = n.id::text AND mc.entity_type='note'
           JOIN projects p ON n.project_id=p.id
           WHERE mc.user_id=$1 AND mc.created_at >= $2 AND mc.created_at <= $3
             AND n.project_id IS NOT NULL ${mcEntityTypeFilterSQL}
           GROUP BY n.project_id, p.name, mc.core_emotion`,
          [userId, from, to]
        );
        noteProjectRows = noteProjectResult.rows;
      } catch (e) {
        console.error('[mood] note project breakdown error:', e.message);
      }

      try {
        const directProjectResult = await pool.query(
          `SELECT mc.entity_id::integer as project_id, p.name, COUNT(*) as count, mc.core_emotion
           FROM mood_checkins mc
           JOIN projects p ON mc.entity_id = p.id::text AND mc.entity_type='project'
           WHERE mc.user_id=$1 AND mc.created_at >= $2 AND mc.created_at <= $3
           ${mcEntityTypeFilterSQL}
           GROUP BY mc.entity_id, p.name, mc.core_emotion`,
          [userId, from, to]
        );
        directProjectRows = directProjectResult.rows;
      } catch (e) {
        console.error('[mood] direct project breakdown error:', e.message);
      }
    }

    // Merge project breakdown
    const projectMap = {};
    for (const row of [...taskProjectRows, ...noteProjectRows, ...directProjectRows]) {
      const pid = row.project_id;
      if (!projectMap[pid]) {
        projectMap[pid] = { projectId: pid, projectName: row.name, count: 0, emotionCounts: {} };
      }
      const cnt = parseInt(row.count, 10);
      projectMap[pid].count += cnt;
      const em = row.core_emotion;
      projectMap[pid].emotionCounts[em] = (projectMap[pid].emotionCounts[em] || 0) + cnt;
    }

    const projectBreakdown = Object.values(projectMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(p => {
        const dominant = Object.entries(p.emotionCounts).sort((a, b) => b[1] - a[1])[0];
        return {
          projectId: p.projectId,
          projectName: p.projectName,
          count: p.count,
          dominantEmotion: dominant ? dominant[0] : null,
        };
      });

    res.json({
      emotions: emotionsResult.rows.map(r => ({
        emotion: r.emotion,
        count: parseInt(r.count, 10),
        avgIntensity: parseFloat(r.avg_intensity).toFixed(1),
      })),
      dailySeries: dailyResult.rows.map(r => ({
        date: r.day,
        coreEmotion: r.core_emotion,
        avgIntensity: parseFloat(r.avg_intensity).toFixed(1),
      })),
      projectBreakdown,
    });
  } catch (err) {
    console.error('[mood] summary/overall error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/mood/summary/project/:projectId
router.get('/summary/project/:projectId', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { projectId } = req.params;

    const taskResult = await pool.query(
      `SELECT mc.core_emotion, COUNT(*) as count
       FROM mood_checkins mc
       JOIN tasks t ON mc.entity_id = t.id::text AND mc.entity_type='task'
       WHERE mc.user_id=$1 AND t."projectId"=$2
       GROUP BY mc.core_emotion`,
      [userId, parseInt(projectId, 10)]
    );

    const noteResult = await pool.query(
      `SELECT mc.core_emotion, COUNT(*) as count
       FROM mood_checkins mc
       JOIN notes n ON mc.entity_id = n.id::text AND mc.entity_type='note'
       WHERE mc.user_id=$1 AND n.project_id=$2
       GROUP BY mc.core_emotion`,
      [userId, parseInt(projectId, 10)]
    );

    const directResult = await pool.query(
      `SELECT core_emotion, COUNT(*) as count
       FROM mood_checkins
       WHERE user_id=$1 AND entity_type='project' AND entity_id=$2
       GROUP BY core_emotion`,
      [userId, String(projectId)]
    );

    const emotionMap = {};
    for (const row of [...taskResult.rows, ...noteResult.rows, ...directResult.rows]) {
      const em = row.core_emotion;
      emotionMap[em] = (emotionMap[em] || 0) + parseInt(row.count, 10);
    }

    res.json({
      emotions: Object.entries(emotionMap).map(([emotion, count]) => ({ emotion, count })),
    });
  } catch (err) {
    console.error('[mood] summary/project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/mood/config
router.get('/config', async (req, res) => {
  try {
    const userId = getUserId(req);

    const result = await pool.query(
      'SELECT config FROM mood_wheel_config WHERE user_id=$1',
      [userId]
    );

    if (result.rows.length === 0) {
      // Return default Plutchik wheel
      return res.json({ config: PLUTCHIK_WHEEL });
    }

    let parsed;
    try {
      parsed = JSON.parse(result.rows[0].config);
    } catch {
      parsed = PLUTCHIK_WHEEL;
    }
    res.json({ config: parsed });
  } catch (err) {
    console.error('[mood] config GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/mood/config
router.put('/config', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config is required' });

    const configStr = JSON.stringify(config);
    await pool.query(
      `INSERT INTO mood_wheel_config (user_id, config, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET config=$2, updated_at=NOW()`,
      [userId, configStr]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[mood] config PUT error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
