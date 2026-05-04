'use strict';

const express   = require('express');
const router    = express.Router();
const { pool }  = require('../db');
const { embedText } = require('../services/embeddings');
const { callModel } = require('../services/callModel');
const { getModelsForUser } = require('../services/modelResolver');

const SIMILARITY_THRESHOLD = 0.82;
const MAX_NOTES    = 100;
const MAX_SESSIONS = 50;
const MAX_SEMANTIC_EDGES = 500; // per comparison type

// ── Helpers ───────────────────────────────────────────────────────────────────

function sse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Parse pgvector string "[0.1,0.2,...]" → number[]
function parseVector(str) {
  try {
    if (!str) return null;
    const s = str.trim();
    return JSON.parse(s.startsWith('[') ? s : `[${s}]`);
  } catch {
    return null;
  }
}

// ── GET /api/graph ─────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const [
      projects, files, notes, sessions, tasks,
      objectives, keyResults, pinnedUrls, taskDeps, semanticEdges,
    ] = await Promise.all([
      pool.query('SELECT id, name FROM projects WHERE archived_at IS NULL ORDER BY id'),
      pool.query('SELECT id, "projectId", name FROM files ORDER BY id'),
      pool.query('SELECT id, project_id, title FROM notes ORDER BY id'),
      pool.query(
        'SELECT "sessionId", "projectId", title, "branchedFrom" FROM sessions ORDER BY "createdAt" DESC LIMIT 200'
      ),
      pool.query(
        'SELECT id, title, "projectId", "parentTaskId", "sourceSessionId", "keyResultId" FROM tasks ORDER BY id'
      ),
      pool.query('SELECT id, title FROM objectives ORDER BY id'),
      pool.query('SELECT id, title, "objectiveId" FROM key_results ORDER BY id'),
      pool.query('SELECT id, "projectId", url, title FROM pinned_urls ORDER BY id'),
      pool.query('SELECT "taskId", "blockedByTaskId" FROM task_dependencies'),
      pool.query("SELECT source_id, target_id, similarity FROM graph_edges WHERE edge_type = 'semantic'"),
    ]);

    const nodes = [];
    const edges = [];

    // ── Nodes ──────────────────────────────────────────────────────────────

    for (const p of projects.rows) {
      nodes.push({ id: `project_${p.id}`, type: 'project', label: p.name || 'Untitled Project', url: `/projects/${p.id}` });
    }
    for (const f of files.rows) {
      nodes.push({ id: `file_${f.id}`, type: 'file', label: f.name || 'Unnamed File', url: `/projects/${f.projectId}`, meta: { projectId: f.projectId } });
    }
    for (const n of notes.rows) {
      nodes.push({ id: `note_${n.id}`, type: 'note', label: n.title || 'Untitled Note', url: '/notes' });
    }
    for (const s of sessions.rows) {
      nodes.push({ id: `session_${s.sessionId}`, type: 'session', label: s.title || 'Untitled Chat', url: s.projectId ? `/projects/${s.projectId}/chat` : '/chat', meta: { projectId: s.projectId } });
    }
    for (const t of tasks.rows) {
      nodes.push({ id: `task_${t.id}`, type: 'task', label: t.title || 'Untitled Task', url: '/tasks', meta: { projectId: t.projectId } });
    }
    for (const o of objectives.rows) {
      nodes.push({ id: `goal_${o.id}`, type: 'goal', label: o.title || 'Untitled Goal', url: '/goals' });
    }
    for (const kr of keyResults.rows) {
      nodes.push({ id: `kr_${kr.id}`, type: 'goal', label: kr.title || 'Key Result', url: '/goals', meta: { isKeyResult: true } });
    }
    for (const u of pinnedUrls.rows) {
      nodes.push({ id: `url_${u.id}`, type: 'url', label: u.title || u.url || 'Pinned URL', url: u.url, external: true, meta: { projectId: u.projectId } });
    }

    // ── Explicit edges ─────────────────────────────────────────────────────

    const projectIdSet = new Set(projects.rows.map(p => `project_${p.id}`));
    const sessionIdSet = new Set(sessions.rows.map(s => `session_${s.sessionId}`));
    const taskIdSet    = new Set(tasks.rows.map(t => `task_${t.id}`));
    const krIdSet      = new Set(keyResults.rows.map(kr => `kr_${kr.id}`));
    const goalIdSet    = new Set(objectives.rows.map(o => `goal_${o.id}`));

    for (const f of files.rows) {
      if (f.projectId && projectIdSet.has(`project_${f.projectId}`))
        edges.push({ source: `project_${f.projectId}`, target: `file_${f.id}`, type: 'contains' });
    }
    for (const n of notes.rows) {
      if (n.project_id && projectIdSet.has(`project_${n.project_id}`))
        edges.push({ source: `project_${n.project_id}`, target: `note_${n.id}`, type: 'contains' });
    }
    for (const s of sessions.rows) {
      if (s.projectId && projectIdSet.has(`project_${s.projectId}`))
        edges.push({ source: `project_${s.projectId}`, target: `session_${s.sessionId}`, type: 'contains' });
      if (s.branchedFrom && sessionIdSet.has(`session_${s.branchedFrom}`))
        edges.push({ source: `session_${s.branchedFrom}`, target: `session_${s.sessionId}`, type: 'branch' });
    }
    for (const t of tasks.rows) {
      if (t.projectId && projectIdSet.has(`project_${t.projectId}`))
        edges.push({ source: `project_${t.projectId}`, target: `task_${t.id}`, type: 'contains' });
      if (t.parentTaskId && taskIdSet.has(`task_${t.parentTaskId}`))
        edges.push({ source: `task_${t.parentTaskId}`, target: `task_${t.id}`, type: 'subtask' });
      if (t.sourceSessionId && sessionIdSet.has(`session_${t.sourceSessionId}`))
        edges.push({ source: `session_${t.sourceSessionId}`, target: `task_${t.id}`, type: 'created' });
      if (t.keyResultId && krIdSet.has(`kr_${t.keyResultId}`))
        edges.push({ source: `task_${t.id}`, target: `kr_${t.keyResultId}`, type: 'tracks' });
    }
    for (const kr of keyResults.rows) {
      if (kr.objectiveId && goalIdSet.has(`goal_${kr.objectiveId}`))
        edges.push({ source: `kr_${kr.id}`, target: `goal_${kr.objectiveId}`, type: 'key_result' });
    }
    for (const u of pinnedUrls.rows) {
      if (u.projectId && projectIdSet.has(`project_${u.projectId}`))
        edges.push({ source: `project_${u.projectId}`, target: `url_${u.id}`, type: 'contains' });
    }
    for (const dep of taskDeps.rows) {
      if (taskIdSet.has(`task_${dep.blockedByTaskId}`) && taskIdSet.has(`task_${dep.taskId}`))
        edges.push({ source: `task_${dep.blockedByTaskId}`, target: `task_${dep.taskId}`, type: 'blocks' });
    }

    // ── Semantic edges (cached) ────────────────────────────────────────────

    const nodeIdSet = new Set(nodes.map(n => n.id));
    for (const se of semanticEdges.rows) {
      if (nodeIdSet.has(se.source_id) && nodeIdSet.has(se.target_id)) {
        edges.push({ source: se.source_id, target: se.target_id, type: 'semantic', similarity: se.similarity });
      }
    }

    res.json({ nodes, edges, semanticCount: semanticEdges.rows.length });
  } catch (err) {
    console.error('[graph] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/graph/compute-semantic — SSE ────────────────────────────────────

router.post('/compute-semantic', async (req, res) => {
  sseHeaders(res);

  try {
    sse(res, { stage: 'init', message: 'Clearing previous semantic connections…', percent: 2 });
    await pool.query("DELETE FROM graph_edges WHERE edge_type = 'semantic'");

    const foundEdges = [];

    // ── Stage 1: File ↔ File via pgvector SQL ─────────────────────────────
    sse(res, { stage: 'files', message: 'Comparing file embeddings…', percent: 5 });

    let fileEmbeddings = []; // [{id, embedding: number[]}] — reused for cross-type comparisons

    try {
      // Average embeddings per file in SQL, then pairwise cosine comparison
      const { rows: fileFilePairs } = await pool.query(`
        WITH avg_embs AS (
          SELECT file_id, avg(embedding) AS avg_emb
          FROM file_chunks
          WHERE embedding IS NOT NULL
          GROUP BY file_id
        )
        SELECT
          a.file_id  AS file_a,
          b.file_id  AS file_b,
          1 - (a.avg_emb <=> b.avg_emb) AS similarity
        FROM avg_embs a
        JOIN avg_embs b ON b.file_id > a.file_id
        WHERE 1 - (a.avg_emb <=> b.avg_emb) > $1
        ORDER BY similarity DESC
        LIMIT $2
      `, [SIMILARITY_THRESHOLD, MAX_SEMANTIC_EDGES]);

      for (const pair of fileFilePairs) {
        foundEdges.push({ source_id: `file_${pair.file_a}`, target_id: `file_${pair.file_b}`, similarity: parseFloat(pair.similarity) });
      }

      sse(res, { stage: 'files', message: `File-file: ${fileFilePairs.length} connections`, percent: 18 });

      // Fetch avg embeddings for cross-type comparisons (file ↔ note)
      const { rows: fileEmbs } = await pool.query(`
        SELECT file_id, avg(embedding) AS avg_emb
        FROM file_chunks WHERE embedding IS NOT NULL
        GROUP BY file_id
      `);
      fileEmbeddings = fileEmbs
        .map(r => ({ id: r.file_id, embedding: parseVector(r.avg_emb) }))
        .filter(r => r.embedding !== null);
    } catch (err) {
      console.warn('[graph] File comparison skipped (pgvector unavailable):', err.message);
      sse(res, { stage: 'files', message: 'File comparison skipped (embeddings unavailable)', percent: 18 });
    }

    // ── Stages 2–6 require GEMINI_API_KEY ─────────────────────────────────
    if (!process.env.GEMINI_API_KEY) {
      sse(res, { stage: 'skipped', message: 'Note/session comparisons skipped — GEMINI_API_KEY not set', percent: 88 });
    } else {
      // ── Stage 2: Embed notes ─────────────────────────────────────────────
      const { rows: noteRows } = await pool.query(
        'SELECT id, title, body FROM notes ORDER BY created_at DESC LIMIT $1', [MAX_NOTES]
      );
      sse(res, { stage: 'notes', message: `Embedding ${noteRows.length} notes…`, percent: 20 });

      const noteEmbeddings = [];
      for (let i = 0; i < noteRows.length; i++) {
        const n = noteRows[i];
        const text = [n.title, n.body].filter(Boolean).join('\n').slice(0, 3000);
        const emb = await embedText(text);
        if (emb) noteEmbeddings.push({ id: n.id, embedding: emb });
        const pct = 20 + Math.round(((i + 1) / Math.max(noteRows.length, 1)) * 22);
        sse(res, { stage: 'notes', message: `Embedding notes… ${i + 1}/${noteRows.length}`, percent: pct });
      }

      // ── Stage 3: Embed sessions (first user message + last assistant message) ──
      const { rows: sessionRows } = await pool.query(`
        SELECT
          s."sessionId",
          s.title,
          fm.content AS first_content,
          lm.content AS last_content
        FROM sessions s
        LEFT JOIN LATERAL (
          SELECT content FROM messages
          WHERE "sessionId" = s."sessionId" AND role = 'user'
          ORDER BY "createdAt" ASC LIMIT 1
        ) fm ON true
        LEFT JOIN LATERAL (
          SELECT content FROM messages
          WHERE "sessionId" = s."sessionId" AND role = 'assistant'
          ORDER BY "createdAt" DESC LIMIT 1
        ) lm ON true
        ORDER BY s."createdAt" DESC
        LIMIT $1
      `, [MAX_SESSIONS]);

      sse(res, { stage: 'sessions', message: `Embedding ${sessionRows.length} sessions…`, percent: 44 });

      const sessionEmbeddings = [];
      for (let i = 0; i < sessionRows.length; i++) {
        const s = sessionRows[i];
        const text = [s.title, s.first_content, s.last_content].filter(Boolean).join('\n').slice(0, 3000);
        if (!text.trim()) continue;
        const emb = await embedText(text);
        if (emb) sessionEmbeddings.push({ id: s.sessionId, embedding: emb });
        const pct = 44 + Math.round(((i + 1) / Math.max(sessionRows.length, 1)) * 16);
        sse(res, { stage: 'sessions', message: `Embedding sessions… ${i + 1}/${sessionRows.length}`, percent: pct });
      }

      // ── Stage 4: Note ↔ Note ──────────────────────────────────────────────
      sse(res, { stage: 'comparing', message: 'Comparing notes…', percent: 62 });
      for (let i = 0; i < noteEmbeddings.length; i++) {
        for (let j = i + 1; j < noteEmbeddings.length; j++) {
          const sim = cosineSimilarity(noteEmbeddings[i].embedding, noteEmbeddings[j].embedding);
          if (sim > SIMILARITY_THRESHOLD) {
            foundEdges.push({ source_id: `note_${noteEmbeddings[i].id}`, target_id: `note_${noteEmbeddings[j].id}`, similarity: sim });
          }
        }
      }

      // ── Stage 5: File ↔ Note ──────────────────────────────────────────────
      sse(res, { stage: 'comparing', message: 'Comparing files and notes…', percent: 70 });
      for (const file of fileEmbeddings) {
        for (const note of noteEmbeddings) {
          const sim = cosineSimilarity(file.embedding, note.embedding);
          if (sim > SIMILARITY_THRESHOLD) {
            foundEdges.push({ source_id: `file_${file.id}`, target_id: `note_${note.id}`, similarity: sim });
          }
        }
      }

      // ── Stage 6: Session ↔ Note ───────────────────────────────────────────
      sse(res, { stage: 'comparing', message: 'Comparing sessions and notes…', percent: 78 });
      for (const session of sessionEmbeddings) {
        for (const note of noteEmbeddings) {
          const sim = cosineSimilarity(session.embedding, note.embedding);
          if (sim > SIMILARITY_THRESHOLD) {
            foundEdges.push({ source_id: `session_${session.id}`, target_id: `note_${note.id}`, similarity: sim });
          }
        }
      }
    }

    // ── Save to graph_edges ───────────────────────────────────────────────
    sse(res, { stage: 'saving', message: `Saving ${foundEdges.length} connections…`, percent: 88 });

    for (const edge of foundEdges) {
      await pool.query(
        `INSERT INTO graph_edges (source_id, target_id, edge_type, similarity)
         VALUES ($1, $2, 'semantic', $3)
         ON CONFLICT (source_id, target_id) DO UPDATE
           SET similarity = EXCLUDED.similarity, computed_at = NOW()`,
        [edge.source_id, edge.target_id, edge.similarity]
      );
    }

    sse(res, {
      stage: 'complete',
      message: `Done — ${foundEdges.length} semantic connection${foundEdges.length !== 1 ? 's' : ''} found`,
      percent: 100,
      count: foundEdges.length,
    });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[graph] Semantic compute error:', err);
    sse(res, { stage: 'error', message: err.message });
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ── Graph data helper (shared between GET / and insights) ─────────────────────

async function fetchGraphData() {
  const [
    projects, files, notes, sessions, tasks,
    objectives, keyResults, pinnedUrls, taskDeps, semanticEdges,
  ] = await Promise.all([
    pool.query('SELECT id, name FROM projects WHERE archived_at IS NULL ORDER BY id'),
    pool.query('SELECT id, "projectId", name FROM files ORDER BY id'),
    pool.query('SELECT id, project_id, title FROM notes ORDER BY id'),
    pool.query('SELECT "sessionId", "projectId", title, "branchedFrom" FROM sessions ORDER BY "createdAt" DESC LIMIT 200'),
    pool.query('SELECT id, title, "projectId", "parentTaskId", "sourceSessionId", "keyResultId" FROM tasks ORDER BY id'),
    pool.query('SELECT id, title FROM objectives ORDER BY id'),
    pool.query('SELECT id, title, "objectiveId" FROM key_results ORDER BY id'),
    pool.query('SELECT id, "projectId", url, title FROM pinned_urls ORDER BY id'),
    pool.query('SELECT "taskId", "blockedByTaskId" FROM task_dependencies'),
    pool.query("SELECT source_id, target_id, similarity FROM graph_edges WHERE edge_type = 'semantic'"),
  ]);

  const nodes = [];
  const edges = [];

  for (const p of projects.rows)
    nodes.push({ id: `project_${p.id}`, type: 'project', label: p.name || 'Untitled Project', meta: {} });
  for (const f of files.rows)
    nodes.push({ id: `file_${f.id}`, type: 'file', label: f.name || 'Unnamed File', meta: { projectId: f.projectId } });
  for (const n of notes.rows)
    nodes.push({ id: `note_${n.id}`, type: 'note', label: n.title || 'Untitled Note', meta: { projectId: n.project_id } });
  for (const s of sessions.rows)
    nodes.push({ id: `session_${s.sessionId}`, type: 'session', label: s.title || 'Untitled Chat', meta: { projectId: s.projectId } });
  for (const t of tasks.rows)
    nodes.push({ id: `task_${t.id}`, type: 'task', label: t.title || 'Untitled Task', meta: { projectId: t.projectId } });
  for (const o of objectives.rows)
    nodes.push({ id: `goal_${o.id}`, type: 'goal', label: o.title || 'Untitled Goal', meta: {} });
  for (const kr of keyResults.rows)
    nodes.push({ id: `kr_${kr.id}`, type: 'goal', label: kr.title || 'Key Result', meta: {} });
  for (const u of pinnedUrls.rows)
    nodes.push({ id: `url_${u.id}`, type: 'url', label: u.title || u.url || 'Pinned URL', meta: { projectId: u.projectId } });

  const projectIdSet = new Set(projects.rows.map(p => `project_${p.id}`));
  const sessionIdSet = new Set(sessions.rows.map(s => `session_${s.sessionId}`));
  const taskIdSet    = new Set(tasks.rows.map(t => `task_${t.id}`));
  const krIdSet      = new Set(keyResults.rows.map(kr => `kr_${kr.id}`));
  const goalIdSet    = new Set(objectives.rows.map(o => `goal_${o.id}`));

  for (const f of files.rows)
    if (f.projectId && projectIdSet.has(`project_${f.projectId}`))
      edges.push({ source: `project_${f.projectId}`, target: `file_${f.id}`, type: 'contains' });
  for (const n of notes.rows)
    if (n.project_id && projectIdSet.has(`project_${n.project_id}`))
      edges.push({ source: `project_${n.project_id}`, target: `note_${n.id}`, type: 'contains' });
  for (const s of sessions.rows) {
    if (s.projectId && projectIdSet.has(`project_${s.projectId}`))
      edges.push({ source: `project_${s.projectId}`, target: `session_${s.sessionId}`, type: 'contains' });
    if (s.branchedFrom && sessionIdSet.has(`session_${s.branchedFrom}`))
      edges.push({ source: `session_${s.branchedFrom}`, target: `session_${s.sessionId}`, type: 'branch' });
  }
  for (const t of tasks.rows) {
    if (t.projectId && projectIdSet.has(`project_${t.projectId}`))
      edges.push({ source: `project_${t.projectId}`, target: `task_${t.id}`, type: 'contains' });
    if (t.parentTaskId && taskIdSet.has(`task_${t.parentTaskId}`))
      edges.push({ source: `task_${t.parentTaskId}`, target: `task_${t.id}`, type: 'subtask' });
    if (t.sourceSessionId && sessionIdSet.has(`session_${t.sourceSessionId}`))
      edges.push({ source: `session_${t.sourceSessionId}`, target: `task_${t.id}`, type: 'created' });
    if (t.keyResultId && krIdSet.has(`kr_${t.keyResultId}`))
      edges.push({ source: `task_${t.id}`, target: `kr_${t.keyResultId}`, type: 'tracks' });
  }
  for (const kr of keyResults.rows)
    if (kr.objectiveId && goalIdSet.has(`goal_${kr.objectiveId}`))
      edges.push({ source: `kr_${kr.id}`, target: `goal_${kr.objectiveId}`, type: 'key_result' });
  for (const u of pinnedUrls.rows)
    if (u.projectId && projectIdSet.has(`project_${u.projectId}`))
      edges.push({ source: `project_${u.projectId}`, target: `url_${u.id}`, type: 'contains' });
  for (const dep of taskDeps.rows)
    if (taskIdSet.has(`task_${dep.blockedByTaskId}`) && taskIdSet.has(`task_${dep.taskId}`))
      edges.push({ source: `task_${dep.blockedByTaskId}`, target: `task_${dep.taskId}`, type: 'blocks' });

  const nodeIdSet = new Set(nodes.map(n => n.id));
  for (const se of semanticEdges.rows)
    if (nodeIdSet.has(se.source_id) && nodeIdSet.has(se.target_id))
      edges.push({ source: se.source_id, target: se.target_id, type: 'semantic', similarity: se.similarity });

  return { nodes, edges, semanticCount: semanticEdges.rows.length };
}

// ── Build a text summary for Claude ──────────────────────────────────────────

function buildGraphSummary(nodes, edges) {
  const byType = {};
  for (const n of nodes) byType[n.type] = (byType[n.type] || 0) + 1;

  const degree = {};
  for (const n of nodes) degree[n.id] = 0;
  for (const e of edges) {
    if (degree[e.source] !== undefined) degree[e.source]++;
    if (degree[e.target] !== undefined) degree[e.target]++;
  }

  const nodeMap      = Object.fromEntries(nodes.map(n => [n.id, n]));
  const semanticEdges = edges.filter(e => e.type === 'semantic');
  const orphaned     = nodes.filter(n => degree[n.id] === 0);
  const orphanTasks  = nodes.filter(n => n.type === 'task' && !n.meta?.projectId);
  const orphanNotes  = nodes.filter(n => n.type === 'note' && !n.meta?.projectId && degree[n.id] === 0);

  const crossProject = semanticEdges.filter(e => {
    const src = nodeMap[e.source], tgt = nodeMap[e.target];
    return src && tgt && src.meta?.projectId && tgt.meta?.projectId &&
           src.meta.projectId !== tgt.meta.projectId;
  });

  const topNodes = [...nodes]
    .sort((a, b) => degree[b.id] - degree[a.id])
    .slice(0, 10)
    .map(n => ({ id: n.id, type: n.type, label: n.label, connections: degree[n.id] }));

  let s = `## Knowledge Graph Summary\n\n`;
  s += `**Counts:** ${Object.entries(byType).map(([k, v]) => `${v} ${k}s`).join(', ')}\n`;
  s += `**Edges:** ${edges.length} total (${semanticEdges.length} semantic)\n\n`;

  s += `**Most connected nodes:**\n`;
  for (const n of topNodes)
    s += `- [${n.id}] "${n.label}" (${n.type}): ${n.connections} connections\n`;
  s += '\n';

  if (orphaned.length > 0) {
    s += `**Orphaned nodes — no connections (${orphaned.length} total, showing up to 20):**\n`;
    for (const n of orphaned.slice(0, 20))
      s += `- [${n.id}] "${n.label}" (${n.type})\n`;
    s += '\n';
  }

  if (crossProject.length > 0) {
    s += `**Cross-project semantic connections (${crossProject.length}):**\n`;
    for (const e of crossProject.slice(0, 15)) {
      const src = nodeMap[e.source], tgt = nodeMap[e.target];
      s += `- [${e.source}] "${src?.label}" ↔ [${e.target}] "${tgt?.label}" (${(e.similarity ?? 0).toFixed(2)})\n`;
    }
    s += '\n';
  }

  if (orphanTasks.length > 0) {
    s += `**Tasks not linked to any project (${orphanTasks.length}):**\n`;
    for (const t of orphanTasks.slice(0, 10))
      s += `- [${t.id}] "${t.label}"\n`;
    s += '\n';
  }

  if (orphanNotes.length > 0) {
    s += `**Standalone notes with no connections (${orphanNotes.length}):**\n`;
    for (const n of orphanNotes.slice(0, 10))
      s += `- [${n.id}] "${n.label}"\n`;
    s += '\n';
  }

  if (semanticEdges.length > 0) {
    s += `**Strongest semantic connections (top 10):**\n`;
    const top = [...semanticEdges].sort((a, b) => (b.similarity || 0) - (a.similarity || 0)).slice(0, 10);
    for (const e of top) {
      const src = nodeMap[e.source], tgt = nodeMap[e.target];
      s += `- [${e.source}] "${src?.label}" ↔ [${e.target}] "${tgt?.label}" (${(e.similarity ?? 0).toFixed(3)})\n`;
    }
  }

  return s;
}

// ── GET /api/graph/insights ───────────────────────────────────────────────────

router.get('/insights', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'graph_insights'");
    if (rows.length > 0) {
      res.json(JSON.parse(rows[0].value));
    } else {
      res.json({ insights: [], generatedAt: null });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/graph/insights/refresh ─────────────────────────────────────────

router.post('/insights/refresh', async (req, res) => {
  try {
    const graphData = await fetchGraphData();
    const summary   = buildGraphSummary(graphData.nodes, graphData.edges);

    const { light: lightModel } = await getModelsForUser(req.user?.id);
    const raw = await callModel(
      lightModel,
      `You are analyzing someone's personal knowledge management vault. Based on the graph structure below, generate 4–6 short, specific, actionable insights about connections the user might not have noticed.\n\nRules:\n- Be specific — reference actual names from the data\n- Each insight must reference the relevant node IDs from the data\n- Focus on: cross-project themes, orphaned content that could be linked, clusters of related items, tasks disconnected from goals, recurring topics across sessions\n- Keep each insight under 25 words\n\n${summary}\n\nRespond with JSON only (no markdown):\n{"insights": [{"text": "...", "nodeIds": ["id1", "id2", ...]}]}`,
      { maxTokens: 1024 }
    ) ?? '{}';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let parsed;
    try {
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { insights: [] };
    } catch {
      parsed = { insights: [] };
    }

    const result = { insights: parsed.insights || [], generatedAt: new Date().toISOString() };

    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('graph_insights', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [JSON.stringify(result)]
    );

    res.json(result);
  } catch (err) {
    console.error('[graph] Insights error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
