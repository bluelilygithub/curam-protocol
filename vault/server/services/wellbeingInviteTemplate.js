'use strict';

const DEFAULT_WELLBEING_INVITE_SUBJECT = 'Invitation to complete the Wellbeing & Personality Checks';

const DEFAULT_WELLBEING_INVITE_BODY = `Hello,

You are being invited to complete the Curam Wellbeing & Personality Checks as a proof-of-concept self-report exercise.

The quiz area brings together eight short self-report tools:

- a BDI-style mood check
- a GAD-7-style anxiety check
- a PANAS-style affect check
- an ASRS-5-style attention check
- an IPIP-NEO-120-style personality inventory
- a HEXACO-60-style personality check
- a CERQ-style cognitive coping check
- a Brief COPE-style coping check

When all eight are completed, the system can generate an overall profile, charts, and a mind map that bring the results together. The aim is to support reflection and discussion by showing patterns across mood, anxiety load, affect tone, attention/self-regulation, personality style, thinking responses, and coping behaviour.

What you are expected to do:

1. Open the secure setup link below and choose your own password.
2. Complete the eight checks as honestly as you can.
3. Use the optional reflection boxes where extra context would make an answer clearer.
4. Review your results when you are finished.

The full set of checks may take around 30 to 45 minutes, depending on how much reflection you add. You can pause and return later on the same device if needed.

This is not medical advice, a diagnosis, a clinical risk assessment, or a substitute for a qualified professional. If any question raises concern about immediate safety or distress, please seek appropriate professional, crisis, or emergency support.

After testing or using the checks, you can reset and erase your wellbeing data if you wish. Use the reset option in the Wellbeing dashboard to delete completed wellbeing test results for your account and clear paused drafts from that device.

Secure setup link:
{{link}}

Email:
{{email}}

Regards,
Curam`;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeWellbeingInviteBody(body) {
  const cleaned = String(body || DEFAULT_WELLBEING_INVITE_BODY)
    .replace(/^\s*Temporary password:\s*\n\s*\{\{\s*password\s*\}\}\s*\n?/gim, '')
    .replace(/\{\{\s*password\s*\}\}/gi, '')
    .replace(/temporary password below/gi, 'secure setup link below')
    .replace(/temporary password/gi, 'setup link')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (/(erase|delete|reset).{0,80}(wellbeing|test|data|results)|wellbeing.{0,80}(erase|delete|reset)/i.test(cleaned)) {
    return cleaned;
  }
  const notice = 'After testing or using the checks, you can reset and erase your wellbeing data if you wish. Use the reset option in the Wellbeing dashboard to delete completed wellbeing test results for your account and clear paused drafts from that device.';
  return cleaned.replace(/\n+(Secure setup link:\s*\n\{\{\s*link\s*\}\})/i, `\n\n${notice}\n\n$1`);
}

function fillTemplate(template, values) {
  return sanitizeWellbeingInviteBody(template)
    .replace(/\{\{\s*link\s*\}\}/gi, values.link)
    .replace(/\{\{\s*email\s*\}\}/gi, values.email);
}

function textToHtml(text) {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) return '';
      const listLike = lines.length > 1 && lines.every((line) => /^(-|\d+\.)\s+/.test(line));
      if (listLike) {
        return `<ul>${lines.map((line) => `<li>${line.replace(/^(-|\d+\.)\s+/, '')}</li>`).join('')}</ul>`;
      }
      return `<p>${lines.join('<br>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

function renderWellbeingInviteHtml({ body, email, link }) {
  const filled = fillTemplate(body || DEFAULT_WELLBEING_INVITE_BODY, { email, link });
  return `<!DOCTYPE html>
<html>
  <body style="font-family: Arial, sans-serif; background: #f5f5f0; padding: 24px; color: #1a1a1a;">
    <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; border: 1px solid #d8d8d0;">
      <div style="font-size: 14px; line-height: 1.6;">
        ${textToHtml(filled)}
      </div>
      <p style="margin-top: 24px;">
        <a href="${escapeHtml(link)}" style="display: inline-block; background: #CC785C; color: #ffffff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 700;">
          Set Password & Open Wellbeing Checks
        </a>
      </p>
    </div>
  </body>
</html>`;
}

module.exports = {
  DEFAULT_WELLBEING_INVITE_SUBJECT,
  DEFAULT_WELLBEING_INVITE_BODY,
  sanitizeWellbeingInviteBody,
  renderWellbeingInviteHtml,
};
