'use strict';

/** The words and layout of the three reminder emails. Pure: data in, { subject, html } out. Plain, warm and never a telling-off. */

const SLOT = { morning: 'Morning', midday: 'Midday', evening: 'Evening' };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function shell({ heading, bodyHtml, buttonText, buttonUrl, unsubUrl, allUrl }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f0;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border:1px solid #d8d8d0;border-radius:14px;padding:24px;">
      <h1 style="font-size:20px;margin:0 0 12px;">${esc(heading)}</h1>
      ${bodyHtml}
      <p style="margin:20px 0 0;"><a href="${esc(buttonUrl)}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;">${esc(buttonText)}</a></p>
    </div>
    <p style="font-size:12px;color:#888888;line-height:1.5;margin:14px 4px 0;">
      You get this because you turned on Fitness reminders. <a href="${esc(unsubUrl)}" style="color:#888888;">Stop this kind of email</a> · <a href="${esc(allUrl)}" style="color:#888888;">Stop all Fitness emails</a>.
    </p>
  </div></body></html>`;
}

const sessionList = (sessions) => `<ul style="padding-left:18px;margin:8px 0;line-height:1.6;font-size:14px;">${sessions
  .map((s) => `<li><strong>${esc(s.title)}</strong>${s.slot ? ` · ${esc(SLOT[s.slot] || s.slot)}` : ''} · ${esc(s.totalMinutes)} min</li>`).join('')}</ul>`;

/**
 * @param {'morning'|'catchup'|'rerate'} kind
 * @param {{ sessions?:object[], weekNote?:string|null, weeks?:number, level?:string, urls:{ app:string, unsub:string, all:string } }} d
 */
function buildEmail(kind, d) {
  const urls = d.urls;
  if (kind === 'morning') {
    const sessions = d.sessions || [];
    return {
      subject: sessions.length === 1 ? `Today: ${sessions[0].title}` : `Today's plan: ${sessions.length} sessions`,
      html: shell({
        heading: 'Your plan for today',
        bodyHtml: `${sessionList(sessions)}${d.weekNote ? `<p style="font-size:14px;line-height:1.6;color:#444444;">${esc(d.weekNote)}</p>` : ''}<p style="font-size:14px;color:#444444;">Go at the pace that suits your day. You can move a session or take a rest day if you need to.</p>`,
        buttonText: 'Open today', buttonUrl: urls.app, unsubUrl: urls.unsub, allUrl: urls.all,
      }),
    };
  }
  if (kind === 'catchup') {
    const sessions = d.sessions || [];
    return {
      subject: 'Want to log today, or move it?',
      html: shell({
        heading: 'How did today go?',
        bodyHtml: `<p style="font-size:14px;line-height:1.6;">Today's plan is still open:</p>${sessionList(sessions)}<p style="font-size:14px;line-height:1.6;color:#444444;">If you did it, a quick log keeps your picture up to date. If today turned out busy, you can move it to another day or take a rest day. Either is fine.</p>`,
        buttonText: 'Log or move it', buttonUrl: urls.app, unsubUrl: urls.unsub, allUrl: urls.all,
      }),
    };
  }
  const firm = d.level === 'firm';
  return {
    subject: firm ? 'A quick re-rate keeps your plan honest' : 'Time for a quick re-rate?',
    html: shell({
      heading: 'Re-rate your fitness',
      bodyHtml: `<p style="font-size:14px;line-height:1.6;">${firm
        ? `It has been about ${esc(d.weeks)} weeks since you last rated your fitness. A one-minute re-rate lets the plan fit where you are now.`
        : `About ${esc(d.weeks)} weeks since your last rating. If things have changed, a one-minute re-rate keeps the plan fitting you.`}</p><p style="font-size:14px;color:#444444;">Your earlier ratings are kept, so you can see how far you have come.</p>`,
      buttonText: 'Re-rate now', buttonUrl: urls.app, unsubUrl: urls.unsub, allUrl: urls.all,
    }),
  };
}

module.exports = { buildEmail };
