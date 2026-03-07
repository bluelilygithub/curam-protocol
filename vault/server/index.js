require('dotenv').config(); const express = require('express'); const helmet = require('helmet'); const path = require('path'); const fs = require('fs');

const app = express(); const PORT = process.env.PORT || 3001;

app.use(helmet({ contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false, }));

app.use(express.json({ limit: '10mb' })); app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads'); if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir, { recursive: true }); }

async function seedInitialUser() { const { SEED_EMAIL, SEED_PASSWORD } = process.env; if (!SEED_EMAIL || !SEED_PASSWORD) return; const db = require('./db'); const existing = db.prepare('SELECT id FROM users WHERE 1').get(); if (existing) return; const bcrypt = require('bcryptjs'); const hash = await bcrypt.hash(SEED_PASSWORD, 12); db.prepare('INSERT INTO users (email, passwordHash) VALUES (?, ?)').run(SEED_EMAIL.toLowerCase(), hash); console.log('Initial user created:', SEED_EMAIL); } seedInitialUser().catch(err => console.error('Seed error:', err));

app.use('/api/auth', require('./routes/auth'));

const { requireAuth } = require('./middleware/auth'); app.use('/api', requireAuth);

app.use('/api/user', requireAuth, require('./routes/user')); app.use('/api/health', require('./routes/health')); app.use('/api/projects', require('./routes/projects')); app.use('/api/chat', require('./routes/chat')); app.use('/api/files', require('./routes/files')); app.use('/api/pdf', require('./routes/pdf')); app.use('/api/search', require('./routes/search')); app.use('/api/email', require('./routes/email')); app.use('/api/export', require('./routes/export')); app.use('/api/fetch-url', require('./routes/fetchUrl')); app.use('/api/web-search', require('./routes/webSearch')); app.use('/api/memory', require('./routes/memory')); app.use('/api/prompts', require('./routes/prompts')); app.use('/api/folders', require('./routes/folders')); app.use('/api/personas', require('./routes/personas')); app.use('/api/pinned-urls', require('./routes/pinnedUrls')); app.use('/api/compare', require('./routes/compare')); app.use('/api/debate', require('./routes/debate')); app.use('/api/settings', require('./routes/settings')); app.use('/api/admin', require('./routes/admin')); app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/task-templates', require('./routes/taskTemplates'));

if (process.env.NODE_ENV === 'production') { const distPath = path.join(__dirname, '../dist'); app.use(express.static(distPath)); app.get('*', (req, res) => { res.sendFile(path.join(distPath, 'index.html')); }); }

app.use((err, req, res, next) => { console.error(err.stack); res.status(err.status || 500).json({ error: err.message || 'Internal server error', }); });

app.listen(PORT, () => { console.log('Vault server running on port ' + PORT); });

module.exports = app;