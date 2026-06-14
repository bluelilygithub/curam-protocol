const nodemailer = require('nodemailer');
const https = require('https');
const { runtimeConfig } = require('../config/runtime');

async function getMailChannelKey() {
  try {
    const { pool } = require('../db');
    const { rows } = await pool.query("SELECT value FROM settings WHERE key='MAIL_CHANNEL_API_KEY'");
    if (rows[0]?.value) return rows[0].value;
  } catch (_) {}
  return process.env.MAIL_CHANNEL_API_KEY || null;
}

function defaultFromAddress(from) {
  return from || process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@curam-ai.com.au';
}

/**
 * Send an email via MailChannels (if key configured) or SMTP nodemailer.
 * @param {{ to: string, subject: string, html: string, from?: string }} opts
 */
async function sendEmail({ to, subject, html, from }) {
  if (runtimeConfig.disableEmail) {
    console.log(`[runtime] Email disabled by DISABLE_EMAIL; skipped "${subject}" to ${to}`);
    return;
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
            if (res.statusCode >= 200 && res.statusCode < 300) resolve();
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
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({ from: defaultFromAddress(from), to, subject, html });
}

module.exports = sendEmail;
