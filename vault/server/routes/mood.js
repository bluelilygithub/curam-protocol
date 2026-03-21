'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic();

const INQUIRY_SYSTEM_PROMPT = `You are a compassionate, skilled facilitator of emotional
self-inquiry. Your role is to help the user discover and
understand their own emotional experience more deeply.

You are NOT a therapist. You do NOT give advice. You do NOT
interpret what their feelings mean or suggest what they should
do or feel. You are a mirror — you reflect back what you hear
and ask questions that help the user go deeper into their own
experience.

Your approach:
- Ask ONE question at a time. Never more than one.
- Ask "what" questions, not "why" questions. "What do you
  notice?" not "Why do you think that is?" Why questions
  invite rationalisation. What questions invite observation.
- Before asking a new question, briefly reflect back what
  the user just said in your own words — 1-2 sentences
  maximum. This confirms you heard them and creates a sense
  of being witnessed.
- Keep your responses short. 3-5 sentences total.
  Reflection + one question. That is it.
- Be curious, warm, and unhurried. Never clinical.
- If the user describes a physical sensation, stay with it
  before moving to labels or meaning. "You mentioned
  tightness in your chest — what else do you notice
  about that?"
- Notice when the body description and the emotion label
  do not quite match, and gently name that. "You said you
  feel fine, but earlier you described a heaviness in your
  shoulders. What is that about?"
- If the user names a particular emotion, explore its
  texture rather than accepting the label at face value.
  Frustrated can mean many things. What kind of frustrated?
- After 3-4 exchanges, if it feels natural, ask: "Is this
  the feeling on the surface, or is there something
  underneath it?" This is one of the most revealing
  questions in emotional inquiry. Do not force it — only
  ask when there is a natural opening.
- Never summarise what the user should take away. Never
  conclude. The user will write their own summary at the
  end. Your job is to open, not to close.
- If the user seems to be avoiding or deflecting, stay
  gentle. Do not push. You can name what you notice:
  "I notice you moved away from that — do you want to
  stay with it a moment, or is it right to move on?"
- Never use therapeutic jargon. No "sit with", no
  "validate", no "process". Speak like a wise, warm,
  perceptive friend.
- The conversation will be 4-6 exchanges. Know when to
  bring it to a natural close by saying something like:
  "I think we have covered some real ground here. Before
  we finish — is there anything else that wants to
  be said?"

What you are NOT doing:
- Not diagnosing
- Not advising
- Not interpreting meaning
- Not telling the user what their emotion means about them
- Not suggesting actions
- Not reassuring ("I am sure it will be fine")
- Not minimising ("That sounds hard but...")
- Not cheerleading

Tone:
You are not a support system. You are not a companion.
You are not emotionally invested in how the user feels
or what they discover. You are a skilled, neutral
observer — present and curious, but detached.

Do not express care about the user's wellbeing.
Do not say things like "I'm here for you", "that sounds
really hard", "you're doing great", or anything that
positions you as emotionally supportive.
Do not affirm or validate the user's feelings.
Validation is not your role — observation is.

If the user shares something painful or difficult,
do not acknowledge the difficulty. Simply stay with
the inquiry. "What do you notice about that?" is
always more useful than "that sounds really hard."

You are a clean mirror. A clean mirror does not
comfort. It reflects accurately and without distortion.
The user is here to see themselves more clearly —
not to feel better, not to be understood, not to be
supported. Just to see.`;

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
       JOIN target t ON mc.entity_type = t.et AND mc.entity_id::text = t.eid
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

// ── Inquiry endpoints ─────────────────────────────────────────────────────────

