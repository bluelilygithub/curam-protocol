'use strict';

const { Pool } = require('pg');

// Enable SSL for any non-localhost host (Railway, Render, Supabase, etc.)
function sslConfig() {
  try {
    const u = new URL(process.env.DATABASE_URL || '');
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return local ? false : { rejectUnauthorized: false };
  } catch (_) {
    return false;
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ── Schema initialisation ──────────────────────────────────────────────────────

async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Users & auth ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        "passwordHash" TEXT NOT NULL,
        "createdAt"   TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token       TEXT PRIMARY KEY,
        "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id          SERIAL PRIMARY KEY,
        token       TEXT NOT NULL UNIQUE,
        email       TEXT NOT NULL,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Organisation ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS folders (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS personas (
        id             SERIAL PRIMARY KEY,
        name           TEXT NOT NULL,
        description    TEXT,
        "systemPrompt" TEXT NOT NULL,
        "createdAt"    TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // folderId / personaId kept as plain integers (no FK) — same as SQLite
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id                 SERIAL PRIMARY KEY,
        name               TEXT NOT NULL,
        goal               TEXT,
        problem            TEXT,
        audience           TEXT,
        "techStack"        TEXT,
        constraints        TEXT,
        "successCriteria"  TEXT,
        tone               TEXT,
        notes              TEXT,
        "createdAt"        TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"        TIMESTAMPTZ DEFAULT NOW(),
        "sortOrder"        INTEGER DEFAULT 0,
        model              TEXT DEFAULT 'claude-sonnet-4-6',
        "projectType"      TEXT,
        "typeConfig"       TEXT,
        "folderId"         INTEGER,
        "personaId"        INTEGER
      )
    `);

    // ── Content stores ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS memory (
        id          SERIAL PRIMARY KEY,
        content     TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS prompts (
        id          SERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        content     TEXT NOT NULL,
        tags        TEXT DEFAULT '',
        "projectId" INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pinned_urls (
        id          SERIAL PRIMARY KEY,
        "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        url         TEXT NOT NULL,
        title       TEXT,
        content     TEXT,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS files (
        id              SERIAL PRIMARY KEY,
        "projectId"     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        size            INTEGER,
        mimetype        TEXT,
        path            TEXT NOT NULL,
        "extractedText" TEXT,
        "aiDescription" TEXT,
        "aiSummary"     TEXT,
        "uploadedAt"    TIMESTAMPTZ DEFAULT NOW(),
        pinned          INTEGER DEFAULT 0
      )
    `);

    // ── Chat ──────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        "sessionId"      TEXT PRIMARY KEY,
        "projectId"      INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        title            TEXT,
        "isSummarized"   INTEGER DEFAULT 0,
        "summaryContent" TEXT,
        "summarizedAt"   TIMESTAMPTZ,
        "createdAt"      TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"      TIMESTAMPTZ DEFAULT NOW(),
        starred          INTEGER DEFAULT 0,
        "inputTokens"    INTEGER DEFAULT 0,
        "outputTokens"   INTEGER DEFAULT 0,
        "personaId"      INTEGER,
        "branchedFrom"   TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id          SERIAL PRIMARY KEY,
        "sessionId" TEXT NOT NULL,
        "projectId" INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        role        TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content     TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── AI features ───────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS debates (
        id          SERIAL PRIMARY KEY,
        "debateId"  TEXT NOT NULL UNIQUE,
        topic       TEXT NOT NULL,
        "modelA"    TEXT NOT NULL,
        "modelB"    TEXT NOT NULL,
        rounds      TEXT DEFAULT '[]',
        "projectId" INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS comparisons (
        id          SERIAL PRIMARY KEY,
        "projectId" INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        "docAName"  TEXT,
        "docBName"  TEXT,
        mode        TEXT,
        model       TEXT,
        result      TEXT,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Config & logs ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS search_logs (
        id          SERIAL PRIMARY KEY,
        query       TEXT,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Goals (created before tasks so keyResultId FK can be added after) ─────
    await client.query(`
      CREATE TABLE IF NOT EXISTS objectives (
        id                  SERIAL PRIMARY KEY,
        title               TEXT NOT NULL,
        description         TEXT,
        timeframe           TEXT,
        status              TEXT DEFAULT 'active',
        color               TEXT DEFAULT '#6366f1',
        "createdAt"         TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"         TIMESTAMPTZ DEFAULT NOW(),
        "renewalDimension"  TEXT DEFAULT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS key_results (
        id             SERIAL PRIMARY KEY,
        "objectiveId"  INTEGER NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
        title          TEXT NOT NULL,
        "targetValue"  REAL NOT NULL DEFAULT 100,
        "currentValue" REAL NOT NULL DEFAULT 0,
        unit           TEXT DEFAULT '%',
        status         TEXT DEFAULT 'active',
        "dueDate"      TEXT,
        "createdAt"    TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Tasks ─────────────────────────────────────────────────────────────────
    // "order" is a reserved word — kept quoted throughout.
    // keyResultId defined without FK here; constraint added below after key_results exists.
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id                  SERIAL PRIMARY KEY,
        title               TEXT NOT NULL,
        notes               TEXT,
        status              TEXT NOT NULL DEFAULT 'todo'   CHECK(status   IN ('todo','in-progress','done')),
        priority            TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
        category            TEXT,
        "projectId"         INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        "parentTaskId"      INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
        "dueDate"           TEXT,
        "createdAt"         TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"         TIMESTAMPTZ DEFAULT NOW(),
        "order"             INTEGER DEFAULT 0,
        recurrence          TEXT DEFAULT 'none',
        "sourceSessionId"   TEXT DEFAULT NULL,
        "recurrenceConfig"  TEXT DEFAULT NULL,
        "recurrenceCount"   INTEGER DEFAULT 0,
        "shareToken"        TEXT DEFAULT NULL,
        "estimatedMinutes"  INTEGER DEFAULT NULL,
        "keyResultId"       INTEGER,
        "timeSpentMinutes"  INTEGER DEFAULT 0,
        "isUrgent"          INTEGER DEFAULT 0,
        "renewalDimension"  TEXT DEFAULT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_tags (
        id       SERIAL PRIMARY KEY,
        "taskId" INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tag      TEXT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id          SERIAL PRIMARY KEY,
        "taskId"    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        type        TEXT NOT NULL DEFAULT 'user' CHECK(type IN ('user', 'system')),
        content     TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_templates (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        category    TEXT,
        priority    TEXT DEFAULT 'medium',
        recurrence  TEXT DEFAULT 'none',
        tags        TEXT DEFAULT '',
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS template_subtasks (
        id           SERIAL PRIMARY KEY,
        "templateId" INTEGER NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
        title        TEXT NOT NULL,
        "order"      INTEGER DEFAULT 0
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        id                SERIAL PRIMARY KEY,
        "taskId"          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        "blockedByTaskId" INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        "createdAt"       TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE("taskId", "blockedByTaskId")
      )
    `);

    // ── Gmail ─────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS gmail_tokens (
        id             SERIAL PRIMARY KEY,
        "userId"       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        "accessToken"  TEXT NOT NULL,
        "refreshToken" TEXT,
        "tokenType"    TEXT DEFAULT 'Bearer',
        "expiryDate"   BIGINT,
        scope          TEXT,
        email          TEXT,
        "createdAt"    TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Notes ─────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        title      TEXT NOT NULL DEFAULT 'Untitled',
        body       TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Full-text search placeholder ──────────────────────────────────────────
    // The SQLite FTS5 virtual table is replaced with a plain table for now.
    // Phase 5 adds GIN indexes and converts queries to tsvector / plainto_tsquery.
    // projectId stored as TEXT to match existing write patterns (String(projectId)).
    await client.query(`
      CREATE TABLE IF NOT EXISTS search_index (
        id          SERIAL PRIMARY KEY,
        type        TEXT,
        "projectId" TEXT,
        title       TEXT,
        body        TEXT
      )
    `);

    await client.query('COMMIT');

    // ── Post-commit: FK and indexes (idempotent) ──────────────────────────────

    // tasks.keyResultId → key_results (forward reference, added after both tables exist)
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE tasks
          ADD CONSTRAINT fk_tasks_keyresultid
          FOREIGN KEY ("keyResultId") REFERENCES key_results(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_sharetoken
        ON tasks("shareToken") WHERE "shareToken" IS NOT NULL
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notes_user_id    ON notes(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notes_project_id  ON notes(project_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_session  ON messages("sessionId")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_project     ON tasks("projectId")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_project  ON sessions("projectId")`);

    // ── Full-text search GIN index (Phase 5) ──────────────────────────────────
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_search_index_fts
        ON search_index USING GIN (to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(body,'')))
    `);

    console.log('[db] Schema ready');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

pool.query('SELECT NOW()')
  .then(() => {
    console.log('[db] PostgreSQL connected');
    return initSchema();
  })
  .catch(err => {
    console.error('[db] PostgreSQL startup failed:', err.message);
    process.exit(1);
  });

module.exports = { pool };
