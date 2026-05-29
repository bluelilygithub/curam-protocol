require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

// Security check — warn if gmail token encryption key is absent
try {
  const { getKey } = require('./utils/encryption');
  if (!getKey()) {
    console.warn('[security] ENCRYPTION_KEY is not set — gmail_tokens will be stored unencrypted. Generate a key with: openssl rand -hex 32');
  }
} catch (e) {
  console.error('[security] Encryption key error:', e.message);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Trust Railway's proxy — required for rate-limiter to work correctly
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'frame-src': ["'self'", 'https://www.youtube-nocookie.com', 'https://www.youtube.com'],
      'child-src': ["'self'", 'https://www.youtube-nocookie.com', 'https://www.youtube.com'],
    },
  } : false,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Require db early — triggers connection + schema creation automatically
const { pool } = require('./db');


async function seedInitialUser() {
  const { SEED_EMAIL, SEED_PASSWORD } = process.env;
  if (!SEED_EMAIL || !SEED_PASSWORD) return;
  const { rows } = await pool.query('SELECT id FROM users LIMIT 1');
  if (rows[0]) return;
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(SEED_PASSWORD, 12);
  await pool.query(
    'INSERT INTO users (email, "passwordHash", "isAdmin") VALUES ($1, $2, TRUE)',
    [SEED_EMAIL.toLowerCase(), hash]
  );
  console.log('Initial user created:', SEED_EMAIL);
}

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/shared', require('./routes/sharedTasks'));
app.use('/api/gmail', require('./routes/gmail'));
app.use('/api/calendar', require('./routes/calendar'));

const { requireAuth, requireAdmin, requireFeature } = require('./middleware/auth');
app.use('/api', requireAuth);

app.use('/api/user', requireAuth, require('./routes/user'));
app.use('/api/health', require('./routes/health'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/files', require('./routes/files'));
app.use('/api/pdf', require('./routes/pdf'));
app.use('/api/search', require('./routes/search'));
app.use('/api/email', require('./routes/email'));
app.use('/api/export', require('./routes/export'));
app.use('/api/study-decks', require('./routes/studyDecks'));
app.use('/api/student-quizzes', require('./routes/studentQuizzes'));
app.use('/api/fetch-url', require('./routes/fetchUrl'));
app.use('/api/web-search', require('./routes/webSearch'));
app.use('/api/memory', require('./routes/memory'));
app.use('/api/prompts', require('./routes/prompts'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/personas', require('./routes/personas'));
app.use('/api/pinned-urls', require('./routes/pinnedUrls'));
app.use('/api/compare', requireFeature('compare'), require('./routes/compare'));
app.use('/api/debate', requireFeature('debate'), require('./routes/debate'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/admin', requireAdmin, require('./routes/admin'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/task-templates', require('./routes/taskTemplates'));
app.use('/api/goals', requireFeature('goals'), require('./routes/goals'));
app.use('/api/mission', requireFeature('goals'), require('./routes/mission'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/session-files', require('./routes/sessionFiles'));
app.use('/api/chains', requireFeature('chains'), require('./routes/chains'));
app.use('/api/bookmarks', require('./routes/bookmarks'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/graph', requireFeature('graph'), require('./routes/graph'));
app.use('/api/finance', requireFeature('finance'), require('./routes/finance'));
app.use('/api/usage', requireFeature('usage'), require('./routes/usage'));
app.use('/api/mood', requireFeature('mood'), require('./routes/mood'));
app.use('/api/clients', requireFeature('clients'), require('./routes/clients'));
app.use('/api/news-digest', requireFeature('newsDigest'), require('./routes/newsDigest'));
// /api/shares/news must be registered before /api/shares to prevent prefix match interception
app.use('/api/shares/news', requireFeature('shares'), require('./routes/sharesNews'));
app.use('/api/shares', requireFeature('shares'), require('./routes/shares'));
app.use('/api/metals', requireFeature('shares'), require('./routes/metals'));
app.use('/api/youtube', requireFeature('youtube'), require('./routes/youtube'));

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// Start cron jobs
const { startNewsDigestCron } = require('./cron/newsDigestCron');
const { startSharesCron } = require('./cron/sharesCron');

// Poll until schema is ready, then seed and start listening
async function start() {
  for (let i = 0; i < 10; i++) {
    try {
      await pool.query('SELECT 1 FROM users LIMIT 1');
      break;
    } catch (err) {
      if (i === 9) throw new Error('Schema not ready after 10 attempts: ' + err.message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  await seedInitialUser().catch(err => console.error('Seed error:', err));
  startNewsDigestCron();
  startSharesCron();

  app.listen(PORT, () => {
    console.log('Vault server running on port ' + PORT);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = app;