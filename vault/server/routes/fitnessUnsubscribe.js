'use strict';

// The "stop these emails" link in every Fitness reminder. Public (mounted before requireAuth): the person's own random token is
// the proof. Shows a plain page; never reveals whether an address exists.
const express = require('express');
const { unsubscribe } = require('../services/fitness/reminderService');

const router = express.Router();

const page = (title, text) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f5f5f0;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;"><div style="max-width:460px;margin:60px auto;padding:0 16px;">
<div style="background:#fff;border:1px solid #d8d8d0;border-radius:14px;padding:24px;"><h1 style="font-size:20px;margin:0 0 10px;">${title}</h1><p style="font-size:15px;line-height:1.6;margin:0;">${text}</p></div></div></body></html>`;

router.get('/', async (req, res) => {
  try {
    const ok = await unsubscribe(req.query.u, String(req.query.t || ''), String(req.query.k || ''));
    res.status(ok ? 200 : 400).type('html').send(ok
      ? page('Done', 'Those emails are switched off. You can turn them back on any time in Fitness, under Profile.')
      : page('This link did not work', 'It may be old or incomplete. You can change your reminders any time in Fitness, under Profile.'));
  } catch (err) {
    res.status(500).type('html').send(page('Something went wrong', 'Please try again in a moment, or change your reminders in Fitness, under Profile.'));
  }
});

module.exports = router;
