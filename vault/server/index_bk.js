require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Security
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Ensure upload dir exists
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Auto-seed: create account from env vars if no users exist
async function seedInitialUser() {
  const { SEED_EMAIL, SEED_PASSWORD } = process.env;
  if (!SEED_EMAIL || !SEED_PASSWORD) return;
  const db = require('./db');
  const existing = db.prepare('SELECT id FROM users WHERE 1').get();
  if (existing) return;
  const bcrypt = require('bcrypt');
  const hash = await bcrypt.hash(SEED_PASSWORD, 12);
  db.prepare('INSERT INTO users (email, passwordHash) VALUES (?, ?)').run(SEED_EMAIL.toLowerCase(), hash);
  console.log('✓ Initial user created:', SEED_EMAIL);
}
seedInitialUser().catch(err => console.error('Seed error:', err));

// Auth (must be before requireAuth middleware)
app.use('/api/auth', require('./routes/auth'));

// Protect all remaining /api routes
const { requireAuth } = require('./middleware/auth');
app.use('/api', requireAuth);

// Routes
app.use('/api/health', require('./routes/health'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/files', require('./routes/files'));
app.use('/api/pdf', require('./routes/pdf'));
app.use('/api/search', require('./routes/search'));
app.use('/api/email', require('./routes/email'));
app.use('/api/export', require('./routes/export'));
app.use('/api/fetch-url', require('./routes/fetchUrl'));
app.use('/api/memory', require('./routes/memory'));
app.use('/api/prompts', require('./routes/prompts'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/personas', require('./routes/personas'));
app.use('/api/pinned-urls', require('./routes/pinnedUrls'));

// Production: serve React build
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`Vault server running on port ${PORT}`);
});

module.exports = app;
