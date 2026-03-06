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

  CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    type,
    projectId UNINDEXED,
    title,
    body
  );
`);

// Migrations ΓÇö safe to run on existing DBs
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
].forEach(sql => { try { db.exec(sql); } catch (_) {} });

module.exports = db;