// POST /api/mood/inquiry/start
router.post('/inquiry/start', async (req, res) => {
  try {
    const userId = getUserId(req);

    // Fetch last 7 days grouped by emotion + entity_type
    const patternsResult = await pool.query(
      `SELECT core_emotion, entity_type, COUNT(*) as count, MAX(created_at) as last_seen
       FROM mood_checkins
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY core_emotion, entity_type
       ORDER BY count DESC`,
      [userId]
    );

    // Aggregate into per-emotion pattern objects
    const emotionMap = {};
    for (const row of patternsResult.rows) {
      const em = row.core_emotion;
      if (!emotionMap[em]) {
        emotionMap[em] = {
          emotion: em,
          colour: EMOTION_COLOURS[em] || '#888',
          count: 0,
          entityBreakdown: [],
          lastSeen: null,
        };
      }
      const cnt = parseInt(row.count, 10);
      emotionMap[em].count += cnt;
      emotionMap[em].entityBreakdown.push({ entityType: row.entity_type, count: cnt });
      const rowDate = new Date(row.last_seen);
      if (!emotionMap[em].lastSeen || rowDate > new Date(emotionMap[em].lastSeen)) {
        emotionMap[em].lastSeen = row.last_seen;
      }
    }
    const recentPatterns = Object.values(emotionMap).sort((a, b) => b.count - a.count);

    // Create a new session row
    const sessionResult = await pool.query(
      `INSERT INTO mood_sessions (user_id, pattern_context) VALUES ($1, $2) RETURNING id`,
      [userId, JSON.stringify(recentPatterns)]
    );

    res.json({ sessionId: sessionResult.rows[0].id, recentPatterns });
  } catch (err) {
    console.error('[mood] inquiry/start error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mood/inquiry/message — SSE
router.post('/inquiry/message', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { sessionId, userMessage, conversation, bodyScan, stage, recentPatterns } = req.body;

    // Verify session belongs to this user
    const sessionCheck = await pool.query(
      'SELECT id FROM mood_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Build readable context block
    const patternLines = (recentPatterns || []).map(p => {
      const breakdown = (p.entityBreakdown || []).map(e => `${e.entityType} (${e.count})`).join(', ');
      return `- ${p.emotion} ×${p.count}${breakdown ? ': ' + breakdown : ''}`;
    }).join('\n');

    const locationText  = bodyScan?.locations?.length     ? bodyScan.locations.join(', ')  : 'none recorded';
    const qualitiesText = bodyScan?.qualities?.length     ? bodyScan.qualities.join(', ')  : 'none recorded';
    const descriptionText = bodyScan?.body_description || 'none recorded';

    const contextBlock = `Recent emotional check-ins (last 7 days):
${patternLines || 'No recent check-ins'}

Body scan from this session:
Locations: ${locationText}
Qualities: ${qualitiesText}
Description: ${descriptionText}

Current stage: ${stage || 'inquiry'}`;

    const systemWithContext = INQUIRY_SYSTEM_PROMPT + '\n\n---\n\n' + contextBlock;

    // Build messages array. If userMessage is empty this is the AI's opening turn —
    // inject a silent prompt so Claude opens the conversation naturally.
    const trimmedMsg = (userMessage || '').trim();
    const priorMessages = (conversation || []).filter(m => m.content && m.content.trim());
    const messages = priorMessages.length === 0 && !trimmedMsg
      ? [{ role: 'user', content: 'Please begin.' }]
      : [
          ...priorMessages,
          ...(trimmedMsg ? [{ role: 'user', content: trimmedMsg }] : []),
        ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: systemWithContext,
      messages,
    });

    stream.on('text', (text) => { res.write(`data: ${JSON.stringify(text)}\n\n`); });
    stream.on('finalMessage', () => { res.write('data: [DONE]\n\n'); res.end(); });
    stream.on('error', (err) => {
      console.error('[mood] inquiry/message stream error:', err);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  } catch (err) {
    console.error('[mood] inquiry/message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/mood/inquiry/:sessionId/complete
router.put('/inquiry/:sessionId/complete', async (req, res) => {
  try {
    const userId = getUserId(req);
    const sessionId = parseInt(req.params.sessionId, 10);
    const { userSummary, dominantEmotions, durationSeconds, conversation } = req.body;

    const result = await pool.query(
      `UPDATE mood_sessions
       SET completed_at = NOW(),
           user_summary = $1,
           dominant_emotions = $2,
           duration_seconds = $3,
           conversation = $4
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [
        userSummary || null,
        JSON.stringify(dominantEmotions || []),
        durationSeconds || null,
        JSON.stringify(conversation || []),
        sessionId,
        userId,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[mood] inquiry/complete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/mood/sessions
router.get('/sessions', async (req, res) => {
  try {
    const userId = getUserId(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;

    const result = await pool.query(
      `SELECT id, started_at, completed_at,
              LEFT(user_summary, 150) as user_summary,
              dominant_emotions, duration_seconds
       FROM mood_sessions
       WHERE user_id = $1 AND completed_at IS NOT NULL
       ORDER BY completed_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM mood_sessions WHERE user_id = $1 AND completed_at IS NOT NULL',
      [userId]
    );

    res.json({
      sessions: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
    });
  } catch (err) {
    console.error('[mood] sessions list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/mood/sessions/:id
router.get('/sessions/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const sessionId = parseInt(req.params.id, 10);

    const result = await pool.query(
      'SELECT * FROM mood_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[mood] session detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mood/insights — SSE
router.post('/insights', async (req, res) => {
  try {
    const userId = getUserId(req);
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 86400000).toISOString();
    const from = req.query.from || req.body.from || defaultFrom;
    const to = req.query.to || req.body.to || now.toISOString();

    // Fetch check-ins for the period
    const checkinsResult = await pool.query(
      `SELECT core_emotion, entity_type, COUNT(*) as count, AVG(intensity) as avg_intensity
       FROM mood_checkins
       WHERE user_id = $1 AND created_at >= $2 AND created_at <= $3
       GROUP BY core_emotion, entity_type
       ORDER BY count DESC`,
      [userId, from, to]
    );

    // Fetch completed inquiry sessions for the period
    const sessionsResult = await pool.query(
      `SELECT id, completed_at, user_summary, dominant_emotions, duration_seconds
       FROM mood_sessions
       WHERE user_id = $1 AND completed_at IS NOT NULL
         AND completed_at >= $2 AND completed_at <= $3
       ORDER BY completed_at DESC`,
      [userId, from, to]
    );

    // Build readable data for the AI
    const checkinLines = checkinsResult.rows.map(r =>
      `- ${r.core_emotion} (${r.entity_type}): ${r.count}× avg intensity ${parseFloat(r.avg_intensity).toFixed(1)}/10`
    ).join('\n');

    const sessionLines = sessionsResult.rows.map((s, i) => {
      const date = new Date(s.completed_at).toLocaleDateString();
      const emotions = Array.isArray(s.dominant_emotions) ? s.dominant_emotions.join(', ') : s.dominant_emotions;
      return `${i + 1}. [${date}] Emotions: ${emotions || 'none'}. Summary: "${(s.user_summary || '').substring(0, 200)}"`;
    }).join('\n');

    const userMessage = `Emotional check-in data (${from.substring(0, 10)} to ${to.substring(0, 10)}):

Check-ins by emotion and context:
${checkinLines || 'No check-ins in this period.'}

Inquiry sessions completed (${sessionsResult.rows.length}):
${sessionLines || 'No inquiry sessions in this period.'}`;

    const insightsSystemPrompt = `You are analysing someone's emotional check-in data to
help them understand their patterns. Your role is to
surface observations, not to advise or interpret.

Speak directly to the person in second person (you).
Be specific — reference actual emotions and actual
contexts (tasks, projects, sessions) where relevant.
Be curious and tentative, not declarative. Use language
like "it looks like", "you seem to", "there is a pattern
of" rather than "you are" or "this means".
Keep each insight to 2-3 sentences.
Generate exactly 5 insights and 1 closing question.
Do not give advice. Do not suggest what the person
should do. Only observe.
End with one open question — something the data raises
but does not answer.

Respond ONLY with a valid JSON array, no preamble,
no markdown fences:
[
  { "insight": "...", "type": "pattern" },
  { "insight": "...", "type": "pattern" },
  { "insight": "...", "type": "pattern" },
  { "insight": "...", "type": "pattern" },
  { "insight": "...", "type": "pattern" },
  { "question": "...", "type": "question" }
]`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let accumulated = '';

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: insightsSystemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    stream.on('text', (text) => {
      accumulated += text;
      res.write(`data: ${JSON.stringify(text)}\n\n`);
    });

    stream.on('finalMessage', async () => {
      res.write('data: [DONE]\n\n');
      res.end();
      // Cache result
      try {
        await pool.query(
          `INSERT INTO settings ("userId", key, value) VALUES ($1, 'mood_insights_cache', $2)
           ON CONFLICT ("userId", key) DO UPDATE SET value = $2`,
          [userId, accumulated]
        );
        await pool.query(
          `INSERT INTO settings ("userId", key, value) VALUES ($1, 'mood_insights_generated', $2)
           ON CONFLICT ("userId", key) DO UPDATE SET value = $2`,
          [userId, new Date().toISOString()]
        );
      } catch (cacheErr) {
        console.error('[mood] insights cache error:', cacheErr.message);
      }
    });

    stream.on('error', (err) => {
      console.error('[mood] insights stream error:', err);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  } catch (err) {
    console.error('[mood] insights error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
