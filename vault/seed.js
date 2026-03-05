// Run once to create your login account:  node seed.js
require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./server/db');

const EMAIL = 'michaelbarrett@bluelily.com.au';
const PASSWORD = 'passwordXYZ';

async function seed() {
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(EMAIL.toLowerCase());
  if (existing) {
    console.log('User already exists:', EMAIL);
    process.exit(0);
  }
  const hash = await bcrypt.hash(PASSWORD, 12);
  db.prepare('INSERT INTO users (email, passwordHash) VALUES (?, ?)').run(EMAIL.toLowerCase(), hash);
  console.log('✓ User created:', EMAIL);
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
