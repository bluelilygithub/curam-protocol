'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const https   = require('https');
const http    = require('http');
const multer  = require('multer');
const { spawn } = require('child_process');
const { pool }  = require('../db');

const router = express.Router();
const PIPELINE_SCRIPT = path.join(__dirname, '../scripts/guitar_pipeline.py');
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = /audio\/(mpeg|mp3|wav|x-wav|mp4|m4a|aac|ogg|flac|webm)/i.test(file.mimetype)
      || /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Unsupported audio type — use mp3, wav, m4a, aac, ogg, or flac'), ok);
  },
});

const SONG_LIST_COLS = `
  s.id, s."userId", s."youtubeUrl", s.title, s.artist, s.duration,
  s."keyDetected", s."capoSuggested", s.tuning, s.bpm, s.status,
  s."errorMessage", s."sourceType", s."audioMime",
  (s."audioData" IS NOT NULL) AS "hasAudio",
  s."createdAt", s."updatedAt"
`;

// ── Ultimate Guitar fetch & parse ─────────────────────────────────────────────

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function fetchUGPage(url, hops = 0) {
  if (hops > 5) throw new Error('Too many redirects fetching Ultimate Guitar page');
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: 20000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : `${parsed.protocol}//${parsed.hostname}${loc}`;
        res.resume();
        return fetchUGPage(next, hops + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Ultimate Guitar returned HTTP ${res.statusCode} — try a different tab URL`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out fetching Ultimate Guitar page')); });
    req.end();
  });
}

function extractUGStore(html) {
  const patterns = [
    /class="js-store"[^>]+data-content="([^"]+)"/,
    /class="js-store"[^>]+data-content='([^']+)'/,
    /data-content="([^"]+)"[^>]+class="js-store"/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (!m) continue;
    try { return JSON.parse(decodeURIComponent(decodeHtmlEntities(m[1]))); } catch {}
    try { return JSON.parse(decodeHtmlEntities(m[1])); } catch {}
  }
  if (html.includes('cf-browser-verification') || html.includes('cf_chl_')) {
    throw new Error('Ultimate Guitar is protected by Cloudflare — open the tab in your browser, copy the URL from the address bar, and try again');
  }
  throw new Error('Could not read tab data from this page — make sure it is a public Chords tab, not a Pro tab or Guitar Pro file');
}

function parseChordName(raw) {
  const m = raw.trim().match(/^([A-G][#b]?)(.*)?$/);
  if (!m) return { root: raw.trim(), quality: '' };
  return { root: m[1], quality: (m[2] || '').trim() };
}

function stripUGMarkup(str) {
  return str.replace(/\[\/?(ch|tab|verse|chorus|bridge|intro|outro|pre|post)[^\]]*\]/gi, '').trim();
}

function parseUGContent(content) {
  const stripped = content.replace(/\[tab\][\s\S]*?\[\/tab\]/gi, '');
  const lines = stripped.split(/\r?\n/);
  const events = [];
  let section = null;
  let tSec = 0;
  const STEP = 2.5;
  let lineIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;

    // Section header e.g. [Verse 1], [Chorus]
    if (/^\[[^\]\/][^\]]*\]$/.test(t) && !/\[ch\]/i.test(t)) {
      section = t.replace(/^\[|\]$/g, '');
      continue;
    }

    const chordTags = [...t.matchAll(/\[ch\]([^\[]+)\[\/ch\]/gi)];
    if (!chordTags.length) continue;

    // Look ahead for a lyric line (next non-empty line that has no chord tags)
    let lyric = null;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) continue;
      if (/^\[[^\]\/][^\]]*\]$/.test(next) && !/\[ch\]/i.test(next)) break; // new section
      if (/\[ch\]/i.test(next)) break; // another chord line
      lyric = stripUGMarkup(next) || null;
      break;
    }

    for (const m of chordTags) {
      const parsed = parseChordName(m[1]);
      events.push({
        timestampSec: parseFloat(tSec.toFixed(3)),
        chordRoot:    parsed.root,
        chordQuality: parsed.quality,
        sectionName:  section,
        confidenceScore: 1.0,
        lyricText: lyric,
        lineIdx,
      });
      tSec += STEP;
    }
    lineIdx++;
  }
  return events;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function setSongStatus(id, fields) {
  const keys   = Object.keys(fields);
  const values = Object.values(fields);
  const sets   = keys.map((k, i) => `"${k}"=$${i + 2}`).join(', ');
  await pool.query(
    `UPDATE guitar_songs SET ${sets}, "updatedAt"=NOW() WHERE id=$1`,
    [id, ...values]
  );
}


/**
 * @param {number} songId
 * @param {number} userId
 * @param {{ youtubeUrl?: string, audioPath?: string, title?: string, artist?: string, persistAudioBuffer?: Buffer, persistAudioMime?: string }} opts
 */
async function runPipeline(songId, userId, opts = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `guitar-${songId}-`));
  await setSongStatus(songId, { status: 'processing', errorMessage: null });

  const youtubeUrl = opts.youtubeUrl || '-';
  const args = [PIPELINE_SCRIPT, youtubeUrl, tmpDir];
  if (opts.audioPath) args.push(opts.audioPath);

  return new Promise((resolve) => {
    const py = spawn('python3', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GUITAR_TITLE:  opts.title || '',
        GUITAR_ARTIST: opts.artist || '',
      },
    });

    py.stdout.on('data', d => console.log(`[guitar:${songId}]`, d.toString().trim()));
    py.stderr.on('data', d => console.error(`[guitar:${songId}]`, d.toString().trim()));

    py.on('close', async (code) => {
      try {
        if (code !== 0) {
          const errFile = path.join(tmpDir, 'error.json');
          const msg = fs.existsSync(errFile)
            ? JSON.parse(fs.readFileSync(errFile)).error
            : `Pipeline exited with code ${code}`;
          await setSongStatus(songId, { status: 'failed', errorMessage: msg });
          return resolve({ ok: false, error: msg });
        }

        const result = JSON.parse(fs.readFileSync(path.join(tmpDir, 'result.json')));

        if (opts.persistAudioBuffer) {
          await pool.query(
            `UPDATE guitar_songs SET
              title=$2, artist=$3, duration=$4, bpm=$5,
              "keyDetected"=$6, "capoSuggested"=$7,
              "audioData"=$8, "audioMime"=$9,
              status='done', "errorMessage"=NULL, "updatedAt"=NOW()
             WHERE id=$1`,
            [songId, result.title, result.artist, result.duration,
             result.bpm, result.key_detected, result.capo_suggested,
             opts.persistAudioBuffer, opts.persistAudioMime || 'audio/mpeg']
          );
        } else {
          // For YouTube downloads: keep converted wav for optional offline playback
          let audioBuf = null;
          let audioMime = null;
          const wavPath = path.join(tmpDir, 'audio.wav');
          if (fs.existsSync(wavPath)) {
            const st = fs.statSync(wavPath);
            if (st.size <= MAX_AUDIO_BYTES) {
              audioBuf = fs.readFileSync(wavPath);
              audioMime = 'audio/wav';
            }
          }
          await pool.query(
            `UPDATE guitar_songs SET
              title=$2, artist=$3, duration=$4, bpm=$5,
              "keyDetected"=$6, "capoSuggested"=$7,
              "audioData"=COALESCE($8, "audioData"),
              "audioMime"=COALESCE($9, "audioMime"),
              status='done', "errorMessage"=NULL, "updatedAt"=NOW()
             WHERE id=$1`,
            [songId, result.title, result.artist, result.duration,
             result.bpm, result.key_detected, result.capo_suggested,
             audioBuf, audioMime]
          );
        }

        await pool.query('DELETE FROM guitar_chord_events WHERE "songId"=$1', [songId]);
        for (const ev of result.chord_events) {
          await pool.query(
            `INSERT INTO guitar_chord_events ("songId","timestampSec","chordRoot","chordQuality","confidenceScore")
             VALUES ($1,$2,$3,$4,$5)`,
            [songId, ev.timestamp_sec, ev.chord_root, ev.chord_quality, ev.confidence_score]
          );
        }

        resolve({ ok: true });
      } catch (err) {
        await setSongStatus(songId, { status: 'failed', errorMessage: err.message });
        resolve({ ok: false, error: err.message });
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        if (opts.audioPath && opts.audioPath.startsWith(os.tmpdir())) {
          try { fs.unlinkSync(opts.audioPath); } catch {}
        }
      }
    });
  });
}

// ── Songs ─────────────────────────────────────────────────────────────────────
router.get('/songs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SONG_LIST_COLS},
              us.id AS "userSongId", us."isFavorite", us."transposeOffset", us."capoOverride"
       FROM guitar_songs s
       LEFT JOIN guitar_user_songs us ON us."songId"=s.id AND us."userId"=$1
       WHERE s."userId"=$1
       ORDER BY s."createdAt" DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ultimate Guitar import
router.post('/songs/ug', async (req, res) => {
  try {
    const { ugUrl } = req.body;
    if (!ugUrl?.trim()) return res.status(400).json({ error: 'ugUrl required' });
    const urlClean = ugUrl.trim();
    if (!/ultimate-guitar\.com/i.test(urlClean)) {
      return res.status(400).json({ error: 'Must be an Ultimate Guitar URL (tabs.ultimate-guitar.com/…)' });
    }

    const html = await fetchUGPage(urlClean);
    const store = extractUGStore(html);

    const pageData = store?.store?.page?.data;
    if (!pageData) throw new Error('Unexpected page structure from Ultimate Guitar');

    const tabMeta  = pageData.tab || {};
    const tabView  = pageData.tab_view || {};
    const content  = tabView?.wiki_tab?.content || tabView?.applicature_tab?.content || '';

    if (!content) {
      throw new Error(
        'No chord content found — this may be a Pro tab or Guitar Pro file. ' +
        'Find a free Chords tab on Ultimate Guitar instead.'
      );
    }

    const title  = tabMeta.song_name   || 'Unknown Title';
    const artist = tabMeta.artist_name || null;

    const chordEvents = parseUGContent(content);
    if (!chordEvents.length) {
      throw new Error('No chords found on this tab — look for a tab labelled "Chords" on the UG page');
    }

    const { rows } = await pool.query(
      `INSERT INTO guitar_songs ("userId",title,artist,"sourceType",status)
       VALUES ($1,$2,$3,'ultimate-guitar','done') RETURNING id`,
      [req.user.id, title, artist]
    );
    const songId = rows[0].id;

    for (const ev of chordEvents) {
      await pool.query(
        `INSERT INTO guitar_chord_events
           ("songId","timestampSec","chordRoot","chordQuality","confidenceScore","sectionName","lyricText","lineIdx")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [songId, ev.timestampSec, ev.chordRoot, ev.chordQuality, ev.confidenceScore, ev.sectionName, ev.lyricText ?? null, ev.lineIdx ?? null]
      );
    }

    res.status(201).json({ songId, title, artist, chordCount: chordEvents.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Audio file upload (primary path for age-restricted / offline content)
router.post('/songs/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'audio file required' });

    const title  = (req.body.title || '').trim() || path.parse(req.file.originalname).name;
    const artist = (req.body.artist || '').trim() || null;
    const youtubeUrl = (req.body.youtubeUrl || '').trim() || null;
    if (youtubeUrl && !/youtu\.?be/.test(youtubeUrl)) {
      return res.status(400).json({ error: 'Optional youtubeUrl must be a YouTube link' });
    }

    const { rows } = await pool.query(
      `INSERT INTO guitar_songs ("userId","youtubeUrl",title,artist,"sourceType",status,"audioMime")
       VALUES ($1,$2,$3,$4,'upload','pending',$5) RETURNING id`,
      [req.user.id, youtubeUrl, title, artist, req.file.mimetype]
    );
    const songId = rows[0].id;

    const ext = path.extname(req.file.originalname || '') || '.mp3';
    const tmpAudio = path.join(os.tmpdir(), `guitar-upload-${songId}${ext}`);
    fs.writeFileSync(tmpAudio, req.file.buffer);

    runPipeline(songId, req.user.id, {
      youtubeUrl: youtubeUrl || '-',
      audioPath: tmpAudio,
      title,
      artist: artist || '',
      persistAudioBuffer: req.file.buffer,
      persistAudioMime: req.file.mimetype,
    }).catch(err => {
      console.error('[guitar] Upload pipeline error:', err.message);
      setSongStatus(songId, { status: 'failed', errorMessage: err.message });
    });

    res.status(202).json({ songId });
  } catch (err) {
    const msg = err.message || 'Upload failed';
    if (/file too large|File too large/i.test(msg)) {
      return res.status(413).json({ error: 'Audio file too large (max 25 MB)' });
    }
    res.status(500).json({ error: msg });
  }
});

