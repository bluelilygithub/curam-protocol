'use strict';

const { Pool } = require('pg');
const { runtimeConfig } = require('./config/runtime');

// Enable SSL for any non-localhost host (Railway, Render, Supabase, etc.)
function sslConfig() {
  try {
    const u = new URL(runtimeConfig.databaseUrl || '');
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return local ? false : { rejectUnauthorized: false };
  } catch (_) {
    return false;
  }
}

const pool = new Pool({
  connectionString: runtimeConfig.databaseUrl,
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
        "isAdmin"     BOOLEAN NOT NULL DEFAULT FALSE,
        "mustChangePassword" BOOLEAN NOT NULL DEFAULT FALSE,
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
        model              TEXT,
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
        id              SERIAL PRIMARY KEY,
        "projectId"     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        url             TEXT NOT NULL,
        title           TEXT,
        content         TEXT,
        "isYoutube"     BOOLEAN DEFAULT FALSE,
        "createdAt"     TIMESTAMPTZ DEFAULT NOW(),
        "lastFetchedAt" TIMESTAMPTZ DEFAULT NOW()
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

    // Idempotent column additions — safe to run on every boot
    await client.query(`ALTER TABLE files ADD COLUMN IF NOT EXISTS "anthropicFileId" TEXT`);
    await client.query(`ALTER TABLE pinned_urls ADD COLUMN IF NOT EXISTS "lastFetchedAt" TIMESTAMPTZ DEFAULT NOW()`);
    await client.query(`ALTER TABLE pinned_urls ADD COLUMN IF NOT EXISTS "isYoutube" BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ DEFAULT NULL`);
    await client.query(`ALTER TABLE pinned_urls ADD COLUMN IF NOT EXISTS "transcript_summary" TEXT DEFAULT NULL`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS "startDate" DATE DEFAULT NULL`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS "targetEndDate" DATE DEFAULT NULL`);
    await client.query(`ALTER TABLE projects ALTER COLUMN model DROP DEFAULT`);

    // ── News Digest ───────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS news_topics (
        id          SERIAL PRIMARY KEY,
        "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        keywords    TEXT DEFAULT '',
        "sortOrder" INTEGER DEFAULT 0,
        active      BOOLEAN DEFAULT true,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS news_digests (
        id            SERIAL PRIMARY KEY,
        "userId"      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date          DATE NOT NULL,
        "generatedAt" TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE("userId", date)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS news_digest_topics (
        id        SERIAL PRIMARY KEY,
        "digestId" INTEGER NOT NULL REFERENCES news_digests(id) ON DELETE CASCADE,
        "topicId"  INTEGER NOT NULL REFERENCES news_topics(id) ON DELETE CASCADE,
        articles   JSONB DEFAULT '[]',
        analysis   JSONB DEFAULT '{}',
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS news_digest_context (
        id          SERIAL PRIMARY KEY,
        "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "topicId"   INTEGER NOT NULL REFERENCES news_topics(id) ON DELETE CASCADE,
        date        DATE NOT NULL,
        commentary  TEXT DEFAULT '',
        "updatedAt" TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE("userId", "topicId", date)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS news_chat (
        id          SERIAL PRIMARY KEY,
        "topicId"   INTEGER NOT NULL REFERENCES news_topics(id) ON DELETE CASCADE,
        "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role        TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content     TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_news_chat_topic ON news_chat("topicId", "createdAt")
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
        "deletedAt"      TIMESTAMPTZ,
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS wellbeing_attempts (
        id                       SERIAL PRIMARY KEY,
        "userId"                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "questionnaireVersion"   TEXT NOT NULL,
        answers                  JSONB NOT NULL,
        "totalScore"             INTEGER NOT NULL,
        band                     TEXT NOT NULL,
        "bandLabel"              TEXT NOT NULL,
        analysis                 JSONB NOT NULL,
        "safetyFlag"             BOOLEAN DEFAULT FALSE,
        "suicidalThoughtScore"   INTEGER DEFAULT 0,
        "createdAt"              TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wellbeing_attempts_user_created
      ON wellbeing_attempts("userId", "createdAt" DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS gad7_attempts (
        id                       SERIAL PRIMARY KEY,
        "userId"                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "questionnaireVersion"   TEXT NOT NULL,
        answers                  JSONB NOT NULL,
        "totalScore"             INTEGER NOT NULL,
        band                     TEXT NOT NULL,
        "bandLabel"              TEXT NOT NULL,
        analysis                 JSONB NOT NULL,
        "createdAt"              TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_gad7_attempts_user_created
      ON gad7_attempts("userId", "createdAt" DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS panas_attempts (
        id                       SERIAL PRIMARY KEY,
        "userId"                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "questionnaireVersion"   TEXT NOT NULL,
        answers                  JSONB NOT NULL,
        "scaleScores"            JSONB NOT NULL,
        analysis                 JSONB NOT NULL,
        "createdAt"              TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_panas_attempts_user_created
      ON panas_attempts("userId", "createdAt" DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS asrs5_attempts (
        id                       SERIAL PRIMARY KEY,
        "userId"                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "questionnaireVersion"   TEXT NOT NULL,
        answers                  JSONB NOT NULL,
        "totalScore"             INTEGER NOT NULL,
        band                     TEXT NOT NULL,
        "bandLabel"              TEXT NOT NULL,
        "scaleScores"            JSONB NOT NULL,
        analysis                 JSONB NOT NULL,
        "createdAt"              TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_asrs5_attempts_user_created
      ON asrs5_attempts("userId", "createdAt" DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ipip_neo_attempts (
        id                       SERIAL PRIMARY KEY,
        "userId"                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "questionnaireVersion"   TEXT NOT NULL,
        answers                  JSONB NOT NULL,
        "facetScores"            JSONB NOT NULL,
        "domainScores"           JSONB NOT NULL,
        analysis                 JSONB NOT NULL,
        "createdAt"              TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ipip_neo_attempts_user_created
      ON ipip_neo_attempts("userId", "createdAt" DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS hexaco_attempts (
        id                       SERIAL PRIMARY KEY,
        "userId"                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "questionnaireVersion"   TEXT NOT NULL,
        answers                  JSONB NOT NULL,
        "domainScores"           JSONB NOT NULL,
        analysis                 JSONB NOT NULL,
        "createdAt"              TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_hexaco_attempts_user_created
      ON hexaco_attempts("userId", "createdAt" DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cerq_attempts (
        id                       SERIAL PRIMARY KEY,
        "userId"                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "questionnaireVersion"   TEXT NOT NULL,
        answers                  JSONB NOT NULL,
        "scaleScores"            JSONB NOT NULL,
        analysis                 JSONB NOT NULL,
        "createdAt"              TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cerq_attempts_user_created
      ON cerq_attempts("userId", "createdAt" DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cope_attempts (
        id                       SERIAL PRIMARY KEY,
        "userId"                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "questionnaireVersion"   TEXT NOT NULL,
        answers                  JSONB NOT NULL,
        "scaleScores"            JSONB NOT NULL,
        analysis                 JSONB NOT NULL,
        "createdAt"              TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_cope_attempts_user_created
      ON cope_attempts("userId", "createdAt" DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS wellbeing_combined_reports (
        id                       SERIAL PRIMARY KEY,
        "userId"                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        variant                  TEXT NOT NULL,
        "sourceKey"              TEXT NOT NULL,
        "sourceAttempts"         JSONB NOT NULL,
        profile                  JSONB NOT NULL,
        "createdAt"              TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"              TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE ("userId", variant, "sourceKey")
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wellbeing_combined_reports_user_variant_updated
      ON wellbeing_combined_reports("userId", variant, "updatedAt" DESC)
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
      CREATE TABLE IF NOT EXISTS workspace_settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        "updatedAt" TIMESTAMPTZ DEFAULT NOW()
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
        "renewalDimension"  TEXT DEFAULT NULL,
        "isMilestone"       INTEGER DEFAULT 0
      )
    `);

    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "recurrenceGroupId" TEXT DEFAULT NULL`);
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "activityStatus" TEXT NOT NULL DEFAULT 'none' CHECK("activityStatus" IN ('none','started','paused','waiting'))`);
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "isMilestone" INTEGER DEFAULT 0`);

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS session_files (
        "sessionId" TEXT NOT NULL REFERENCES sessions("sessionId") ON DELETE CASCADE,
        "fileId"    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        PRIMARY KEY ("sessionId", "fileId")
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS prompt_chains (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT DEFAULT '',
        steps       TEXT NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id          SERIAL PRIMARY KEY,
        "messageId" INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        "sessionId" TEXT NOT NULL REFERENCES sessions("sessionId") ON DELETE CASCADE,
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE("messageId")
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_suggestions (
        id          SERIAL PRIMARY KEY,
        "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category    TEXT NOT NULL DEFAULT 'other',
        status      TEXT NOT NULL DEFAULT 'new',
        title       TEXT NOT NULL,
        body        TEXT NOT NULL DEFAULT '',
        context     TEXT,
        source      TEXT,
        fingerprint TEXT,
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS study_decks (
        id              SERIAL PRIMARY KEY,
        "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title           TEXT NOT NULL DEFAULT '',
        kind            TEXT NOT NULL DEFAULT 'mixed',
        payload         JSONB NOT NULL DEFAULT '{}',
        "sessionId"     TEXT REFERENCES sessions("sessionId") ON DELETE SET NULL,
        "createdAt"     TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"     TIMESTAMPTZ DEFAULT NOW(),
        "listOrder"     INTEGER NOT NULL DEFAULT 0
      )
    `);
    await client.query(`ALTER TABLE study_decks ADD COLUMN IF NOT EXISTS "listOrder" INTEGER NOT NULL DEFAULT 0`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS student_quizzes (
        id              SERIAL PRIMARY KEY,
        "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title           TEXT NOT NULL DEFAULT '',
        category        TEXT NOT NULL DEFAULT '',
        topic           TEXT NOT NULL DEFAULT '',
        level           TEXT NOT NULL DEFAULT '1st year',
        "questionCount" INTEGER NOT NULL DEFAULT 10,
        "questionTypes" JSONB NOT NULL DEFAULT '[]',
        passmark        INTEGER NOT NULL DEFAULT 80,
        tags            TEXT[] NOT NULL DEFAULT '{}',
        "questionPool"  JSONB NOT NULL DEFAULT '[]',
        "createdAt"     TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE student_quizzes ADD COLUMN IF NOT EXISTS "listOrder" INTEGER NOT NULL DEFAULT 0`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS student_quiz_attempts (
        id                SERIAL PRIMARY KEY,
        "userId"          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "quizId"          INTEGER NOT NULL REFERENCES student_quizzes(id) ON DELETE CASCADE,
        "scorePercent"    NUMERIC(5,2) NOT NULL DEFAULT 0,
        "timeTakenMs"     INTEGER NOT NULL DEFAULT 0,
        passed            BOOLEAN NOT NULL DEFAULT FALSE,
        "questionResults" JSONB NOT NULL DEFAULT '[]',
        "performanceSummary" JSONB,
        "createdAt"       TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE student_quiz_attempts ADD COLUMN IF NOT EXISTS "performanceSummary" JSONB`);

    // ── Graphics gallery ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS graphics_gallery (
        id            SERIAL PRIMARY KEY,
        "userId"      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        prompt        TEXT NOT NULL,
        "imageDataUrl" TEXT NOT NULL,
        model         TEXT,
        seed          TEXT,
        width         INTEGER,
        height        INTEGER,
        metadata      JSONB,
        "createdAt"   TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Video library (saved tool outputs) ────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS video_library (
        id            SERIAL PRIMARY KEY,
        "userId"      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title         TEXT NOT NULL DEFAULT 'Untitled',
        tool          TEXT,
        "mediaType"   TEXT NOT NULL DEFAULT 'video' CHECK ("mediaType" IN ('video', 'image')),
        "filePath"    TEXT NOT NULL,
        "thumbPath"   TEXT,
        "fileSize"    INTEGER,
        "mimeType"    TEXT,
        transaction   JSONB,
        metadata      JSONB,
        "createdAt"   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_video_library_user_created
        ON video_library ("userId", "createdAt" DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS recipes (
        id              SERIAL PRIMARY KEY,
        "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title           TEXT NOT NULL DEFAULT 'Untitled',
        tags            TEXT[] NOT NULL DEFAULT '{}',
        source          TEXT,
        payload         JSONB NOT NULL DEFAULT '{}',
        "imageDataUrl"  TEXT,
        transaction     JSONB,
        "createdAt"     TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_recipes_user_updated
        ON recipes ("userId", "updatedAt" DESC)
    `);

    // ── Finance ───────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_accounts (
        id          SERIAL PRIMARY KEY,
        "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code        TEXT NOT NULL,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL CHECK(type IN ('asset','liability','equity','income','expense')),
        "isSystem"  BOOLEAN DEFAULT FALSE,
        "createdAt" TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE("userId", code)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_clients (
        id              SERIAL PRIMARY KEY,
        "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        "contactName"   TEXT,
        email           TEXT,
        phone           TEXT,
        address         TEXT,
        abn             TEXT,
        "isActive"      BOOLEAN NOT NULL DEFAULT TRUE,
        "createdAt"     TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE fin_clients ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE`);
    await client.query(`ALTER TABLE fin_clients ADD COLUMN IF NOT EXISTS "contactName" TEXT`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_invoices (
        id           SERIAL PRIMARY KEY,
        "userId"     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "clientId"   INTEGER REFERENCES fin_clients(id) ON DELETE SET NULL,
        number       TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','paid','void')),
        "issueDate"  DATE NOT NULL DEFAULT CURRENT_DATE,
        "dueDate"    DATE,
        subtotal     NUMERIC(10,2) NOT NULL DEFAULT 0,
        gst          NUMERIC(10,2) NOT NULL DEFAULT 0,
        total        NUMERIC(10,2) NOT NULL DEFAULT 0,
        notes        TEXT,
        "paidAt"     TIMESTAMPTZ,
        "createdAt"  TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE("userId", number)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_invoice_items (
        id           SERIAL PRIMARY KEY,
        "invoiceId"  INTEGER NOT NULL REFERENCES fin_invoices(id) ON DELETE CASCADE,
        description  TEXT NOT NULL,
        qty          NUMERIC(10,2) NOT NULL DEFAULT 1,
        "unitPrice"  NUMERIC(10,2) NOT NULL DEFAULT 0,
        gst          NUMERIC(10,2) NOT NULL DEFAULT 0,
        amount       NUMERIC(10,2) NOT NULL DEFAULT 0
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_expenses (
        id           SERIAL PRIMARY KEY,
        "userId"     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date         DATE NOT NULL DEFAULT CURRENT_DATE,
        description  TEXT NOT NULL,
        amount       NUMERIC(10,2) NOT NULL,
        gst          NUMERIC(10,2) NOT NULL DEFAULT 0,
        category     TEXT,
        supplier     TEXT,
        "createdAt"  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_wages (
        id             SERIAL PRIMARY KEY,
        "userId"       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date           DATE NOT NULL DEFAULT CURRENT_DATE,
        employee       TEXT NOT NULL,
        gross          NUMERIC(10,2) NOT NULL,
        tax            NUMERIC(10,2) NOT NULL DEFAULT 0,
        superannuation NUMERIC(10,2) NOT NULL DEFAULT 0,
        net            NUMERIC(10,2) NOT NULL,
        "createdAt"    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_journal_entries (
        id          SERIAL PRIMARY KEY,
        "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date        DATE NOT NULL DEFAULT CURRENT_DATE,
        description TEXT NOT NULL,
        reference   TEXT,
        type        TEXT NOT NULL DEFAULT 'manual' CHECK(type IN ('manual','invoice','payment','expense','wage')),
        "sourceId"  INTEGER,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_journal_lines (
        id          SERIAL PRIMARY KEY,
        "entryId"   INTEGER NOT NULL REFERENCES fin_journal_entries(id) ON DELETE CASCADE,
        "accountId" INTEGER NOT NULL REFERENCES fin_accounts(id) ON DELETE RESTRICT,
        debit       NUMERIC(10,2) NOT NULL DEFAULT 0,
        credit      NUMERIC(10,2) NOT NULL DEFAULT 0
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fin_bas_quarters (
        id             SERIAL PRIMARY KEY,
        "userId"       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        from_date      DATE NOT NULL,
        to_date        DATE NOT NULL,
        status         TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reconciled','lodged','paid')),
        reconciled_at  TIMESTAMPTZ,
        lodged_at      TIMESTAMPTZ,
        paid_at        TIMESTAMPTZ,
        "createdAt"    TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE("userId", from_date)
      )
    `);

    // ── Mood check-ins ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mood_wheel_config (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        config     TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mood_checkins (
        id                SERIAL PRIMARY KEY,
        user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entity_type       TEXT NOT NULL,
        entity_id         TEXT,
        core_emotion      TEXT NOT NULL,
        secondary_emotion TEXT,
        tertiary_emotion  TEXT,
        intensity         INTEGER NOT NULL DEFAULT 5 CHECK(intensity BETWEEN 1 AND 10),
        body_locations    TEXT,
        note              TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── Clients ───────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id                  SERIAL PRIMARY KEY,
        "userId"            INTEGER REFERENCES users(id) ON DELETE CASCADE,
        name                VARCHAR(255) NOT NULL,
        company             VARCHAR(255),
        status              VARCHAR(20) DEFAULT 'active'
                            CHECK (status IN ('prospect','active','paused','archived')),
        "communicationPref" VARCHAR(50),
        "howTheyWork"       TEXT,
        "startDate"         DATE,
        tags                JSON,
        notes               TEXT,
        "createdAt"         TIMESTAMP DEFAULT NOW(),
        "updatedAt"         TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS client_contacts (
        id          SERIAL PRIMARY KEY,
        "clientId"  INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        name        VARCHAR(255) NOT NULL,
        role        VARCHAR(100),
        email       VARCHAR(255),
        phone       VARCHAR(50),
        "isPrimary" BOOLEAN DEFAULT FALSE,
        "createdAt" TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS client_touchpoints (
        id          SERIAL PRIMARY KEY,
        "clientId"  INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        "contactId" INTEGER REFERENCES client_contacts(id) ON DELETE SET NULL,
        type        VARCHAR(20) CHECK (type IN ('call','email','meeting','decision','milestone','other')),
        date        DATE NOT NULL,
        note        TEXT,
        "createdAt" TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Mission Statements (versioned) ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS mission_statements (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        statement_text TEXT NOT NULL,
        wizard_data    JSONB,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        is_current     BOOLEAN DEFAULT FALSE,
        UNIQUE(user_id, version_number),
        CHECK (version_number > 0)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mission_user_current
        ON mission_statements(user_id, is_current) WHERE is_current = true
    `);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ── Post-commit: FKs, indexes, and RAG setup (all idempotent, best-effort) ──
  // These run outside the main transaction. Any individual failure is logged as
  // a warning so the server always starts, even without pgvector installed.

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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_suggestions_user_status ON agent_suggestions("userId", status, "createdAt" DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_suggestions_user_category ON agent_suggestions("userId", category, "createdAt" DESC)`);
  await pool.query(`ALTER TABLE agent_suggestions ADD COLUMN IF NOT EXISTS source TEXT`);
  await pool.query(`ALTER TABLE agent_suggestions ADD COLUMN IF NOT EXISTS fingerprint TEXT`);
  await pool.query(`ALTER TABLE agent_suggestions ADD COLUMN IF NOT EXISTS "implementationResult" JSONB`);
  await pool.query(`UPDATE agent_suggestions SET status = 'implement' WHERE status = 'apply'`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_suggestions_fingerprint
      ON agent_suggestions("userId", fingerprint)
      WHERE fingerprint IS NOT NULL
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notes_project_id  ON notes(project_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_session  ON messages("sessionId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_study_decks_user  ON study_decks("userId", "updatedAt" DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_student_quizzes_user ON student_quizzes("userId", "updatedAt" DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_student_quiz_attempts_user ON student_quiz_attempts("userId", "createdAt" DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_student_quiz_attempts_quiz ON student_quiz_attempts("quizId", "createdAt" DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_project     ON tasks("projectId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_project  ON sessions("projectId")`);

  // Full-text search GIN index
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_search_index_fts
      ON search_index USING GIN (to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(body,'')))
  `);

  // ── Knowledge graph edges (semantic connections cache) ────────────────────

  await pool.query(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      id          SERIAL PRIMARY KEY,
      source_id   TEXT NOT NULL,
      target_id   TEXT NOT NULL,
      edge_type   TEXT NOT NULL DEFAULT 'semantic',
      similarity  FLOAT,
      computed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (source_id, target_id)
    )
  `);

  // ── RAG: pgvector + file_chunks (best-effort — server starts without it) ──

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  } catch (vecErr) {
    console.warn('[db] pgvector extension not available — RAG embeddings disabled:', vecErr.message);
  }

  try {
    // text-embedding-004 produces 768-dimensional embeddings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS file_chunks (
        id          SERIAL PRIMARY KEY,
        file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        chunk_text  TEXT NOT NULL,
        embedding   vector(768),
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Migrate any existing installation that used a different dimension count
    await pool.query(`
      ALTER TABLE file_chunks ALTER COLUMN embedding TYPE vector(768)
    `);
  } catch (tblErr) {
    console.warn('[db] Could not create/migrate file_chunks table (pgvector may be missing):', tblErr.message);
  }

  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_file_chunks_file_id ON file_chunks(file_id)`);
    await pool.query(`ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS embedding_source TEXT`);
  } catch (idxErr) {
    console.warn('[db] Could not create idx_file_chunks_file_id:', idxErr.message);
  }

  // IVFFlat index — requires data to exist to be useful; skipped on empty tables or without pgvector
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_file_chunks_embedding
        ON file_chunks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
    `);
  } catch (idxErr) {
    console.warn('[db] Could not create IVFFlat index on file_chunks (normal on empty table):', idxErr.message);
  }

  // ── Multi-user: idempotent userId column additions ─────────────────────────
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS "userId" INTEGER REFERENCES users(id) ON DELETE CASCADE`);
  await pool.query(`ALTER TABLE folders ADD COLUMN IF NOT EXISTS "userId" INTEGER REFERENCES users(id) ON DELETE CASCADE`);
  await pool.query(`ALTER TABLE personas ADD COLUMN IF NOT EXISTS "userId" INTEGER REFERENCES users(id) ON DELETE CASCADE`);
  await pool.query(`ALTER TABLE memory ADD COLUMN IF NOT EXISTS "userId" INTEGER REFERENCES users(id) ON DELETE CASCADE`);
  await pool.query(`ALTER TABLE memory ADD COLUMN IF NOT EXISTS content_fingerprint TEXT`);
  await pool.query(`ALTER TABLE memory ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE memory ADD COLUMN IF NOT EXISTS embedding_source TEXT`);
  try {
    await pool.query(`ALTER TABLE memory ADD COLUMN IF NOT EXISTS embedding vector(768)`);
  } catch (memVecErr) {
    console.warn('[db] memory.embedding column skipped (pgvector may be missing):', memVecErr.message);
  }
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_user_fingerprint
      ON memory ("userId", content_fingerprint)
      WHERE content_fingerprint IS NOT NULL
  `);
  await pool.query(`ALTER TABLE prompts ADD COLUMN IF NOT EXISTS "userId" INTEGER REFERENCES users(id) ON DELETE CASCADE`);
  await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "userId" INTEGER REFERENCES users(id) ON DELETE CASCADE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks("userId", "isMilestone") WHERE "isMilestone" = 1`);
  await pool.query(`ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS "userId" INTEGER REFERENCES users(id) ON DELETE CASCADE`);
  await pool.query(`ALTER TABLE objectives ADD COLUMN IF NOT EXISTS "userId" INTEGER REFERENCES users(id) ON DELETE CASCADE`);
  await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS "userId" INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE prompt_chains ADD COLUMN IF NOT EXISTS "userId" INTEGER REFERENCES users(id) ON DELETE CASCADE`);

  // Backfill existing rows to user 1
  await pool.query(`UPDATE projects SET "userId" = 1 WHERE "userId" IS NULL`);
  await pool.query(`UPDATE folders SET "userId" = 1 WHERE "userId" IS NULL`);
  await pool.query(`UPDATE personas SET "userId" = 1 WHERE "userId" IS NULL`);
  await pool.query(`UPDATE memory SET "userId" = 1 WHERE "userId" IS NULL`);
  await pool.query(`UPDATE prompts SET "userId" = 1 WHERE "userId" IS NULL`);
  await pool.query(`UPDATE tasks SET "userId" = 1 WHERE "userId" IS NULL`);
  await pool.query(`UPDATE task_templates SET "userId" = 1 WHERE "userId" IS NULL`);
  await pool.query(`UPDATE objectives SET "userId" = 1 WHERE "userId" IS NULL`);
  await pool.query(`UPDATE sessions SET "userId" = 1 WHERE "userId" IS NULL`);
  await pool.query(`UPDATE prompt_chains SET "userId" = 1 WHERE "userId" IS NULL`);
  await pool.query(`UPDATE users SET "isAdmin" = TRUE WHERE id = 1`);

  // Settings: change PK to composite (userId, key) for per-user settings
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'settings' AND column_name = 'userId'
      ) THEN
        ALTER TABLE settings ADD COLUMN "userId" INTEGER REFERENCES users(id) ON DELETE CASCADE;
        UPDATE settings SET "userId" = 1;
        ALTER TABLE settings DROP CONSTRAINT settings_pkey;
        ALTER TABLE settings ADD PRIMARY KEY ("userId", key);
      END IF;
    END $$
  `);

  // Finance: idempotent column additions
  await pool.query(`ALTER TABLE fin_expenses ADD COLUMN IF NOT EXISTS receipt_path TEXT`);
  await pool.query(`ALTER TABLE fin_expenses ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT NOW()`);
  await pool.query(`ALTER TABLE fin_accounts ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT NOW()`);

  // Payment account on expenses (which account was credited — defaults to Bank if null)
  await pool.query(`ALTER TABLE fin_expenses ADD COLUMN IF NOT EXISTS "paidViaId" INTEGER REFERENCES fin_accounts(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE fin_expenses ADD COLUMN IF NOT EXISTS "ccSettled" BOOLEAN NOT NULL DEFAULT FALSE`);

  // Suppliers
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fin_suppliers (
      id          SERIAL PRIMARY KEY,
      "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      email       TEXT,
      phone       TEXT,
      abn         TEXT,
      website     TEXT,
      notes       TEXT,
      "isActive"  BOOLEAN NOT NULL DEFAULT TRUE,
      "createdAt" TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Income / Expense transaction codes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fin_tx_codes (
      id          SERIAL PRIMARY KEY,
      "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code        TEXT NOT NULL,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL CHECK(type IN ('income','expense')),
      description TEXT,
      "isSystem"  BOOLEAN NOT NULL DEFAULT FALSE,
      "isActive"  BOOLEAN NOT NULL DEFAULT TRUE,
      "createdAt" TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE("userId", code)
    )
  `);

  // Link tx codes to invoice items and expenses
  await pool.query(`ALTER TABLE fin_invoice_items ADD COLUMN IF NOT EXISTS "txCodeId" INTEGER REFERENCES fin_tx_codes(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE fin_expenses ADD COLUMN IF NOT EXISTS "txCodeId" INTEGER REFERENCES fin_tx_codes(id) ON DELETE SET NULL`);

  // Fix journal entries type CHECK to include 'bas'
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE fin_journal_entries DROP CONSTRAINT IF EXISTS fin_journal_entries_type_check;
      ALTER TABLE fin_journal_entries
        ADD CONSTRAINT fin_journal_entries_type_check
        CHECK(type IN ('manual','invoice','payment','expense','wage','bas','interest'));
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$
  `);

  // ── Usage logs ────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT,
      model_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd NUMERIC(10,8) NOT NULL DEFAULT 0,
      feature TEXT NOT NULL DEFAULT 'chat',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS usage_logs_user_created
    ON usage_logs(user_id, created_at DESC)
  `);
  await pool.query(`ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER NOT NULL DEFAULT 0`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mood_checkins_user ON mood_checkins(user_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mood_checkins_entity ON mood_checkins(entity_type, entity_id)`);

  // ── Mood sessions (inquiry journeys) ──────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mood_sessions (
      id                SERIAL PRIMARY KEY,
      user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,
      started_at        TIMESTAMP DEFAULT NOW(),
      completed_at      TIMESTAMP,
      body_scan         JSON,
      conversation      JSON,
      pattern_context   JSON,
      user_summary      TEXT,
      dominant_emotions JSON,
      duration_seconds  INTEGER,
      created_at        TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mood_sessions_user ON mood_sessions(user_id, created_at DESC)`);

  // ── mood_checkins phase-2 columns ─────────────────────────────────────────
  await pool.query(`ALTER TABLE mood_checkins ADD COLUMN IF NOT EXISTS body_qualities JSON`);
  await pool.query(`ALTER TABLE mood_checkins ADD COLUMN IF NOT EXISTS body_description TEXT`);
  await pool.query(`ALTER TABLE mood_checkins ADD COLUMN IF NOT EXISTS is_surface BOOLEAN`);
  await pool.query(`ALTER TABLE mood_checkins ADD COLUMN IF NOT EXISTS check_in_type VARCHAR(10) DEFAULT 'quick'`);
  await pool.query(`ALTER TABLE mood_checkins ADD COLUMN IF NOT EXISTS inquiry_session_id INTEGER REFERENCES mood_sessions(id) ON DELETE SET NULL`);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE mood_checkins
        ADD CONSTRAINT mood_checkins_check_in_type_check
        CHECK (check_in_type IN ('quick', 'inquiry'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  // ── News digest: token tracking ───────────────────────────────────────────
  await pool.query(`ALTER TABLE news_digests ADD COLUMN IF NOT EXISTS "totalTokens" INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE news_digests ADD COLUMN IF NOT EXISTS "approxCostUsd" NUMERIC(10,6) DEFAULT 0`);

  // ── Clients: schema additions ─────────────────────────────────────────────
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "clientType" VARCHAR(10) DEFAULT 'company'`);
  await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS "clientId" INTEGER REFERENCES clients(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE fin_invoices ADD COLUMN IF NOT EXISTS "clientRef" INTEGER REFERENCES clients(id) ON DELETE SET NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_clients_user ON clients("userId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_contacts_client ON client_contacts("clientId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_touchpoints_client ON client_touchpoints("clientId")`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_projects_client ON projects("clientId")`);

  // ── Mission statements: trigger to enforce single current per user ─────────
  await pool.query(`
    CREATE OR REPLACE FUNCTION enforce_single_current_mission()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.is_current = true THEN
        UPDATE mission_statements
          SET is_current = false
          WHERE user_id = NEW.user_id
            AND id != NEW.id
            AND is_current = true;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await pool.query(`
    DO $$ BEGIN
      CREATE TRIGGER maintain_current_mission
        BEFORE INSERT OR UPDATE ON mission_statements
        FOR EACH ROW EXECUTE FUNCTION enforce_single_current_mission();
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  // ── Mission statements: migrate existing from settings ────────────────────
  // For each user who has mission_statement in settings but no row in mission_statements,
  // insert it as version 1 (is_current = true).
  await pool.query(`
    INSERT INTO mission_statements (user_id, version_number, statement_text, is_current)
    SELECT s."userId", 1, s.value, true
    FROM settings s
    WHERE s.key = 'mission_statement'
      AND s.value IS NOT NULL
      AND s.value != ''
      AND NOT EXISTS (
        SELECT 1 FROM mission_statements m WHERE m.user_id = s."userId"
      )
  `);

  // ── Session summaries for project RAG ────────────────────────────────────
  await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS summary TEXT`);
  try {
    await pool.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS "summaryEmbedding" vector(768)`);
  } catch (err) {
    console.warn('[db] Could not add summaryEmbedding column (pgvector may be missing):', err.message);
  }
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_deleted_at ON sessions("deletedAt")`);

  // ── Shares portfolio ──────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS share_trades (
      id              SERIAL PRIMARY KEY,
      "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol          TEXT NOT NULL,
      exchange        TEXT NOT NULL CHECK (exchange IN ('ASX', 'NYSE')),
      side            TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
      quantity        NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
      "pricePerShare" NUMERIC(18, 6) NOT NULL CHECK ("pricePerShare" >= 0),
      currency        TEXT NOT NULL CHECK (currency IN ('AUD', 'USD')),
      "fxRateToAud"   NUMERIC(18, 8),
      "feesAud"       NUMERIC(18, 2) NOT NULL DEFAULT 0,
      "tradedAt"      TIMESTAMPTZ NOT NULL,
      notes           TEXT,
      "createdAt"     TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS share_cash_ledger (
      id          SERIAL PRIMARY KEY,
      "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type        TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw')),
      "amountAud" NUMERIC(18, 2) NOT NULL CHECK ("amountAud" > 0),
      note        TEXT,
      "createdAt" TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS share_portfolio_snapshots (
      id                  BIGSERIAL PRIMARY KEY,
      "userId"            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "totalValueAud"     NUMERIC(18, 2) NOT NULL,
      "holdingsValueAud"  NUMERIC(18, 2) NOT NULL,
      "cashAud"           NUMERIC(18, 2) NOT NULL,
      "costBasisAud"      NUMERIC(18, 2) NOT NULL,
      "recordedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_share_portfolio_snapshots_user_time
      ON share_portfolio_snapshots ("userId", "recordedAt" DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS share_symbol_snapshots (
      id           BIGSERIAL PRIMARY KEY,
      "userId"     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol       TEXT NOT NULL,
      "priceAud"   NUMERIC(18, 6) NOT NULL,
      "valueAud"   NUMERIC(18, 2) NOT NULL,
      quantity     NUMERIC(18, 6) NOT NULL,
      "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_share_symbol_snapshots_user_sym_time
      ON share_symbol_snapshots ("userId", symbol, "recordedAt" DESC)
  `);

  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE share_trades DROP CONSTRAINT IF EXISTS share_trades_exchange_check;
      ALTER TABLE share_trades
        ADD CONSTRAINT share_trades_exchange_check
        CHECK (exchange IN ('ASX', 'NYSE', 'NASDAQ'));
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS share_news_briefings (
      id               BIGSERIAL PRIMARY KEY,
      "userId"         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date             DATE NOT NULL,
      symbol           TEXT,
      exchange         TEXT,
      content          TEXT NOT NULL,
      signal           TEXT CHECK (signal IN ('bullish', 'bearish', 'watch', 'neutral')),
      headlines        JSONB DEFAULT '[]',
      "priceChangePct" NUMERIC(8, 4),
      "createdAt"      TIMESTAMPTZ DEFAULT NOW(),
      type             TEXT NOT NULL DEFAULT 'daily'
    )
  `);
  // Add type column to existing tables (idempotent)
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE share_news_briefings ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'daily';
    EXCEPTION WHEN OTHERS THEN NULL; END $$
  `);
  // Drop old unique index (didn't include type) and recreate with type included
  // This is a one-time migration — old index disappears on first boot after deploy
  await pool.query(`DROP INDEX IF EXISTS idx_share_news_user_date_sym`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_share_news_user_date_sym_v2
      ON share_news_briefings ("userId", date, COALESCE(symbol, ''), COALESCE(exchange, ''), type)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_share_news_user_date
      ON share_news_briefings ("userId", date DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS share_qa (
      id          SERIAL PRIMARY KEY,
      "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question    TEXT NOT NULL,
      answer      TEXT NOT NULL,
      model       TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_share_qa_user_created
      ON share_qa ("userId", "createdAt" DESC)
  `);

  // ── Precious metals ───────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metal_purchases (
      id              SERIAL PRIMARY KEY,
      "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      metal           TEXT NOT NULL DEFAULT 'XAU',
      description     TEXT,
      "weightOz"      NUMERIC(12, 4) NOT NULL,
      "paidAud"       NUMERIC(18, 2) NOT NULL,
      "spotAudPerOz"  NUMERIC(18, 4),
      "purchasedAt"   DATE NOT NULL DEFAULT CURRENT_DATE,
      notes           TEXT,
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS metal_spot_snapshots (
      id           BIGSERIAL PRIMARY KEY,
      metal        TEXT NOT NULL DEFAULT 'XAU',
      "audPerOz"   NUMERIC(18, 4) NOT NULL,
      "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_metal_spot_snapshots_metal_time
      ON metal_spot_snapshots (metal, "recordedAt" DESC)
  `);

  // ── YouTube ───────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS youtube_search_history (
      id            SERIAL PRIMARY KEY,
      "userId"      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      query         TEXT NOT NULL,
      filters       JSONB NOT NULL DEFAULT '{}',
      "resultCount" INTEGER NOT NULL DEFAULT 0,
      "createdAt"   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_youtube_search_history_user
      ON youtube_search_history ("userId", "createdAt" DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS youtube_favourites (
      id            SERIAL PRIMARY KEY,
      "userId"      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "videoId"     TEXT NOT NULL,
      title         TEXT NOT NULL,
      channel       TEXT,
      thumbnail     TEXT,
      duration      TEXT,
      "viewCount"   TEXT,
      "publishedAt" TIMESTAMPTZ,
      "createdAt"   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_youtube_favourites_user_video
      ON youtube_favourites ("userId", "videoId")
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gmail_classifications (
      "userId"        TEXT NOT NULL,
      "threadId"      TEXT NOT NULL,
      "lastMessageId" TEXT NOT NULL,
      category        TEXT NOT NULL DEFAULT 'fyi',
      "oneLine"       TEXT,
      "classifiedAt"  TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY ("userId", "threadId")
    )
  `);
  await pool.query(`ALTER TABLE gmail_classifications ADD COLUMN IF NOT EXISTS actioned BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE gmail_classifications ADD COLUMN IF NOT EXISTS "isExpense" BOOLEAN`);
  await pool.query(`ALTER TABLE gmail_classifications ADD COLUMN IF NOT EXISTS acknowledged BOOLEAN DEFAULT FALSE`);
  // Force re-classify rows without isExpense so LLM re-evaluates them with the new field
  await pool.query(`UPDATE gmail_classifications SET "lastMessageId" = '' WHERE "isExpense" IS NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_scout_runs (
      id          SERIAL PRIMARY KEY,
      "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      query       TEXT NOT NULL,
      result      JSONB NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_product_scout_runs_user_time
      ON product_scout_runs ("userId", "createdAt" DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_projects (
      id              SERIAL PRIMARY KEY,
      "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name            TEXT NOT NULL DEFAULT 'Untitled',
      url             TEXT NOT NULL,
      notes           TEXT NOT NULL DEFAULT '',
      "siteSnapshot"  JSONB NOT NULL DEFAULT '{}',
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_seo_projects_user_updated
      ON seo_projects ("userId", "updatedAt" DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_artifacts (
      id              SERIAL PRIMARY KEY,
      "projectId"     INTEGER NOT NULL REFERENCES seo_projects(id) ON DELETE CASCADE,
      "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL,
      payload         JSONB NOT NULL DEFAULT '{}',
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_seo_artifacts_project_kind
      ON seo_artifacts ("projectId", kind, "updatedAt" DESC)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_artifacts_one_kind
      ON seo_artifacts ("projectId", kind)
  `);
  await pool.query(`ALTER TABLE seo_projects ADD COLUMN IF NOT EXISTS offer TEXT NOT NULL DEFAULT ''`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_audits (
      id              SERIAL PRIMARY KEY,
      "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name            TEXT NOT NULL DEFAULT 'Untitled',
      url             TEXT NOT NULL,
      score           INTEGER NOT NULL DEFAULT 0,
      summary         TEXT NOT NULL DEFAULT '',
      snapshot        JSONB NOT NULL DEFAULT '{}',
      report          JSONB NOT NULL DEFAULT '{}',
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_seo_audits_user_updated
      ON seo_audits ("userId", "updatedAt" DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS html_audits (
      id              SERIAL PRIMARY KEY,
      "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name            TEXT NOT NULL DEFAULT 'Untitled',
      url             TEXT NOT NULL,
      score           INTEGER NOT NULL DEFAULT 0,
      summary         TEXT NOT NULL DEFAULT '',
      strategy        TEXT NOT NULL DEFAULT 'mobile',
      report          JSONB NOT NULL DEFAULT '{}',
      "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_html_audits_user_updated
      ON html_audits ("userId", "updatedAt" DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gsc_tokens (
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gsc_snapshots (
      id          SERIAL PRIMARY KEY,
      "userId"    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "siteUrl"   TEXT NOT NULL,
      report      JSONB NOT NULL DEFAULT '{}',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_gsc_snapshots_user_created
      ON gsc_snapshots ("userId", "createdAt" DESC)
  `);

  // ── Finance: quotes + N-T tax code ───────────────────────────────────────
  await pool.query(`ALTER TABLE fin_invoices ADD COLUMN IF NOT EXISTS "docType" TEXT NOT NULL DEFAULT 'invoice'`);
  await pool.query(`ALTER TABLE fin_invoice_items ADD COLUMN IF NOT EXISTS "gstCode" TEXT NOT NULL DEFAULT 'GST'`);
  // Back-fill: items where gst=0 but amount>0 were intentionally non-taxable
  await pool.query(`UPDATE fin_invoice_items SET "gstCode"='NT' WHERE "gstCode"='GST' AND gst=0 AND amount>0`);
  // Extend status constraint to cover quote lifecycle values
  await pool.query(`ALTER TABLE fin_invoices DROP CONSTRAINT IF EXISTS fin_invoices_status_check`);
  await pool.query(`ALTER TABLE fin_invoices ADD CONSTRAINT fin_invoices_status_check CHECK(status IN ('draft','sent','paid','void','accepted','declined'))`);

  // ── Finance: Super Payable + Superannuation Expense accounts ─────────────
  // Ensure these accounts exist for all users who already have a chart of accounts
  await pool.query(`
    INSERT INTO fin_accounts ("userId", code, name, type, "isSystem")
    SELECT DISTINCT "userId", '2300', 'Super Payable', 'liability', true
    FROM fin_accounts
    ON CONFLICT ("userId", code) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO fin_accounts ("userId", code, name, type, "isSystem")
    SELECT DISTINCT "userId", '6100', 'Superannuation Expense', 'expense', true
    FROM fin_accounts
    ON CONFLICT ("userId", code) DO NOTHING
  `);

  // ── Finance: data integrity migrations ───────────────────────────────────

  // 1. Remove orphan journal entries whose source row no longer exists.
  //    These were left behind by delete routes that didn't clean up journals.
  await pool.query(`
    DELETE FROM fin_journal_entries
    WHERE type = 'invoice'
      AND "sourceId" NOT IN (SELECT id FROM fin_invoices)
  `);
  await pool.query(`
    DELETE FROM fin_journal_entries
    WHERE type = 'payment'
      AND "sourceId" NOT IN (SELECT id FROM fin_invoices)
  `);
  await pool.query(`
    DELETE FROM fin_journal_entries
    WHERE type = 'expense'
      AND "sourceId" NOT IN (SELECT id FROM fin_expenses)
  `);
  await pool.query(`
    DELETE FROM fin_journal_entries
    WHERE type = 'wage'
      AND "sourceId" NOT IN (SELECT id FROM fin_wages)
  `);

  // 2. Remove invoice journals for invoices still in draft status.
  //    Journals now only post when an invoice is sent.
  await pool.query(`
    DELETE FROM fin_journal_entries
    WHERE type = 'invoice'
      AND "sourceId" IN (
        SELECT id FROM fin_invoices WHERE status = 'draft'
      )
  `);

  // 3. Back-fill missing super journal lines for existing wage entries.
  //    For each wage with superannuation > 0 that has a journal entry but
  //    no Super Expense line, add the missing DR Super Expense / CR Super Payable lines.
  await pool.query(`
    DO $$
    DECLARE
      w   RECORD;
      e   RECORD;
      exp_id INTEGER;
      liab_id INTEGER;
    BEGIN
      FOR w IN
        SELECT fw.id, fw."userId", fw.superannuation, fw.date
        FROM fin_wages fw
        WHERE fw.superannuation > 0
      LOOP
        -- Find the journal entry for this wage
        SELECT je.id INTO e
        FROM fin_journal_entries je
        WHERE je."userId" = w."userId"
          AND je."sourceId" = w.id
          AND je.type = 'wage'
        LIMIT 1;

        IF e.id IS NULL THEN CONTINUE; END IF;

        -- Only add lines if Super Expense line is missing
        IF EXISTS (
          SELECT 1 FROM fin_journal_lines jl
          JOIN fin_accounts fa ON fa.id = jl."accountId"
          WHERE jl."entryId" = e.id AND fa.code = '6100'
        ) THEN CONTINUE; END IF;

        -- Get the Super Expense and Super Payable account IDs for this user
        SELECT id INTO exp_id  FROM fin_accounts WHERE "userId" = w."userId" AND code = '6100' LIMIT 1;
        SELECT id INTO liab_id FROM fin_accounts WHERE "userId" = w."userId" AND code = '2300' LIMIT 1;

        IF exp_id IS NULL OR liab_id IS NULL THEN CONTINUE; END IF;

        INSERT INTO fin_journal_lines ("entryId", "accountId", debit, credit)
        VALUES (e.id, exp_id,  w.superannuation, 0),
               (e.id, liab_id, 0, w.superannuation);
      END LOOP;
    END $$
  `);
  // ── Finance: recurring invoices & expenses ───────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fin_recurring (
      id           SERIAL PRIMARY KEY,
      "userId"     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type         TEXT NOT NULL CHECK(type IN ('invoice','expense')),
      label        TEXT NOT NULL DEFAULT '',
      frequency    TEXT NOT NULL CHECK(frequency IN ('weekly','fortnightly','monthly','quarterly','annually')),
      "nextDate"   DATE NOT NULL,
      active       BOOLEAN NOT NULL DEFAULT TRUE,
      template     JSONB NOT NULL DEFAULT '{}',
      "createdAt"  TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt"  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── Translate agent ───────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS translate_glossaries (
      id           SERIAL PRIMARY KEY,
      "userId"     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      terms        JSONB NOT NULL DEFAULT '[]',
      "createdAt"  TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt"  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS translate_jobs (
      id                  SERIAL PRIMARY KEY,
      "userId"            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename            TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending',
      stage               TEXT,
      progress            INTEGER DEFAULT 0,
      "sourceLanguage"    TEXT,
      "targetLanguage"    TEXT NOT NULL,
      "pageCount"         INTEGER,
      "scannedPageCount"  INTEGER DEFAULT 0,
      "avgOcrConfidence"  FLOAT,
      "glossaryId"        INTEGER REFERENCES translate_glossaries(id) ON DELETE SET NULL,
      "sourceTextJson"    JSONB,
      "translatedTextJson" TEXT,
      "charCount"         INTEGER DEFAULT 0,
      "originalPdf"       BYTEA,
      "translatedPdf"     BYTEA,
      "errorMessage"      TEXT,
      "fileSizeBytes"     INTEGER,
      "createdAt"         TIMESTAMPTZ DEFAULT NOW(),
      "completedAt"       TIMESTAMPTZ
    )
  `);

  // 90-day retention cleanup
  await pool.query(`
    DELETE FROM translate_jobs WHERE "createdAt" < NOW() - INTERVAL '90 days'
  `);

  // Migrate translatedTextJson from JSONB → TEXT if it was created with the old schema
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='translate_jobs' AND column_name='translatedTextJson'
          AND data_type='jsonb'
      ) THEN
        ALTER TABLE translate_jobs ALTER COLUMN "translatedTextJson" TYPE TEXT USING "translatedTextJson"::text;
      END IF;
    END $$
  `);

  // Add charCount column if missing
  await pool.query(`
    ALTER TABLE translate_jobs ADD COLUMN IF NOT EXISTS "charCount" INTEGER DEFAULT 0
  `);

  // ── Guitar Learning Agent ─────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guitar_songs (
      id              SERIAL PRIMARY KEY,
      "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "youtubeUrl"    TEXT,
      title           TEXT,
      artist          TEXT,
      duration        NUMERIC(8,2),
      "keyDetected"   TEXT,
      "capoSuggested" INTEGER DEFAULT 0,
      tuning          TEXT DEFAULT 'E Standard',
      bpm             INTEGER,
      status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','processing','done','failed')),
      "errorMessage"  TEXT,
      "sourceType"    TEXT NOT NULL DEFAULT 'youtube'
                        CHECK ("sourceType" IN ('youtube','upload','manual')),
      "audioMime"     TEXT,
      "audioData"     BYTEA,
      "createdAt"     TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt"     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Guitar agent migrations — upload path + nullable YouTube URL
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE guitar_songs ALTER COLUMN "youtubeUrl" DROP NOT NULL;
    EXCEPTION WHEN others THEN NULL;
    END $$
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE guitar_songs ADD COLUMN IF NOT EXISTS "sourceType" TEXT NOT NULL DEFAULT 'youtube';
    EXCEPTION WHEN others THEN NULL;
    END $$
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE guitar_songs ADD COLUMN IF NOT EXISTS "audioMime" TEXT;
    EXCEPTION WHEN others THEN NULL;
    END $$
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE guitar_songs ADD COLUMN IF NOT EXISTS "audioData" BYTEA;
    EXCEPTION WHEN others THEN NULL;
    END $$
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guitar_chord_events (
      id                SERIAL PRIMARY KEY,
      "songId"          INTEGER NOT NULL REFERENCES guitar_songs(id) ON DELETE CASCADE,
      "timestampSec"    NUMERIC(8,3) NOT NULL,
      "chordRoot"       TEXT NOT NULL,
      "chordQuality"    TEXT NOT NULL DEFAULT '',
      "confidenceScore" NUMERIC(4,3),
      "isUserCorrected" BOOLEAN DEFAULT FALSE,
      "sectionName"     TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guitar_chord_shapes (
      id                SERIAL PRIMARY KEY,
      "chordName"       TEXT NOT NULL,
      "voicingType"     TEXT DEFAULT 'open',
      "fretPositions"   JSONB NOT NULL,
      "fingerPositions" JSONB,
      "baseFret"        INTEGER DEFAULT 1
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guitar_user_songs (
      id                  SERIAL PRIMARY KEY,
      "userId"            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "songId"            INTEGER NOT NULL REFERENCES guitar_songs(id) ON DELETE CASCADE,
      notes               TEXT,
      "lastPracticedAt"   TIMESTAMPTZ,
      "isFavorite"        BOOLEAN DEFAULT FALSE,
      "transposeOffset"   INTEGER DEFAULT 0,
      "capoOverride"      INTEGER,
      "createdAt"         TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE("userId", "songId")
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guitar_user_song_loops (
      id              SERIAL PRIMARY KEY,
      "userSongId"    INTEGER NOT NULL REFERENCES guitar_user_songs(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      "startTimeSec"  NUMERIC(8,2) NOT NULL,
      "endTimeSec"    NUMERIC(8,2) NOT NULL,
      "createdAt"     TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Seed basic open-chord shapes if table is empty
  const shapeCount = await pool.query('SELECT COUNT(*) FROM guitar_chord_shapes');
  if (parseInt(shapeCount.rows[0].count) === 0) {
    const openShapes = [
      { chordName: 'E',  voicingType: 'open', fretPositions: [0,2,2,1,0,0], fingerPositions: [0,2,3,1,0,0], baseFret: 1 },
      { chordName: 'Em', voicingType: 'open', fretPositions: [0,2,2,0,0,0], fingerPositions: [0,2,3,0,0,0], baseFret: 1 },
      { chordName: 'A',  voicingType: 'open', fretPositions: [-1,0,2,2,2,0], fingerPositions: [0,0,1,2,3,0], baseFret: 1 },
      { chordName: 'Am', voicingType: 'open', fretPositions: [-1,0,2,2,1,0], fingerPositions: [0,0,2,3,1,0], baseFret: 1 },
      { chordName: 'D',  voicingType: 'open', fretPositions: [-1,-1,0,2,3,2], fingerPositions: [0,0,0,1,3,2], baseFret: 1 },
      { chordName: 'Dm', voicingType: 'open', fretPositions: [-1,-1,0,2,3,1], fingerPositions: [0,0,0,2,3,1], baseFret: 1 },
      { chordName: 'G',  voicingType: 'open', fretPositions: [3,2,0,0,0,3],  fingerPositions: [3,2,0,0,0,4], baseFret: 1 },
      { chordName: 'C',  voicingType: 'open', fretPositions: [-1,3,2,0,1,0], fingerPositions: [0,3,2,0,1,0], baseFret: 1 },
      { chordName: 'F',  voicingType: 'barre', fretPositions: [1,1,2,3,3,1], fingerPositions: [1,1,2,3,4,1], baseFret: 1 },
      { chordName: 'B',  voicingType: 'barre', fretPositions: [-1,2,4,4,4,2], fingerPositions: [0,1,3,4,4,2], baseFret: 2 },
      { chordName: 'Bm', voicingType: 'barre', fretPositions: [-1,2,4,4,3,2], fingerPositions: [0,1,3,4,2,1], baseFret: 2 },
      { chordName: 'G7', voicingType: 'open', fretPositions: [3,2,0,0,0,1],  fingerPositions: [3,2,0,0,0,1], baseFret: 1 },
      { chordName: 'C7', voicingType: 'open', fretPositions: [-1,3,2,3,1,0], fingerPositions: [0,3,2,4,1,0], baseFret: 1 },
      { chordName: 'D7', voicingType: 'open', fretPositions: [-1,-1,0,2,1,2], fingerPositions: [0,0,0,2,1,3], baseFret: 1 },
      { chordName: 'E7', voicingType: 'open', fretPositions: [0,2,0,1,0,0],  fingerPositions: [0,2,0,1,0,0], baseFret: 1 },
      { chordName: 'A7', voicingType: 'open', fretPositions: [-1,0,2,0,2,0], fingerPositions: [0,0,2,0,3,0], baseFret: 1 },
    ];
    for (const s of openShapes) {
      await pool.query(
        `INSERT INTO guitar_chord_shapes ("chordName","voicingType","fretPositions","fingerPositions","baseFret")
         VALUES ($1,$2,$3,$4,$5)`,
        [s.chordName, s.voicingType, JSON.stringify(s.fretPositions), JSON.stringify(s.fingerPositions), s.baseFret]
      );
    }
  }

  console.log('[db] Schema ready');
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
