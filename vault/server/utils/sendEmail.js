const nodemailer = require('nodemailer');
const https = require('https');
const { runtimeConfig } = require('../config/runtime');

function configuredValue(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^(missing|not configured|your_|changeme|example)/i.test(text)) return null;
  return text;
}

function envMailChannelKey() {
  return configuredValue(
    process.env.MAIL_CHANNEL_API_KEY ||
    process.env.MAILCHANNELS_API_KEY ||
    process.env.MAILCHANNEL_API_KEY
  );
}

async function getStoredMailChannelKey() {
  try {
    const { pool } = require('../db');
    const { rows } = await pool.query("SELECT value FROM workspace_settings WHERE key='MAIL_CHANNEL_API_KEY' LIMIT 1");
    const key = configuredValue(rows[0]?.value);
    if (key) return key;
  } catch (_) {
    /* Older deployments may not have workspace_settings yet. */
  }

  try {
    const { pool } = require('../db');
    const { rows } = await pool.query(`
      SELECT s.value
      FROM settings s
      LEFT JOIN users u ON u.id = s."userId"
      WHERE s.key='MAIL_CHANNEL_API_KEY'
      ORDER BY COALESCE(u."isAdmin", FALSE) DESC, s."userId" ASC NULLS LAST
      LIMIT 1
    `);
    return configuredValue(rows[0]?.value);
  } catch (_) {
    /* Fall through to legacy global settings table shape. */
  }

  try {
    const { pool } = require('../db');
    const { rows } = await pool.query("SELECT value FROM settings WHERE key='MAIL_CHANNEL_API_KEY' LIMIT 1");
    return configuredValue(rows[0]?.value);
  } catch (_) {
    return null;
  }
}

async function getMailChannelKey() {
  return envMailChannelKey() || await getStoredMailChannelKey();
}

function defaultFromAddress(from) {
  return configuredValue(from) ||
    configuredValue(process.env.MAIL_FROM) ||
    configuredValue(process.env.SMTP_FROM) ||
    configuredValue(process.env.SMTP_USER) ||
    'noreply@curam-ai.com.au';
}

function smtpConfig() {
  const host = configuredValue(process.env.SMTP_HOST);
  const user = configuredValue(process.env.SMTP_USER);
  const pass = configuredValue(process.env.SMTP_PASS);
  if (!host || !user || !pass) return null;
  return {
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user, pass },
  };
}

/**
 * Send an email via MailChannels (if key configured) or SMTP nodemailer.
 * @param {{ to: string, subject: string, html: string, from?: string }} opts
 */
async function sendEmail({ to, subject, html, from }) {
  if (runtimeConfig.disableEmail) {
    const reason = `Email disabled by DISABLE_EMAIL; skipped "${subject}" to ${to}`;
    console.log(`[runtime] ${reason}`);
    return { ok: false, skipped: true, reason };
  }

  const mailChannelKey = await getMailChannelKey();

  if (mailChannelKey) {
    const payload = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: defaultFromAddress(from) },
      subject,
      content: [{ type: 'text/html', value: html }],
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.mailchannels.net',
          path: '/tx/v1/send',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': mailChannelKey,
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true, provider: 'mailchannels' });
            else reject(new Error(`MailChannels error ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
          });
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  // Fallback: SMTP via nodemailer
  const smtp = smtpConfig();
  if (!smtp) {
    throw new Error('Email delivery is not configured. Set MAIL_CHANNEL_API_KEY, or set SMTP_HOST, SMTP_USER, and SMTP_PASS.');
  }
  const transporter = nodemailer.createTransport(smtp);

  await transporter.sendMail({ from: defaultFromAddress(from), to, subject, html });
  return { ok: true, provider: 'smtp' };
}

module.exports = sendEmail;
