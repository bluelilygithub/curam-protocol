const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/vault.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expiresAt TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS personas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    systemPrompt TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pinned_urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT,
    content TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '',
    projectId INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    goal TEXT,
    problem TEXT,
    audience TEXT,
    techStack TEXT,
    constraints TEXT,
    successCriteria TEXT,
    tone TEXT,
    notes TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    size INTEGER,
    mimetype TEXT,
    path TEXT NOT NULL,
    extractedText TEXT,
    aiDescription TEXT,
    aiSummary TEXT,
    uploadedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId TEXT NOT NULL,
    projectId INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sessionId TEXT PRIMARY KEY,
    projectId INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT,
    isSummarized INTEGER DEFAULT 0,
    summaryContent TEXT,
    summarizedAt TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS debates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    debateId TEXT NOT NULL UNIQUE,
    topic TEXT NOT NULL,
    modelA TEXT NOT NULL,
    modelB TEXT NOT NULL,
    rounds TEXT DEFAULT '[]',
    projectId INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS comparisons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    docAName TEXT,
    docBName TEXT,
    mode TEXT,
    model TEXT,
    result TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS search_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in-progress','done')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
    category TEXT,
    projectId INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    parentTaskId INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    dueDate TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taskId INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taskId INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'user' CHECK(type IN ('user', 'system')),
    content TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    priority TEXT DEFAULT 'medium',
    recurrence TEXT DEFAULT 'none',
    tags TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS template_subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    templateId INTEGER NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    "order" INTEGER DEFAULT 0
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    type,
    projectId UNINDEXED,
    title,
    body
  );

  CREATE TABLE IF NOT EXISTS objectives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    timeframe TEXT,
    status TEXT DEFAULT 'active',
    color TEXT DEFAULT '#6366f1',
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS key_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    objectiveId INTEGER NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    targetValue REAL NOT NULL DEFAULT 100,
    currentValue REAL NOT NULL DEFAULT 0,
    unit TEXT DEFAULT '%',
    status TEXT DEFAULT 'active',
    dueDate TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taskId INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blockedByTaskId INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    createdAt TEXT DEFAULT (datetime('now')),
    UNIQUE(taskId, blockedByTaskId)
  );
`);

// Migrations — safe to run on existing DBs
['ALTER TABLE projects ADD COLUMN sortOrder INTEGER DEFAULT 0',
 'ALTER TABLE projects ADD COLUMN model TEXT DEFAULT \'claude-sonnet-4-6\'',
 'ALTER TABLE projects ADD COLUMN projectType TEXT',
 'ALTER TABLE projects ADD COLUMN typeConfig TEXT',
 'ALTER TABLE sessions ADD COLUMN starred INTEGER DEFAULT 0',
 'ALTER TABLE sessions ADD COLUMN inputTokens INTEGER DEFAULT 0',
 'ALTER TABLE sessions ADD COLUMN outputTokens INTEGER DEFAULT 0',
 'ALTER TABLE files ADD COLUMN pinned INTEGER DEFAULT 0',
 'ALTER TABLE projects ADD COLUMN folderId INTEGER',
 'ALTER TABLE projects ADD COLUMN personaId INTEGER',
 'ALTER TABLE sessions ADD COLUMN personaId INTEGER',
 'ALTER TABLE sessions ADD COLUMN branchedFrom TEXT',
 'ALTER TABLE tasks ADD COLUMN "order" INTEGER DEFAULT 0',
 'ALTER TABLE tasks ADD COLUMN recurrence TEXT DEFAULT \'none\'',
 'ALTER TABLE tasks ADD COLUMN sourceSessionId TEXT DEFAULT NULL',
 'ALTER TABLE tasks ADD COLUMN recurrenceConfig TEXT DEFAULT NULL',
 'ALTER TABLE tasks ADD COLUMN recurrenceCount INTEGER DEFAULT 0',
 'ALTER TABLE tasks ADD COLUMN shareToken TEXT DEFAULT NULL',
 'ALTER TABLE tasks ADD COLUMN estimatedMinutes INTEGER DEFAULT NULL',
 'ALTER TABLE tasks ADD COLUMN keyResultId INTEGER REFERENCES key_results(id) ON DELETE SET NULL',
 'ALTER TABLE tasks ADD COLUMN timeSpentMinutes INTEGER DEFAULT 0',
 'ALTER TABLE tasks ADD COLUMN isUrgent INTEGER DEFAULT 0',
 'ALTER TABLE tasks ADD COLUMN renewalDimension TEXT DEFAULT NULL',
 'ALTER TABLE objectives ADD COLUMN renewalDimension TEXT DEFAULT NULL',
].forEach(sql => { try { db.exec(sql); } catch (_) {} });

// Unique index for shareToken (separate try/catch — CREATE INDEX IF NOT EXISTS is idempotent)
try { db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_shareToken ON tasks(shareToken) WHERE shareToken IS NOT NULL').run(); } catch (_) {}

module.exports = db;
