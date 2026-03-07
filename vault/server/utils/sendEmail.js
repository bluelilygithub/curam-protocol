const nodemailer = require('nodemailer');
const https = require('https');

let _db;
function getDb() {
  if (!_db) _db = require('../db');
  return _db;
}

function getMailChannelKey() {
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key='MAIL_CHANNEL_API_KEY'").get();
    if (row?.value) return row.value;
  } catch (_) {}
  return process.env.MAIL_CHANNEL_API_KEY || null;
}

/**
 * Send an email via MailChannels (if key configured) or SMTP nodemailer.
 * @param {{ to: string, subject: string, html: string, from?: string }} opts
 */
async function sendEmail({ to, subject, html, from }) {
  const mailChannelKey = getMailChannelKey();

  if (mailChannelKey) {
    const payload = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from || process.env.SMTP_USER || 'noreply@example.com' },
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
            Authorization: `Bearer ${mailChannelKey}`,
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

  await transporter.sendMail({ from: from || process.env.SMTP_USER, to, subject, html });
}

module.exports = sendEmail;
