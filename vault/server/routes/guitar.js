const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { spawn } = require('child_process');
const { pool }  = require('../db');

const router = express.Router();

const PIPELINE_SCRIPT = path.join(__dirname, '../scripts/guitar_pipeline.py');

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

async function runPipeline(songId, youtubeUrl, userId) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `guitar-${songId}-`));

  await setSongStatus(songId, { status: 'processing' });

  // Load stored yt-dlp OAuth token for this user (if any)
  let oauthTokenJson = null;
  try {
    const { rows } = await pool.query(
      'SELECT "tokenJson" FROM guitar_yt_oauth WHERE "userId"=$1', [userId]
    );
    if (rows[0]?.tokenJson) oauthTokenJson = rows[0].tokenJson;
  } catch (_) {}

  return new Promise((resolve) => {
    const py = spawn('python3', [PIPELINE_SCRIPT, youtubeUrl, tmpDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        YOUTUBE_API_KEY:    process.env.YOUTUBE_API_KEY || '',
        YTDLP_OAUTH_TOKEN:  oauthTokenJson || '',
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

        // Persist song metadata
        await pool.query(
          `UPDATE guitar_songs SET
            title=$2, artist=$3, duration=$4, bpm=$5,
            "keyDetected"=$6, "capoSuggested"=$7,
            status='done', "updatedAt"=NOW()
           WHERE id=$1`,
          [songId, result.title, result.artist, result.duration,
           result.bpm, result.key_detected, result.capo_suggested]
        );

        // Insert chord events (replace any existing)
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
        // Clean up temp audio files
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    });
  });
}

// ── Songs ─────────────────────────────────────────────────────────────────────
router.get('/songs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, us.id AS "userSongId", us."isFavorite", us."transposeOffset", us."capoOverride"
       FROM guitar_songs s
       LEFT JOIN guitar_user_songs us ON us."songId"=s.id AND us."userId"=$1
       WHERE s."userId"=$1
       ORDER BY s."createdAt" DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/songs', async (req, res) => {
  try {
    const { youtubeUrl } = req.body;
    if (!youtubeUrl?.trim()) return res.status(400).json({ error: 'youtubeUrl required' });

    const urlClean = youtubeUrl.trim();
    // Basic YouTube URL validation
    if (!/youtu\.?be/.test(urlClean)) return res.status(400).json({ error: 'Must be a YouTube URL' });

    const { rows } = await pool.query(
      `INSERT INTO guitar_songs ("userId","youtubeUrl",status) VALUES ($1,$2,'pending') RETURNING id`,
      [req.user.id, urlClean]
    );
    const songId = rows[0].id;

    // Fire pipeline async
    runPipeline(songId, urlClean, req.user.id).catch(err => {
      console.error('[guitar] Pipeline error:', err.message);
      setSongStatus(songId, { status: 'failed', errorMessage: err.message });
    });

    res.status(202).json({ songId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/songs/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, us.id AS "userSongId", us.notes, us."isFavorite",
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

// ── Library (user-songs) ──────────────────────────────────────────────────────
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
    // Ensure user_song record exists
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

// ── YouTube OAuth2 (yt-dlp device flow) ──────────────────────────────────────
//
// How it works:
//   1. POST /auth/start  → spawns yt-dlp --username oauth2, captures the
//      device-code URL from its stdout, returns it to the client.
//      yt-dlp stays blocked waiting for the user to approve in their browser.
//   2. Frontend shows the URL. User opens it and grants access.
//   3. yt-dlp writes its token to a temp HOME dir and exits.
//   4. Server reads that token file, stores it (encrypted) in guitar_yt_oauth,
//      and resolves the pending SSE / poll.
//   5. GET /auth/status   → returns { connected: bool, connectedAt }
//   6. DELETE /auth       → removes the stored token

// In-memory holder for an in-progress device-flow per user
const pendingOAuth = new Map(); // userId → { proc, tokenDir, resolve }

router.post('/auth/start', async (req, res) => {
  const userId = req.user.id;

  // Kill any existing pending flow for this user
  if (pendingOAuth.has(userId)) {
    try { pendingOAuth.get(userId).proc.kill(); } catch (_) {}
    pendingOAuth.delete(userId);
  }

  // Temp HOME so yt-dlp writes its token to a known, isolated location
  const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), `ytdlp-oauth-${userId}-`));
  const cacheDir  = path.join(tokenDir, '.cache', 'yt-dlp');
  fs.mkdirSync(cacheDir, { recursive: true });

  let deviceUrl = null;

  const proc = spawn(
    'yt-dlp',
    ['--username', 'oauth2', '--password', '', '--skip-download',
     'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    {
      env: { ...process.env, HOME: tokenDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let stdout = '';
  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => { stdout += d.toString(); }); // yt-dlp logs to stderr too

  // yt-dlp prints something like:
  //   "Please open https://www.google.com/device and enter code: XXXX-XXXX"
  const urlCheckInterval = setInterval(() => {
    const m = stdout.match(/https:\/\/www\.google\.com\/device[^\s]*/i)
           || stdout.match(/(https:\/\/[^\s]+google[^\s]+device[^\s]*)/i);
    if (m && !deviceUrl) {
      deviceUrl = m[0].replace(/\s+$/, '');
      // Return the URL to the client immediately
      if (!res.headersSent) {
        res.json({ ok: true, deviceUrl });
      }
    }
  }, 500);

  proc.on('close', async (code) => {
    clearInterval(urlCheckInterval);

    if (!res.headersSent) {
      // yt-dlp exited before we found a device URL
      res.status(500).json({ error: 'Failed to start OAuth flow — check yt-dlp is installed' });
    }

    pendingOAuth.delete(userId);

    // Try to read the token file yt-dlp wrote
    try {
      const tokenFile = path.join(cacheDir, 'youtube.token.json');
      if (code === 0 && fs.existsSync(tokenFile)) {
        const tokenJson = fs.readFileSync(tokenFile, 'utf8');
        await pool.query(
          `INSERT INTO guitar_yt_oauth ("userId","tokenJson","connectedAt","updatedAt")
           VALUES ($1,$2,NOW(),NOW())
           ON CONFLICT ("userId") DO UPDATE SET "tokenJson"=$2, "updatedAt"=NOW()`,
          [userId, tokenJson]
        );
        console.log(`[guitar:auth] OAuth token saved for user ${userId}`);
      }
    } catch (e) {
      console.error('[guitar:auth] token save error:', e.message);
    } finally {
      fs.rmSync(tokenDir, { recursive: true, force: true });
    }
  });

  pendingOAuth.set(userId, { proc, tokenDir });

  // Timeout: if we don't find a URL in 20 s, give up
  setTimeout(() => {
    if (!res.headersSent) {
      proc.kill();
      res.status(504).json({ error: 'Timeout waiting for YouTube device code' });
    }
  }, 20000);
});

router.get('/auth/status', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT "connectedAt" FROM guitar_yt_oauth WHERE "userId"=$1',
      [req.user.id]
    );
    res.json({ connected: rows.length > 0, connectedAt: rows[0]?.connectedAt || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/auth', async (req, res) => {
  try {
    // Kill any in-progress flow
    if (pendingOAuth.has(req.user.id)) {
      try { pendingOAuth.get(req.user.id).proc.kill(); } catch (_) {}
      pendingOAuth.delete(req.user.id);
    }
    await pool.query('DELETE FROM guitar_yt_oauth WHERE "userId"=$1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
