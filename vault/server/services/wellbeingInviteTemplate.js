'use strict';

const DEFAULT_WELLBEING_INVITE_SUBJECT = 'Invitation to complete the Wellbeing & Personality Checks';

const DEFAULT_WELLBEING_INVITE_BODY = `Hello,

You are being invited to complete the Curam Wellbeing & Personality Checks as a proof-of-concept self-report exercise.

The quiz area brings together four short self-report tools:

- a BDI-style mood check
- an IPIP-NEO-120-style personality inventory
- a CERQ-style cognitive coping check
- a Brief COPE-style coping check

When all four are completed, the system can generate an overall profile, charts, and a mind map that bring the results together. The aim is to support reflection and discussion by showing patterns across mood, personality style, thinking responses, and coping behaviour.

What you are expected to do:

1. Log in using the email address and temporary password below.
2. Complete the four checks as honestly as you can.
3. Use the optional reflection boxes where extra context would make an answer clearer.
4. Review your results when you are finished.

The full set of checks may take around 30 to 45 minutes, depending on how much reflection you add. You can pause and return later on the same device if needed.

This is not medical advice, a diagnosis, a clinical risk assessment, or a substitute for a qualified professional. If any question raises concern about immediate safety or distress, please seek appropriate professional, crisis, or emergency support.

When you are finished, you can use the reset option in the Wellbeing dashboard to erase all completed wellbeing test results for your account and clear paused drafts from that device.

Login link:
{{link}}

Email:
{{email}}

Temporary password:
{{password}}

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

function fillTemplate(template, values) {
  return String(template || '')
    .replace(/\{\{\s*link\s*\}\}/gi, values.link)
    .replace(/\{\{\s*email\s*\}\}/gi, values.email)
    .replace(/\{\{\s*password\s*\}\}/gi, values.password);
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

function renderWellbeingInviteHtml({ body, email, password, link }) {
  const filled = fillTemplate(body || DEFAULT_WELLBEING_INVITE_BODY, { email, password, link });
  return `<!DOCTYPE html>
<html>
  <body style="font-family: Arial, sans-serif; background: #f5f5f0; padding: 24px; color: #1a1a1a;">
    <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px; border: 1px solid #d8d8d0;">
      <div style="font-size: 14px; line-height: 1.6;">
        ${textToHtml(filled)}
      </div>
      <p style="margin-top: 24px;">
        <a href="${escapeHtml(link)}" style="display: inline-block; background: #CC785C; color: #ffffff; padding: 12px 20px; border-radius: 10px; text-decoration: none; font-weight: 700;">
          Open Wellbeing Checks
        </a>
      </p>
    </div>
  </body>
</html>`;
}

module.exports = {
  DEFAULT_WELLBEING_INVITE_SUBJECT,
  DEFAULT_WELLBEING_INVITE_BODY,
  renderWellbeingInviteHtml,
};