// Manual blank chart — user enters chords by hand
router.post('/songs/manual', async (req, res) => {
  try {
    const { title, artist, youtubeUrl } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    const url = youtubeUrl?.trim() || null;
    if (url && !/youtu\.?be/.test(url)) {
      return res.status(400).json({ error: 'Optional youtubeUrl must be a YouTube link' });
    }

    const { rows } = await pool.query(
      `INSERT INTO guitar_songs ("userId","youtubeUrl",title,artist,"sourceType",status)
       VALUES ($1,$2,$3,$4,'manual','done') RETURNING id`,
      [req.user.id, url, title.trim(), artist?.trim() || null]
    );
    res.status(201).json({ songId: rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add a chord event manually (for manual charts or inserts)
router.post('/songs/:id/chords', async (req, res) => {
  try {
    const { timestampSec, chordRoot, chordQuality, sectionName } = req.body;
    if (timestampSec == null || !chordRoot) {
      return res.status(400).json({ error: 'timestampSec and chordRoot required' });
    }
    const own = await pool.query(
      `SELECT id FROM guitar_songs WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!own.rows[0]) return res.status(404).json({ error: 'Not found' });

    const { rows } = await pool.query(
      `INSERT INTO guitar_chord_events
         ("songId","timestampSec","chordRoot","chordQuality","confidenceScore","isUserCorrected","sectionName")
       VALUES ($1,$2,$3,$4,1,TRUE,$5) RETURNING *`,
      [req.params.id, timestampSec, chordRoot, chordQuality || '', sectionName || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/songs/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SONG_LIST_COLS},
              us.id AS "userSongId", us.notes, us."isFavorite",
              us."transposeOffset", us."capoOverride", us."lastPracticedAt"
       FROM guitar_songs s
       LEFT JOIN guitar_user_songs us ON us."songId"=s.id AND us."userId"=$2
       WHERE s.id=$1 AND s."userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stream stored audio for HTML5 player (upload path / optional YT fallback)
router.get('/songs/:id/audio', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT "audioData", "audioMime" FROM guitar_songs WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]?.audioData) return res.status(404).json({ error: 'No audio stored for this song' });
    const buf = rows[0].audioData;
    res.set({
      'Content-Type': rows[0].audioMime || 'audio/mpeg',
      'Content-Length': buf.length,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    });
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/songs/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM guitar_songs WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Chord events ──────────────────────────────────────────────────────────────
router.get('/songs/:id/chords', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ce.* FROM guitar_chord_events ce
       JOIN guitar_songs s ON s.id=ce."songId"
       WHERE ce."songId"=$1 AND s."userId"=$2
       ORDER BY ce."timestampSec"`,
      [req.params.id, req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/songs/:songId/chords/:eventId', async (req, res) => {
  try {
    const { chordRoot, chordQuality, sectionName } = req.body;
    const { rows } = await pool.query(
      `UPDATE guitar_chord_events ce SET
        "chordRoot"=$1, "chordQuality"=$2, "sectionName"=$3, "isUserCorrected"=TRUE
       FROM guitar_songs s
       WHERE ce.id=$4 AND ce."songId"=s.id AND s."userId"=$5
       RETURNING ce.*`,
      [chordRoot, chordQuality ?? '', sectionName ?? null, req.params.eventId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/songs/:songId/chords/:eventId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM guitar_chord_events ce USING guitar_songs s
       WHERE ce.id=$1 AND ce."songId"=s.id AND s.id=$2 AND s."userId"=$3`,
      [req.params.eventId, req.params.songId, req.user.id]
    );
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Chord shapes ──────────────────────────────────────────────────────────────
router.get('/chord-shapes/:name', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM guitar_chord_shapes WHERE "chordName"=$1 ORDER BY "voicingType"`,
      [req.params.name]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Library ───────────────────────────────────────────────────────────────────
router.post('/library', async (req, res) => {
  try {
    const { songId } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO guitar_user_songs ("userId","songId") VALUES ($1,$2)
       ON CONFLICT ("userId","songId") DO NOTHING RETURNING *`,
      [req.user.id, songId]
    );
    res.status(201).json(rows[0] || { already: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/library/:songId', async (req, res) => {
  try {
    const { notes, isFavorite, transposeOffset, capoOverride } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO guitar_user_songs ("userId","songId",notes,"isFavorite","transposeOffset","capoOverride")
         VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT ("userId","songId") DO UPDATE SET
         notes=COALESCE($3, guitar_user_songs.notes),
         "isFavorite"=COALESCE($4, guitar_user_songs."isFavorite"),
         "transposeOffset"=COALESCE($5, guitar_user_songs."transposeOffset"),
         "capoOverride"=COALESCE($6, guitar_user_songs."capoOverride"),
         "lastPracticedAt"=NOW()
       RETURNING *`,
      [req.user.id, req.params.songId, notes, isFavorite, transposeOffset, capoOverride]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Practice loops ────────────────────────────────────────────────────────────
router.get('/loops/:songId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.* FROM guitar_user_song_loops l
       JOIN guitar_user_songs us ON us.id=l."userSongId"
       WHERE us."userId"=$1 AND us."songId"=$2
       ORDER BY l."startTimeSec"`,
      [req.user.id, req.params.songId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/loops/:songId', async (req, res) => {
  try {
    const { name, startTimeSec, endTimeSec } = req.body;
    const { rows: us } = await pool.query(
      `INSERT INTO guitar_user_songs ("userId","songId") VALUES ($1,$2)
       ON CONFLICT ("userId","songId") DO UPDATE SET "lastPracticedAt"=NOW()
       RETURNING id`,
      [req.user.id, req.params.songId]
    );
    const { rows } = await pool.query(
      `INSERT INTO guitar_user_song_loops ("userSongId",name,"startTimeSec","endTimeSec")
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [us[0].id, name, startTimeSec, endTimeSec]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/loops/:loopId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM guitar_user_song_loops l USING guitar_user_songs us
       WHERE l.id=$1 AND l."userSongId"=us.id AND us."userId"=$2`,
      [req.params.loopId, req.user.id]
    );
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});


module.exports = router;
